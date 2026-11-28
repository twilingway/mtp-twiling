import { BUILD_ID } from "../generated/app-version.js";
import { MTP_WORKER_PROTOCOL } from "./mtp-worker-protocol.js";
import type { MtpWorkerRequest, MtpWorkerResponse } from "./mtp-worker-protocol.js";
import { mtpWorkerIntent } from "./mtp-worker-snapshot.js";
import type { MtpWorkerIntent } from "./mtp-worker-snapshot.js";
import type { MtpRasterFrame } from "./mtp-raster-cache.js";
import {
  MTP_IDENTITY,
  mtpWorkerContentKey,
  mtpWorkerCovered,
  mtpWorkerExact,
  mtpWorkerGeometry,
  mtpWorkerMatrix
} from "./mtp-worker-geometry.js";
import type { MtpWorkerGeometry, MtpWorkerMatrix } from "./mtp-worker-geometry.js";

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
  snapshots?: number;
  previews?: number;
  quickHits?: number;
  queued?: boolean;
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
  geometry: MtpWorkerGeometry;
}
interface Ready {
  key: string;
  bitmap: ImageBitmap;
  geometry: MtpWorkerGeometry;
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
  private snapshots = 0;
  private previews = 0;
  private quickHits = 0;
  private inFlight: Dispatched | undefined;
  private latest: { intent: MtpWorkerIntent; geometry: MtpWorkerGeometry } | undefined;
  private desiredKey: string | undefined;
  private sentDataKey: string | undefined;
  private ready: Ready | undefined;
  private displayedKey: string | undefined;
  private needsDraw = true;
  private interacting = false;
  private forceBudget = 0;
  private forcedKey: string | undefined;
  private lastContentKey: string | undefined;
  private deferred: { contentKey: string; from: number; to: number } | undefined;
  private owner: MtpRasterFrame["model"] | undefined;
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
      snapshots: this.snapshots,
      previews: this.previews,
      quickHits: this.quickHits,
      queued: this.deferred !== undefined || this.latest !== undefined,
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
    this.forceBudget = 0;
    this.forcedKey = undefined;
    this.reason = reason;
    this.cancelDeadline();
    this.stopWorker();
    this.releaseReady();
    this.inFlight = undefined;
    this.latest = undefined;
    this.deferred = undefined;
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
    const job = this.latest;
    if (
      !job ||
      this.inFlight ||
      this.state !== "ready" ||
      !this.worker ||
      (this.interacting && this.forceBudget === 0)
    )
      return;
    const { intent, geometry } = job;
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
    this.inFlight = { id: request.id, intent, geometry };
    if (this.forceBudget > 0) {
      this.forceBudget = 0;
      this.forcedKey = intent.key;
    } else this.forcedKey = undefined;
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
    if (
      this.current(job.intent) &&
      (message.key === this.desiredKey ||
        (this.interacting && job.geometry.contentKey === this.lastContentKey))
    ) {
      this.releaseReady();
      this.ready = { key: message.key, bitmap: message.bitmap, geometry: job.geometry };
    } else {
      message.bitmap.close();
      this.stale++;
    }
    this.dispatch();
    this.requestUpdate();
  }
  setInteraction(active: boolean): void {
    if (this.interacting === active) return;
    this.interacting = active;
    if (active && this.forceBudget === 0 && this.forcedKey === undefined) {
      this.latest = undefined;
      this.deferred = undefined;
      this.desiredKey = undefined;
      this.needsDraw = true;
    }
  }
  forceRender(): void {
    this.forceBudget = 1;
    this.forcedKey = undefined;
    this.needsDraw = true;
  }
  private blit(
    source: MtpRasterFrame,
    ready: Ready,
    matrix: MtpWorkerMatrix,
    exact: boolean
  ): void {
    const context = source.scope.context;
    context.save();
    context.globalAlpha = 1;
    context.shadowColor = "rgba(0, 0, 0, 0)";
    context.translate(
      matrix.xOffset - matrix.xScale * ready.geometry.padX,
      matrix.yOffset - matrix.yScale * ready.geometry.padY
    );
    if (matrix.xScale !== 1 || matrix.yScale !== 1) context.scale(matrix.xScale, matrix.yScale);
    context.drawImage(ready.bitmap, 0, 0, ready.geometry.bitmapWidth, ready.geometry.bitmapHeight);
    context.restore();
    if (exact) {
      this.displayedKey = ready.key;
      this.needsDraw = false;
      this.forceBudget = 0;
      this.forcedKey = undefined;
    } else this.previews++;
  }
  private preview(source: MtpRasterFrame): void {
    if (!this.ready) return;
    const matrix = mtpWorkerMatrix(source, this.ready.geometry);
    if (matrix && mtpWorkerCovered(source, this.ready.geometry, matrix))
      this.blit(source, this.ready, matrix, false);
  }
  /** True includes a blank pending layer; the caller must not run heavy sync paint as well. */
  draw(source: MtpRasterFrame, interacting = false): boolean {
    if (this.state === "fallback" || this.state === "destroyed") return false;
    if (this.owner && this.owner !== source.model) {
      this.fail("source-owner-changed");
      return false;
    }
    this.owner = source.model;
    this.setInteraction(interacting);
    const contentKey = mtpWorkerContentKey(source);
    if (contentKey === null) {
      this.fail("unsupported-frame");
      return false;
    }
    this.lastContentKey = contentKey;
    if (this.ready && this.ready.geometry.contentKey !== contentKey) this.releaseReady();
    const candidate = [this.ready, this.inFlight, this.latest].find(
      (job) => job?.geometry.contentKey === contentKey && mtpWorkerExact(source, job.geometry)
    );
    const candidateKey =
      candidate && ("intent" in candidate ? candidate.intent.key : candidate.key);
    if (
      this.interacting &&
      this.forceBudget === 0 &&
      (this.forcedKey === undefined || candidateKey !== this.forcedKey)
    ) {
      this.forcedKey = undefined;
      this.latest = undefined;
      this.desiredKey = undefined;
      this.needsDraw = true;
      this.preview(source);
      return true;
    }
    if (candidate) {
      this.quickHits++;
      const key = "intent" in candidate ? candidate.intent.key : candidate.key;
      if (candidate === this.inFlight && this.forceBudget > 0) {
        this.forceBudget = 0;
        this.forcedKey = key;
      }
      this.desiredKey = key;
      this.needsDraw = false;
      this.deferred = undefined;
      if (candidate === this.ready) {
        this.latest = undefined;
        this.blit(source, this.ready, MTP_IDENTITY, true);
      } else {
        if (candidate === this.inFlight) this.latest = undefined;
        this.preview(source);
        this.dispatch();
      }
      return true;
    }
    if (this.state !== "ready" || this.inFlight) {
      // A busy/startup worker retains only the latest cheap intent. Its completion asks the
      // SDK for a fresh actual draw; stale captured callbacks never prepare the next raster.
      this.deferred = { contentKey, from: source.from, to: source.to };
      this.desiredKey = undefined;
      this.needsDraw = true;
      this.preview(source);
      return true;
    }
    this.deferred = undefined;
    this.snapshots++;
    const intent = mtpWorkerIntent(source);
    if (!intent) {
      // Stop an obsolete raster before allowing heavy native fallback on this draw.
      this.fail("unsupported-frame");
      return false;
    }
    this.desiredKey = intent.key;
    this.needsDraw = false;
    const geometry = mtpWorkerGeometry(source, intent, contentKey);
    if (this.ready?.key === intent.key) {
      this.blit(source, this.ready, MTP_IDENTITY, true);
      this.latest = undefined;
      return true;
    }
    if (this.ready && !this.ready.geometry.fast) this.releaseReady();
    this.preview(source);
    this.latest = { intent, geometry };
    this.dispatch();
    return true;
  }
  invalidate(active = false): void {
    this.latest = undefined;
    this.deferred = undefined;
    this.desiredKey = undefined;
    this.needsDraw = active;
    this.forcedKey = undefined;
    this.releaseReady();
  }
  destroy(): void {
    this.state = "destroyed";
    this.forceBudget = 0;
    this.forcedKey = undefined;
    this.cancelDeadline();
    this.stopWorker();
    this.releaseReady();
    this.inFlight = undefined;
    this.latest = undefined;
    this.deferred = undefined;
    this.desiredKey = undefined;
  }
}
