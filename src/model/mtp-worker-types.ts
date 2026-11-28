import type { MtpWorkerRequest, MtpWorkerResponse } from "./mtp-worker-protocol.js";
import type { MtpEmergencyStats } from "./mtp-worker-emergency.js";
import type { MtpWorkerIntent } from "./mtp-worker-snapshot.js";
import type { MtpWorkerGeometry } from "./mtp-worker-geometry.js";

export interface MtpWorkerDispatched {
  id: number;
  intent: MtpWorkerIntent;
  geometry: MtpWorkerGeometry;
}

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
  now?(): number;
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
  emergency?: MtpEmergencyStats;
  reason?: string;
}
