import type { Drawing, ImageAsset } from "../../model/types.js";
import * as storage from "../../services/storage-v2.js";

type AnnotationDocument = { drawings: Drawing[]; images: ImageAsset[] };
type Change = AnnotationDocument & { owner: string; symbol: string; editor: object };
type Pending = { change: Change; write: Promise<void> };
const writes = new Map<string, Pending>();
const listeners = new Set<(change: Change) => void>();
let generation = 0;

export function subscribeWorkspaceAnnotations(accept: (change: Change) => void): () => void {
  listeners.add(accept);
  return () => listeners.delete(accept);
}

export function writeWorkspaceAnnotations(change: Change): Promise<void> {
  const { owner, symbol, drawings, images } = change;
  const key = JSON.stringify([owner, symbol]);
  const queued = writes.get(key)?.write.catch(() => {});
  const write = Promise.resolve(queued).then(() =>
    storage.saveAnnotationDocument(owner, symbol, drawings, images)
  );
  writes.set(key, { change, write });
  generation++;
  listeners.forEach((accept) => accept(change));
  const forget = () => {
    if (writes.get(key)?.write === write) writes.delete(key);
  };
  void write.then(forget, forget);
  return write;
}

export async function readWorkspaceAnnotations(
  owner: string,
  symbol: string
): Promise<AnnotationDocument> {
  const key = JSON.stringify([owner, symbol]);
  const pending = writes.get(key)?.change;
  if (pending) return { drawings: pending.drawings, images: pending.images };
  const before = generation;
  const [drawings, images] = await Promise.all([
    storage.loadDrawings(owner, symbol),
    storage.loadImages(owner, symbol)
  ]);
  return before === generation ? { drawings, images } : readWorkspaceAnnotations(owner, symbol);
}

export async function flushWorkspaceAnnotations(owner: string): Promise<void> {
  await Promise.all(
    [...writes.values()].filter(({ change }) => change.owner === owner).map(({ write }) => write)
  );
}
