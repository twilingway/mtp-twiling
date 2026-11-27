import { assertCurrent, object, sha256, YANDEX_ROOT, YandexError } from "./types.js";
import type { YandexAuthorization, YandexFile, YandexReference } from "./types.js";
import { moveYandexSlot, removeYandexSlot } from "./slot-transport.js";
import type { SlotMutationAccess } from "./slot-transport.js";

const API = "https://cloud-api.yandex.net/v1/disk/resources";
const NAME =
  /^(?:[a-f\d-]{36}_[a-f\d-]{36}|probe_[a-f\d-]{36}|(?:probe_slot_[a-f\d-]{36}_|slot_)[a-f\d-]{36}_[1-9]\d{0,9}|(?:probe_stage_[a-f\d-]{36}_|stage_)[a-f\d-]{36})\.mtp$/;
const MD5 = /^[a-f\d]{32}$/;
const MAX_FILES = 10000,
  MAX_LIST_BYTES = 4 * 1024 * 1024;
export interface YandexTransportOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}
export const abortableSleep = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const cancel = () => {
        clearTimeout(timer);
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new DOMException("Cancelled", "AbortError")
        );
      },
      timer = setTimeout(() => {
        signal.removeEventListener("abort", cancel);
        resolve();
      }, milliseconds);
    signal.addEventListener("abort", cancel, { once: true });
  });
