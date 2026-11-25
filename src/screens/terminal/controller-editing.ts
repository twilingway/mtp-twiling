import * as storage from "../../services/storage.js";
import {
  DrawingUndoHistory,
  copyDrawing,
  copyImage,
  encodeDrawingClipboard,
  encodeImageClipboard,
  objectSnapshot,
  parseObjectClipboard,
  sameScope
} from "../../model/drawing-editing.js";
import type { ClipboardPlacement, ObjectSnapshot } from "../../model/drawing-editing.js";
import { isDrawing } from "../../model/backup-format.js";
import type { Drawing, DrawingPoint, ImageAsset } from "../../model/types.js";
import type { ChartAdapter } from "../../charts/adapter.js";
import type { TerminalState } from "./state.js";
import { importWritable } from "./controller-transfer-guard.js";

interface EditingBridge {
  getState(): TerminalState;
  getChart(): ChartAdapter | null;
  update(patch: Partial<TerminalState>): void;
  notify(message: string): void;
}
export class TerminalEditing {
  private readonly history = new DrawingUndoHistory();
  private gesture: ObjectSnapshot | null = null;
  private generation = 0;
  private writes: Promise<void> = Promise.resolve();
  private readonly writeErrors = new Map<string, Error>();
  private clipboard: {
    token: string;
    owner: string;
    image?: ImageAsset;
    placement?: ClipboardPlacement | undefined;
  } | null = null;
  private readonly invalidTokens = new Set<string>();
  private readonly issuedTokens = new Set<string>();
  constructor(private readonly bridge: EditingBridge) {}
  private snapshot(): ObjectSnapshot {
    const state = this.bridge.getState();
    return objectSnapshot({ ...state, symbol: state.preferences.symbol });
  }
  private apply(snapshot: ObjectSnapshot): void {
    this.bridge.update({
      drawings: snapshot.drawings,
      images: snapshot.images,
      selectedObject: snapshot.selectedObject
    });
  }
  private persist(after: ObjectSnapshot): Promise<void> {
    // Capture the scope before awaiting; never write one instrument into another.
    const key = JSON.stringify([after.owner, after.symbol]);
    const write = this.writes.then(async () => {
      await storage.saveAnnotationDocument(after.owner, after.symbol, after.drawings, after.images);
      this.writeErrors.delete(key);
    });
    this.writes = write.catch((error: unknown) => {
      this.writeErrors.set(
        key,
        error instanceof Error
          ? error
          : new Error("Не удалось сохранить разметку.", { cause: error })
      );
      this.bridge.notify(error instanceof Error ? error.message : "Не удалось сохранить разметку.");
    });
    return write;
  }
  flush = async (): Promise<void> => {
    await this.writes;
    const error = this.writeErrors.values().next().value;
    if (error) throw error;
  };
  change(
    patch: Partial<Pick<TerminalState, "drawings" | "images" | "selectedObject">>
  ): Promise<void> {
    if (!importWritable(this.bridge.getState())) return Promise.resolve();
    if (this.gesture) {
      this.cancelGesture();
      return Promise.resolve();
    }
    const before = this.snapshot();
    this.bridge.update(patch);
    const after = this.snapshot();
    if (!this.history.record(before, after)) return Promise.resolve();
    return this.persist(after);
  }
  beginGesture = (): number => {
    if (!importWritable(this.bridge.getState())) return -1;
    this.cancelGesture();
    this.gesture = this.snapshot();
    return ++this.generation;
  };
  previewGesture = (
    token: number,
    patch: Partial<Pick<TerminalState, "drawings" | "images" | "selectedObject">>
  ): void => {
    if (!importWritable(this.bridge.getState())) return;
    if (token === this.generation && this.gesture && sameScope(this.gesture, this.snapshot()))
      this.bridge.update(patch);
  };
  finishGesture = (token: number): Promise<void> => {
    if (!importWritable(this.bridge.getState())) return Promise.resolve();
    const before = this.gesture;
    if (token !== this.generation || !before) return Promise.resolve();
    this.gesture = null;
    const after = this.snapshot();
    if (!this.history.record(before, after)) return Promise.resolve();
    return this.persist(after);
  };
  cancelGesture = (): void => {
    const before = this.gesture;
    this.gesture = null;
    this.generation++;
    if (before && sameScope(before, this.snapshot())) this.apply(before);
  };
  gestureActive = (token: number): boolean => token === this.generation && this.gesture !== null;
  reset = (): void => {
    this.cancelGesture();
    this.history.clear();
    for (const token of this.issuedTokens) this.invalidTokens.add(token);
    this.issuedTokens.clear();
    this.clipboard = null;
  };
  undo = async (): Promise<void> => {
    if (!importWritable(this.bridge.getState())) return;
    if (this.gesture) {
      this.cancelGesture();
      return;
    }
    const before = this.snapshot(),
      after = this.history.undo(before);
    if (!after) return;
    this.apply(after);
    await this.persist(after);
  };
  redo = async (): Promise<void> => {
    if (!importWritable(this.bridge.getState())) return;
    this.cancelGesture();
    const before = this.snapshot(),
      after = this.history.redo(before);
    if (!after) return;
    this.apply(after);
    await this.persist(after);
  };
  setImages = (images: ImageAsset[]): Promise<void> => this.change({ images });
  private placement(points: DrawingPoint[]): ClipboardPlacement | undefined {
    const chart = this.bridge.getChart();
    if (!chart) return undefined;
    const size = chart.plotSize();
    if (size.width <= 0 || size.height <= 0) return undefined;
    const pixels = points.map((point) => chart.pointToPixel(point));
    if (pixels.some((point) => !point)) return undefined;
    return {
      symbol: this.bridge.getState().preferences.symbol,
      points: pixels.flatMap((point) =>
        point ? [{ x: point.x / size.width, y: point.y / size.height }] : []
      )
    };
  }
  copySelected = (): string | null => {
    if (!importWritable(this.bridge.getState())) return null;
    this.cancelGesture();
    const state = this.bridge.getState(),
      token = crypto.randomUUID();
    const drawing = state.drawings.find((item) => item.id === state.selectedObject);
    if (drawing) {
      const text = encodeDrawingClipboard(drawing, token, this.placement(drawing.points));
      if (text) {
        this.clipboard = { owner: state.owner, token };
        this.issuedTokens.add(token);
      }
      return text;
    }
    const image = state.images.find((item) => item.id === state.selectedObject);
    if (!image) return null;
    this.clipboard = {
      owner: state.owner,
      token,
      image: { ...image, point: { ...image.point } },
      placement: this.placement([image.point])
    };
    this.issuedTokens.add(token);
    return encodeImageClipboard(token);
  };
  acceptsClipboard = (text: string): boolean => {
    const payload = parseObjectClipboard(text);
    return (
      !!payload &&
      !this.invalidTokens.has(payload.token) &&
      (payload.kind === "drawing" ||
        (this.clipboard?.token === payload.token &&
          this.clipboard.owner === this.bridge.getState().owner &&
          !!this.clipboard.image))
    );
  };
  paste = async (text: string): Promise<boolean> => {
    const payload = parseObjectClipboard(text),
      state = this.bridge.getState();
    if (!payload || this.invalidTokens.has(payload.token)) return false;
    if (payload.kind === "drawing") {
      await this.clone(payload.drawing, payload.placement);
      return true;
    }
    const clipboard = this.clipboard;
    if (!clipboard?.image || clipboard.owner !== state.owner || clipboard.token !== payload.token)
      return false;
    await this.clone(clipboard.image, clipboard.placement);
    return true;
  };
  clone = async (object: Drawing | ImageAsset, placement?: ClipboardPlacement): Promise<void> => {
    if (!importWritable(this.bridge.getState())) return;
    this.cancelGesture();
    const chart = this.bridge.getChart(),
      state = this.bridge.getState();
    if (!chart) return;
    if (placement && placement.symbol !== state.preferences.symbol) {
      const size = chart.plotSize();
      const points = placement.points.map((point) =>
        chart.pixelToPoint(point.x * size.width, point.y * size.height)
      );
      if (points.some((point) => !point)) {
        this.bridge.notify("Не удалось определить координаты копии.");
        return;
      }
      if ("blob" in object) {
        const point = points[0];
        if (!point) return;
        object = { ...object, point };
      } else {
        const remapped: unknown = { ...object, points };
        if (!isDrawing(remapped)) return;
        object = remapped;
      }
    }
    const offset = { x: 0, y: -40 };
    if ("blob" in object) {
      const image = copyImage(
        object,
        { owner: state.owner, symbol: state.preferences.symbol },
        chart,
        offset
      );
      if (image) await this.change({ images: [...state.images, image], selectedObject: image.id });
      else this.bridge.notify("Не удалось определить координаты копии.");
    } else {
      const drawing = copyDrawing(object, chart, offset);
      if (drawing)
        await this.change({ drawings: [...state.drawings, drawing], selectedObject: drawing.id });
      else this.bridge.notify("Не удалось определить координаты копии.");
    }
  };
}
