import { BUILD_ID } from "../generated/app-version.js";
import { MTP_WORKER_PROTOCOL } from "./mtp-worker-protocol.js";
import type { MtpWorkerRequest, MtpWorkerResponse } from "./mtp-worker-protocol.js";
import { mtpWorkerIntent } from "./mtp-worker-snapshot.js";
import type { MtpWorkerIntent } from "./mtp-worker-snapshot.js";
import type { MtpRasterFrame } from "./mtp-raster-cache.js";

export interface MtpRasterWorker {
  onmessage: ((event: MessageEvent<MtpWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: MtpWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
}
export interface MtpWorkerEnvironment {
  create(): MtpRasterWorker;
  delay(action: () => void, milliseconds: number): unknown;
  cancel(timer: unknown): void;
  build: string;
}
export interface MtpWorkerStatus {
  state: "off" | "loading" | "ready" | "fallback" | "destroyed";
  pending: boolean;
  dispatched: number;
  completed: number;
  stale: number;
  reason?: string;
}
const browser: MtpWorkerEnvironment = {
  create() {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined")
      throw new Error("Worker/OffscreenCanvas unavailable");
    const url = new URL("mtp-raster-worker.js", document.baseURI);
    if (url.origin !== location.origin) throw new Error("Worker must be same-origin");
    return new Worker(url, { type: "module", name: "mtp-raster" });
  },
  delay: (action, milliseconds) => setTimeout(action, milliseconds),
  cancel: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  build: BUILD_ID
};
interface Dispatched {
  id: number;
  intent: MtpWorkerIntent;
}
interface Ready {
  key: string;
  bitmap: ImageBitmap;
}

/** One owned worker, one dispatched job, one latest intent and one owned ready bitmap. */
export class MtpWorkerRasterCache {
  private worker: MtpRasterWorker | undefined;
  private state: MtpWorkerStatus["state"] = "loading";
  private reason: string | undefined;
  private timer: unknown;
  private serial = 0;
  private dispatched = 0;
  private completed = 0;
  private stale = 0;
  private inFlight: Dispatched | undefined;
  private latest: MtpWorkerIntent | undefined;
  private desiredKey: string | undefined;
  private sentDataKey: string | undefined;
  private ready: Ready | undefined;
  private displayedKey: string | undefined;
  private needsDraw = true;
  constructor(
    private readonly requestUpdate: () => void,
    private readonly environment = browser
  ) {
    try {
      const worker = this.environment.create();
      this.worker = worker;
      worker.onmessage = ({ data }) => this.receive(data);
      worker.onerror = () => this.fail("worker-error");
      worker.onmessageerror = () => this.fail("worker-messageerror");
      this.deadline("startup-deadline");
      worker.postMessage({
        type: "hello",
        protocol: MTP_WORKER_PROTOCOL,
        build: environment.build
      });
    } catch {
      this.fail("worker-unavailable");
    }
  }
  status(): MtpWorkerStatus {
    return {
      state: this.state,
      pending: this.pending(),
      dispatched: this.dispatched,
      completed: this.completed,
      stale: this.stale,
      ...(this.reason === undefined ? {} : { reason: this.reason })
    };
  }
  pending(): boolean {
    return (
      this.state === "loading" ||
      (this.state === "ready" &&
        (this.needsDraw ||
          (this.desiredKey !== undefined && this.displayedKey !== this.desiredKey)))
    );
  }
  private cancelDeadline(): void {
    if (this.timer !== undefined) this.environment.cancel(this.timer);
    this.timer = undefined;
  }
  private deadline(reason: string): void {
    this.cancelDeadline();
    this.timer = this.environment.delay(() => this.fail(reason), 5000);
  }
  private releaseReady(): void {
    this.ready?.bitmap.close();
    this.ready = undefined;
    this.displayedKey = undefined;
  }
  private stopWorker(): void {
    if (!this.worker) return;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.onmessageerror = null;
    this.worker.terminate();
    this.worker = undefined;
  }
  private fail(reason: string): void {
    if (this.state === "fallback" || this.state === "destroyed") return;
    this.state = "fallback";
    this.reason = reason;
    this.cancelDeadline();
    this.stopWorker();
    this.releaseReady();
    this.inFlight = undefined;
    this.latest = undefined;
    this.desiredKey = undefined;
    this.requestUpdate();
  }
  private current(intent: MtpWorkerIntent): boolean {
    return (
      intent.model.revision === intent.revision &&
      intent.model.resetRevision === intent.resetRevision &&
      intent.model.data.length === intent.frame.length
    );
  }
  private dispatch(): void {
    const intent = this.latest;
    if (!intent || this.inFlight || this.state !== "ready" || !this.worker) return;
    this.latest = undefined;
    if (!this.current(intent)) {
      this.requestUpdate();
      return;
    }
    const request: MtpWorkerRequest = {
      type: "render",
      id: ++this.serial,
      key: intent.key,
      frame: intent.frame
    };
    // Copies contain only active N+1 prefix values. The model's allocation is never detached.
    const transfer: Transferable[] = [intent.frame.x.buffer];
    if (this.sentDataKey !== intent.dataKey) {
      request.prefix = intent.model.prefix.slice(0, intent.frame.length + 1);
      transfer.push(request.prefix.buffer);
    }
    this.inFlight = { id: request.id, intent };
    this.dispatched++;
    this.deadline("render-deadline");
    try {
      this.worker.postMessage(request, transfer);
      this.sentDataKey = intent.dataKey;
    } catch {
      this.fail("worker-postmessage-error");
    }
  }
  private receive(message: MtpWorkerResponse): void {
    if (this.state === "destroyed" || this.state === "fallback") {
      if (message.type === "result") message.bitmap.close();
      return;
    }
    if (message.type === "failure") {
      this.fail("worker-render-error");
      return;
    }
    if (message.type === "ready") {
      if (
        this.state !== "loading" ||
        message.protocol !== MTP_WORKER_PROTOCOL ||
        message.build !== this.environment.build
      ) {
        this.fail("worker-handshake-mismatch");
        return;
      }
      this.cancelDeadline();
      this.state = "ready";
      this.dispatch();
      this.requestUpdate();
      return;
    }
    const job = this.inFlight;
    if (!job || message.id !== job.id || message.key !== job.intent.key) {
      message.bitmap.close();
      this.fail("worker-result-mismatch");
      return;
    }
    this.cancelDeadline();
    this.inFlight = undefined;
    this.completed++;
    if (message.key === this.desiredKey && this.current(job.intent)) {
      this.releaseReady();
      this.ready = { key: message.key, bitmap: message.bitmap };
    } else {
      message.bitmap.close();
      this.stale++;
    }
    this.dispatch();
    this.requestUpdate();
  }
  /** True includes a blank pending layer; the caller must not run heavy sync paint as well. */
  draw(source: MtpRasterFrame): boolean {
    if (this.state === "fallback" || this.state === "destroyed") return false;
    const intent = mtpWorkerIntent(source);
    if (!intent) {
      // Stop an obsolete raster before allowing heavy native fallback on this draw.
      this.fail("unsupported-frame");
      return false;
    }
    this.desiredKey = intent.key;
    this.needsDraw = false;
    if (this.ready?.key === intent.key) {
      const { context } = source.scope;
      context.save();
      context.globalAlpha = 1;
      // The bitmap already contains the original stroke shadow; do not cast it again.
      context.shadowColor = "rgba(0, 0, 0, 0)";
      context.drawImage(
        this.ready.bitmap,
        0,
        0,
        intent.frame.width / intent.frame.horizontalRatio,
        intent.frame.height / intent.frame.verticalRatio
      );
      context.restore();
      this.displayedKey = intent.key;
      this.latest = undefined;
      return true;
    }
    this.releaseReady();
    this.latest = this.inFlight?.intent.key === intent.key ? undefined : intent;
    this.dispatch();
    return true;
  }
  invalidate(active = false): void {
    this.latest = undefined;
    this.desiredKey = undefined;
    this.needsDraw = active;
    this.releaseReady();
  }
  destroy(): void {
    this.state = "destroyed";
    this.cancelDeadline();
    this.stopWorker();
    this.releaseReady();
    this.inFlight = undefined;
    this.latest = undefined;
    this.desiredKey = undefined;
  }
}