export function yandexFilePath(name: string): string {
  if (!NAME.test(name)) throw new YandexError("remote-invalid");
  return `${YANDEX_ROOT}/${name}`;
}
function transferUrl(value: unknown, method: "GET" | "PUT"): URL {
  const link = object(value);
  if (!link || link.method !== method || link.templated !== false || typeof link.href !== "string")
    throw new YandexError("remote-invalid");
  let url: URL;
  try {
    url = new URL(link.href);
  } catch {
    throw new YandexError("remote-invalid");
  }
  const host = url.hostname;
  const allowed =
    method === "PUT"
      ? /^uploader[\w-]*\.(?:dst|disk)\.yandex\.net$/.test(host)
      : /^downloader\.(?:dst|disk)\.yandex\.ru$/.test(host);
  if (
    !allowed ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.hash
  )
    throw new YandexError("remote-invalid");
  return url;
}
function file(value: unknown): YandexFile {
  const v = object(value);
  if (
    !v ||
    v.type !== "file" ||
    typeof v.name !== "string" ||
    !NAME.test(v.name) ||
    !Number.isSafeInteger(v.size) ||
    Number(v.size) < 0 ||
    typeof v.md5 !== "string" ||
    !MD5.test(v.md5) ||
    typeof v.modified !== "string" ||
    !Number.isFinite(Date.parse(v.modified))
  )
    throw new YandexError("remote-invalid");
  return {
    name: v.name,
    path: yandexFilePath(v.name),
    size: Number(v.size),
    md5: v.md5,
    modified: v.modified
  };
}
export class YandexTransport {
  private readonly fetcher: typeof fetch;
  private readonly timeout: number;
  private readonly sleep: NonNullable<YandexTransportOptions["sleep"]>;
  constructor(
    private readonly auth: YandexAuthorization,
    options: YandexTransportOptions = {}
  ) {
    this.fetcher = options.fetch ?? fetch.bind(globalThis);
    this.timeout = options.timeoutMs ?? 20000;
    this.sleep = options.sleep ?? abortableSleep;
    if (!Number.isSafeInteger(this.timeout) || this.timeout < 1 || this.timeout > 60000)
      throw new RangeError("Invalid Yandex request timeout");
  }
  private current(valid: () => boolean = () => true): string {
    assertCurrent(this.auth.signal, valid);
    return this.auth.getAccessToken();
  }
  private async request(
    url: string,
    init: RequestInit = {},
    authorized = true,
    allowed: readonly number[] = [],
    valid: () => boolean = () => true
  ): Promise<Response> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const token = this.current(valid),
        signal = AbortSignal.any([this.auth.signal, AbortSignal.timeout(this.timeout)]);
      let response: Response;
      try {
        response = await this.fetcher(url, {
          ...init,
          signal,
          credentials: "omit",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          redirect: init.redirect ?? "error",
          headers: {
            ...Object.fromEntries(new Headers(init.headers)),
            ...(authorized ? { Authorization: `OAuth ${token}` } : {})
          }
        });
      } catch {
        this.current(valid);
        if (init.method === "PUT" && !authorized) throw new YandexError("indeterminate");
        if (attempt === 3) throw new YandexError("network");
        await this.sleep(250 * 2 ** attempt, this.auth.signal);
        continue;
      }
      this.current(valid);
      if (response.ok || allowed.includes(response.status)) return response;
      if (response.status === 401) {
        this.auth.invalidate();
        throw new YandexError("auth-required", 401);
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        await response.body?.cancel().catch(() => undefined);
        // PUTs are reconciled by exact-path readback, never blindly repeated.
        if (init.method === "PUT" && !authorized) throw new YandexError("indeterminate");
        await this.sleep(250 * 2 ** attempt, this.auth.signal);
        continue;
      }
      throw new YandexError(
        response.status === 409
          ? "conflict"
          : [403, 423].includes(response.status)
            ? "permission"
            : [429, 507].includes(response.status)
              ? "quota"
              : response.status >= 500
                ? "network"
                : "remote-invalid",
        response.status
      );
    }
    throw new YandexError("network");
  }
  private async body(response: Response, maxBytes: number, prefix = false): Promise<Blob> {
    if (!prefix && Number(response.headers.get("Content-Length")) > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new YandexError("limit");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new YandexError("remote-invalid");
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    const cancel = () => {
      void reader.cancel().catch(() => undefined);
    };
    this.auth.signal.addEventListener("abort", cancel, { once: true });
    try {
      for (;;) {
        this.current();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const next = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new YandexError("network"));
              cancel();
            }, this.timeout);
          })
        ]).finally(() => clearTimeout(timer));
        this.current();
        if (next.done) break;
        if (prefix && size + next.value.byteLength >= maxBytes) {
          chunks.push(new Uint8Array(next.value.slice(0, maxBytes - size)));
          break;
        }
        size += next.value.byteLength;
        if (size > maxBytes) throw new YandexError("limit");
        chunks.push(new Uint8Array(next.value));
      }
      return new Blob(chunks);
    } finally {
      this.auth.signal.removeEventListener("abort", cancel);
      cancel();
    }
  }
  private async json(response: Response): Promise<unknown> {
    try {
      return JSON.parse(await (await this.body(response, MAX_LIST_BYTES)).text()) as unknown;
    } catch (error) {
      if (error instanceof YandexError) throw error;
      throw new YandexError("remote-invalid");
    }
  }
  private api(path: string, params: Record<string, string>): string {
    return `${API}${path}?${new URLSearchParams(params)}`;
  }
  async ensureRoot(valid: () => boolean = () => true): Promise<void> {
    const response = await this.request(
      this.api("", { path: YANDEX_ROOT }),
      { method: "PUT" },
      true,
      [409],
      valid
    );
    await response.body?.cancel().catch(() => undefined);
  }
  async list(): Promise<YandexFile[]> {
    const result = new Map<string, YandexFile>();
    let offset = 0,
      expectedTotal: number | undefined;
    for (let page = 0; page < 101; page++) {
      const response = await this.request(
        this.api("", {
          path: YANDEX_ROOT,
          limit: "100",
          offset: String(offset),
          sort: "name",
          fields:
            "_embedded.items.name,_embedded.items.size,_embedded.items.md5,_embedded.items.type,_embedded.items.modified,_embedded.total"
        }),
        {},
        true,
        [404]
      );
      if (response.status === 404) {
        await response.body?.cancel();
        if (offset > 0) throw new YandexError("conflict");
        return [];
      }
      const embedded = object(object(await this.json(response))?._embedded);
      if (
        !embedded ||
        !Array.isArray(embedded.items) ||
        embedded.items.length > 100 ||
        !Number.isSafeInteger(embedded.total) ||
        Number(embedded.total) > MAX_FILES ||
        Number(embedded.total) < 0
      )
        throw new YandexError("limit");
      if (expectedTotal !== undefined && expectedTotal !== embedded.total)
        throw new YandexError("conflict");
      expectedTotal = Number(embedded.total);
      for (const value of embedded.items) {
        const v = object(value);
        if (!v || typeof v.name !== "string") throw new YandexError("remote-invalid");
        if (!v.name.endsWith(".mtp")) continue;
        const item = file(value);
        if (result.has(item.name)) throw new YandexError("conflict");
        result.set(item.name, item);
      }
      offset += embedded.items.length;
      if (offset === expectedTotal) return [...result.values()];
      if (offset > expectedTotal || embedded.items.length === 0) throw new YandexError("conflict");
    }
    throw new YandexError("limit");
  }
  async metadata(name: string): Promise<YandexFile | undefined> {
    const response = await this.request(
      this.api("", { path: yandexFilePath(name), fields: "name,size,md5,type,modified" }),
      {},
      true,
      [404]
    );
    if (response.status === 404) {
      await response.body?.cancel();
      return undefined;
    }
    const result = file(await this.json(response));
    if (result.name !== name) throw new YandexError("remote-invalid");
    return result;
  }
  async read(item: YandexFile, maxBytes: number): Promise<Blob> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || item.size > maxBytes)
      throw new YandexError("limit");
    const content = await this.content(item);
    if (content.status !== 200) throw new YandexError("remote-invalid");
    const body = await this.body(content, maxBytes);
    if (body.size !== item.size) throw new YandexError("remote-invalid");
    return body;
  }
  async readPrefix(item: YandexFile, maxBytes: number): Promise<Blob> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 12 || maxBytes > 256 * 1024 + 12)
      throw new YandexError("limit");
    if (item.size < 12) throw new YandexError("remote-invalid");
    const end = Math.min(maxBytes, item.size) - 1;
    const response = await this.content(item, { Range: `bytes=0-${end}` });
    if (![200, 206].includes(response.status)) throw new YandexError("remote-invalid");
    if (response.status === 206) {
      const header = response.headers.get("Content-Range"),
        range = /^bytes 0-(\d+)\/(\d+)$/.exec(header ?? "");
      if (header !== null && (!range || Number(range[1]) !== end || Number(range[2]) !== item.size))
        throw new YandexError("remote-invalid");
    }
    const body = await this.body(response, end + 1, true);
    if (body.size !== end + 1) throw new YandexError("remote-invalid");
    return body;
  }
  private async content(item: YandexFile, headers: Record<string, string> = {}): Promise<Response> {
    const response = await this.request(this.api("/download", { path: yandexFilePath(item.name) })),
      url = transferUrl(await this.json(response), "GET");
    const content = await this.request(url.href, { redirect: "follow", headers });
    if (content.url) {
      const final = new URL(content.url);
      if (
        final.protocol !== "https:" ||
        !(final.origin === url.origin || /^[\w-]+\.storage\.yandex\.net$/.test(final.hostname))
      ) {
        await content.body?.cancel();
        throw new YandexError("remote-invalid");
      }
    }
    return content;
  }
  async putImmutable(
    name: string,
    body: Blob,
    reference: YandexReference,
    valid: () => boolean = () => true
  ): Promise<YandexFile> {
    if (body.size !== reference.size || (await sha256(body)) !== reference.sha256)
      throw new YandexError("remote-invalid");
    this.current(valid);
    const existing = await this.metadata(name);
    this.current(valid);
    if (existing) return this.verify(existing, reference);
    await this.ensureRoot(valid);
    this.current(valid);
    try {
      const response = await this.request(
          this.api("/upload", { path: yandexFilePath(name), overwrite: "false" })
        ),
        url = transferUrl(await this.json(response), "PUT");
      this.current(valid);
      const uploaded = await this.request(url.href, { method: "PUT", body }, false, [], valid);
      if (![201, 202].includes(uploaded.status)) throw new YandexError("indeterminate");
      await uploaded.body?.cancel().catch(() => undefined);
    } catch (error) {
      this.current(valid);
      if (
        !(error instanceof YandexError) ||
        !["indeterminate", "conflict", "network"].includes(error.code)
      )
        throw error;
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const item = await this.metadata(name);
      if (item) return this.verify(item, reference);
      if (attempt < 4) await this.sleep(250 * 2 ** attempt, this.auth.signal);
    }
    throw new YandexError("indeterminate");
  }
  private async verify(item: YandexFile, expected: YandexReference): Promise<YandexFile> {
    if (
      item.size !== expected.size ||
      (await sha256(await this.read(item, expected.size))) !== expected.sha256
    )
      throw new YandexError("conflict");
    return item;
  }
  private slotAccess(): SlotMutationAccess {
    return {
      auth: this.auth,
      request: (url, init, allowed, valid) => this.request(url, init, true, allowed, valid),
      json: (response) => this.json(response),
      metadata: (name) => this.metadata(name),
      read: (file, limit) => this.read(file, limit),
      sleep: this.sleep
    };
  }
  moveImmutable(
    from: string,
    destination: string,
    reference: YandexReference,
    valid: () => boolean = () => true,
    outcome?: (status: number) => void
  ): Promise<YandexFile> {
    return moveYandexSlot(this.slotAccess(), from, destination, reference, valid, outcome);
  }
  removeExact(file: YandexFile, valid: () => boolean = () => true): Promise<void> {
    return removeYandexSlot(this.slotAccess(), file, valid);
  }
  /** Only explicit probe cleanup; regular synchronization never invokes physical deletion. */
  async removeProbe(item: YandexFile): Promise<void> {
    if (!item.name.startsWith("probe_")) throw new YandexError("permission");
    const response = await this.request(
      this.api("", { path: yandexFilePath(item.name), md5: item.md5, permanently: "true" }),
      { method: "DELETE" },
      true,
      [404]
    );
    if (response.status !== 204 && response.status !== 404) throw new YandexError("indeterminate");
    await response.body?.cancel().catch(() => undefined);
  }
}
