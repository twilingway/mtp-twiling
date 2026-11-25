import { object } from "./types.js";
import { ServerClock } from "./server-clock.js";

const BASE = "https://invest-public-api.tbank.ru/rest/tinkoff.public.invest.api.contract.v1.";
const STREAM =
  "wss://invest-public-api.tbank.ru/ws/tinkoff.public.invest.api.contract.v1.MarketDataStreamService/MarketDataStream";
interface TransportCallbacks {
  connecting: () => void;
  open: () => void;
  data: (message: Record<string, unknown>) => void;
  error: (message: string) => void;
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Отменено", "AbortError"));
      return;
    }
    const abort = () => {
      clearTimeout(id);
      reject(new DOMException("Отменено", "AbortError"));
    };
    const id = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
export class BankError extends Error {
  constructor(
    message: string,
    public readonly code: string | number
  ) {
    super(message);
    this.name = "BankError";
  }
}

/** Browser-only REST rate queue and reconnecting market-data WebSocket. */
export class BankTransport {
  closed = false;
  private socket: WebSocket | null = null;
  private retry = 0;
  private requestQueue: Promise<void> = Promise.resolve();
  private nextRequest = 0;
  private lastMessage = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private healthTimer: ReturnType<typeof setInterval> | undefined;
  private readonly lifetime = new AbortController();
  private readonly clock = new ServerClock();
  constructor(
    private readonly token: string,
    private readonly callbacks: TransportCallbacks
  ) {}
  serverNow(): number {
    return this.clock.now(Date.now());
  }
  get clockOffset(): number | null {
    return this.clock.offset;
  }
  request(
    service: string,
    method: string,
    body: object = {},
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    const requestSignal = signal
      ? AbortSignal.any([signal, this.lifetime.signal])
      : this.lifetime.signal;
    const run = async (): Promise<Record<string, unknown>> => {
      if (this.closed || requestSignal.aborted) throw new DOMException("Отключено", "AbortError");
      await delay(Math.max(0, this.nextRequest - Date.now()), requestSignal);
      this.nextRequest = Date.now() + 200;
      for (let attempt = 0; attempt < 3; attempt++) {
        let response: Response;
        try {
          response = await fetch(BASE + service + "/" + method, {
            method: "POST",
            mode: "cors",
            credentials: "omit",
            headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.any([requestSignal, AbortSignal.timeout(20000)]),
            redirect: "error"
          });
        } catch (error) {
          if (
            requestSignal.aborted ||
            (error instanceof DOMException &&
              (error.name === "AbortError" || error.name === "TimeoutError"))
          )
            throw error;
          throw new BankError(
            "Браузер не смог подключиться к Т‑Банку. Проверьте сеть и доверие сертификату банка.",
            "NETWORK"
          );
        }
        if (response.status === 429 && attempt < 2) {
          const retryAfter = Number(response.headers.get("retry-after") || 5);
          await delay(
            Math.min(60000, (Number.isFinite(retryAfter) ? retryAfter : 5) * 1000 * (attempt + 1)),
            requestSignal
          );
          continue;
        }
        if (!response.ok) {
          const texts: Partial<Record<number, string>> = {
            400: "Банк отклонил параметры запроса.",
            401: "Токен недействителен или отозван.",
            403: "У ключа нет доступа к этим данным.",
            429: "Достигнут лимит запросов банка. Повторите позже."
          };
          throw new BankError(
            texts[response.status] ?? "Т‑Банк временно не отвечает.",
            response.status
          );
        }
        const value: unknown = await response.json();
        const result = object(value);
        if (!result) throw new BankError("Банк вернул некорректный ответ.", "RESPONSE");
        return result;
      }
      throw new BankError("Достигнут лимит запросов банка. Повторите позже.", 429);
    };
    const result = this.requestQueue.then(run, run);
    this.requestQueue = result.then(
      () => {},
      () => {}
    );
    return result;
  }
  connect(): void {
    if (this.closed) return;
    this.clock.reset();
    clearTimeout(this.reconnectTimer);
    this.callbacks.connecting();
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.close();
    }
    const socket = new WebSocket(STREAM, ["json", this.token]);
    this.socket = socket;
    let opened = false;
    socket.onopen = () => {
      if (this.closed || socket !== this.socket || opened) return;
      opened = true;
      this.lastMessage = Date.now();
      this.retry = 0;
      // Request one fresh clock sample instead of waiting for the server's default ping period.
      this.send({ ping: { time: new Date(this.lastMessage).toISOString() } });
      this.callbacks.open();
    };
    socket.onmessage = (event) => {
      if (this.closed || socket !== this.socket || typeof event.data !== "string") return;
      const receivedAt = Date.now();
      this.lastMessage = receivedAt;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      const data = object(parsed);
      if (data) {
        this.clock.observe(object(data.ping)?.time, receivedAt);
        this.callbacks.data(data);
      }
    };
    socket.onerror = () => {
      if (socket === this.socket)
        this.callbacks.error("Поток банка временно недоступен. Переподключаемся…");
    };
    socket.onclose = (event) => {
      if (this.closed || socket !== this.socket) return;
      this.callbacks.error(
        event.code === 4016
          ? "Токен недействителен или отозван."
          : "Поток прерван. Переподключаемся…"
      );
      if (event.code !== 4016)
        this.reconnectTimer = setTimeout(
          () => this.connect(),
          event.code === 4008
            ? 60000
            : Math.min(30000, 1000 * 2 ** this.retry++) + Math.random() * 500
        );
    };
    clearInterval(this.healthTimer);
    this.healthTimer = setInterval(() => {
      if (
        !this.closed &&
        socket === this.socket &&
        socket.readyState === WebSocket.OPEN &&
        Date.now() - this.lastMessage > 45000
      )
        socket.close(1000, "reconnect");
    }, 15000);
  }
  send(data: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(data));
  }
  close(): void {
    this.closed = true;
    this.clock.reset();
    this.lifetime.abort();
    clearTimeout(this.reconnectTimer);
    clearInterval(this.healthTimer);
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
  }
}
