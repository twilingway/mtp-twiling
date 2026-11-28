import { drawingToolbarSettings, TOOL_GROUP } from "../../model/drawing-toolbar.js";
import type {
  DrawingCursor,
  DrawingTarget,
  DrawingToolbarSettings
} from "../../model/drawing-toolbar.js";
import type { DrawingTool, IndicatorKey } from "../../model/types.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import type { TerminalController } from "./controller.js";
import { drawingCreationContext } from "./drawing-creation-draft.js";
import { importWritable } from "./controller-transfer-guard.js";
import { validSettingsDrawing } from "./drawings/drawing-settings-model.js";

/** Profile-scoped actions shared by the toolbar and keyboard shortcuts. */
export class TerminalDrawingTools {
  pendingDeletion:
    | ({ scope: string } & (
        { kind: "object"; id: string } | { kind: "bulk"; target: DrawingTarget }
      ))
    | null = null;
  private writes: Promise<void> = Promise.resolve();
  private toolIntent = 0;
  constructor(private readonly controller: TerminalController) {}
  scopeKey = (): string => {
    const state = this.controller.getSnapshot();
    return JSON.stringify([
      state.owner,
      state.preferences.symbol,
      selectedMarketRow(state.rows, state.preferences)?.uid
    ]);
  };
  private enqueue(action: () => Promise<void>): Promise<void> {
    const owner = this.controller.getSnapshot().owner;
    const next = this.writes.then(async () => {
      if (this.controller.getSnapshot().owner === owner) await action();
    });
    this.writes = next.catch(() => {});
    return next;
  }
  setOptions = (patch: DrawingToolbarSettings): Promise<void> =>
    this.enqueue(async () => {
      const settings = this.controller.getSnapshot().preferences.chartSettings;
      await this.controller.setChartSettings({
        drawingTools: {
          ...settings.drawingTools,
          ...patch,
          ...(patch.magnet === "weak" || patch.magnet === "strong"
            ? { magnetStrength: patch.magnet }
            : {})
        }
      });
    });
  toggleOption = (key: "snapIndicators" | "stayInDrawingMode" | "deleteLocked"): Promise<void> =>
    this.enqueue(async () => {
      const options = drawingToolbarSettings(
        this.controller.getSnapshot().preferences.chartSettings
      );
      await this.controller.setChartSettings({
        drawingTools: { ...options, [key]: !options[key] }
      });
    });
  private changeTool(
    tool: DrawingTool | null,
    apply: (current?: () => boolean) => Promise<void>
  ): Promise<void> {
    const intent = ++this.toolIntent;
    const state = this.controller.getSnapshot(),
      draft = state.drawingCreationDraft,
      creation = this.controller.drawingCreation;
    if (draft && !validSettingsDrawing(draft.drawing)) creation.cancel(draft.token);
    const pending =
      draft && validSettingsDrawing(draft.drawing)
        ? () => creation.commit(draft.token, draft.drawing)
        : () => creation?.pendingCommit() ?? null;
    // Ordinary toolbar selection remains synchronous when there is nothing to save.
    if (!draft && !creation?.pendingCommit()) {
      this.controller.setTool(tool);
      return apply();
    }
    const context = drawingCreationContext(state),
      session = this.controller.sessionKey();
    let cancelled = false;
    const current = () => {
      const next = this.controller.getSnapshot();
      return (
        !cancelled &&
        intent === this.toolIntent &&
        this.controller.sessionKey() === session &&
        importWritable(next) &&
        drawingCreationContext(next) === context &&
        (!next.drawingCreationDraft || next.drawingCreationDraft.token === draft?.token)
      );
    };
    const unsubscribe = this.controller.subscribe(() => {
      if (!current()) cancelled = true;
    });
    return (async () => {
      try {
        const saving = pending();
        if ((saving && !(await saving)) || !current()) return;
        this.controller.setTool(tool);
        await apply(current);
      } finally {
        unsubscribe();
      }
    })();
  }
  choose = (tool: DrawingTool | null): Promise<void> =>
    this.changeTool(tool, (current) => {
      const group = tool ? TOOL_GROUP[tool] : undefined;
      if (!group || !tool) return Promise.resolve();
      return this.enqueue(async () => {
        if (current && !current()) return;
        const settings = this.controller.getSnapshot().preferences.chartSettings;
        const options = drawingToolbarSettings(settings);
        await this.controller.setChartSettings(
          {
            drawingTools: {
              ...options,
              cursor: "crosshair",
              lastTools: { ...options.lastTools, [group]: tool }
            }
          },
          current
        );
      });
    });
  setCursor = (cursor: DrawingCursor): Promise<void> =>
    this.changeTool(null, (current) => {
      return this.enqueue(async () => {
        if (current && !current()) return;
        const options = drawingToolbarSettings(
          this.controller.getSnapshot().preferences.chartSettings
        );
        await this.controller.setChartSettings(
          {
            drawingTools: {
              ...options,
              cursor,
              lastTools: { ...options.lastTools, cursors: cursor }
            }
          },
          current
        );
      });
    });
  toggleMagnet = (): Promise<void> =>
    this.enqueue(async () => {
      const options = drawingToolbarSettings(
        this.controller.getSnapshot().preferences.chartSettings
      );
      await this.controller.setChartSettings({
        drawingTools: {
          ...options,
          magnet: options.magnet === "off" ? options.magnetStrength : "off"
        }
      });
    });
  toggleSelectedLock = (): Promise<void> => {
    const selected = this.controller.getSnapshot().selectedObject;
    const scope = this.scopeKey();
    if (!selected) return Promise.resolve();
    return this.enqueue(async () => {
      if (this.scopeKey() !== scope || this.controller.getSnapshot().selectedObject !== selected)
        return;
      this.controller.editing.cancelGesture();
      const state = this.controller.getSnapshot();
      if (
        state.selectedObject !== selected ||
        drawingToolbarSettings(state.preferences.chartSettings).drawingsLocked
      )
        return;
      const drawing = state.drawings.find((item) => item.id === selected);
      if (drawing)
        await this.controller.editing.change({
          drawings: state.drawings.map((item) =>
            item.id === selected ? { ...item, lock: !item.lock } : item
          )
        });
      else if (state.images.some((item) => item.id === selected))
        await this.controller.editing.change({
          images: state.images.map((item) =>
            item.id === selected ? { ...item, lock: !item.lock } : item
          )
        });
    });
  };
  toggleLock = (target?: DrawingTarget): Promise<void> =>
    this.enqueue(async () => {
      this.controller.editing.cancelGesture();
      const options = drawingToolbarSettings(
        this.controller.getSnapshot().preferences.chartSettings
      );
      const selected = target ?? options.lockTarget;
      const active =
        selected === "all"
          ? options.drawingsLocked && options.indicatorsLocked
          : selected === "drawings"
            ? options.drawingsLocked
            : options.indicatorsLocked;
      await this.controller.setChartSettings({
        drawingTools: {
          ...options,
          lockTarget: selected,
          drawingsLocked: selected !== "indicators" && !active,
          indicatorsLocked: selected !== "drawings" && !active
        }
      });
    });
  toggleHide = (target?: DrawingTarget): Promise<void> =>
    this.enqueue(async () => {
      this.controller.editing.cancelGesture();
      const options = drawingToolbarSettings(
        this.controller.getSnapshot().preferences.chartSettings
      );
      const selected = target ?? options.hideTarget;
      const active =
        selected === "all"
          ? options.drawingsHidden && options.indicatorsHidden
          : selected === "drawings"
            ? options.drawingsHidden
            : options.indicatorsHidden;
      await this.controller.setChartSettings({
        drawingTools: {
          ...options,
          hideTarget: selected,
          drawingsHidden: selected !== "indicators" && !active,
          indicatorsHidden: selected !== "drawings" && !active
        }
      });
    });
  toggleFavorite = (id: string): Promise<void> =>
    this.enqueue(async () => {
      const settings = this.controller.getSnapshot().preferences.chartSettings;
      const options = drawingToolbarSettings(settings);
      await this.controller.setChartSettings({
        drawingTools: {
          ...options,
          favorites: options.favorites.includes(id)
            ? options.favorites.filter((item) => item !== id)
            : [...options.favorites, id].slice(-100)
        }
      });
    });
  deleteObject = async (
    id: string,
    forceLocked = false,
    expectedScope = this.scopeKey()
  ): Promise<void> => {
    if (expectedScope !== this.scopeKey()) return;
    this.controller.editing.cancelGesture();
    await this.controller.editing.flush();
    if (expectedScope !== this.scopeKey()) return;
    const state = this.controller.getSnapshot();
    const item =
      state.drawings.find((drawing) => drawing.id === id) ??
      state.images.find((image) => image.id === id);
    if (!item) return;
    const options = drawingToolbarSettings(state.preferences.chartSettings);
    if ((item.lock || options.drawingsLocked) && !forceLocked && !options.deleteLocked) {
      this.pendingDeletion = { kind: "object", id, scope: expectedScope };
      this.controller.setDialog("delete-object");
      return;
    }
    await this.controller.editing.change({
      drawings: state.drawings.filter((drawing) => drawing.id !== id),
      images: state.images.filter((image) => image.id !== id),
      selectedObject: state.selectedObject === id ? null : state.selectedObject
    });
  };
  remove = async (
    target: DrawingTarget,
    forceLocked = false,
    expectedScope?: string
  ): Promise<boolean> => {
    const scope = this.scopeKey();
    if (expectedScope !== undefined && expectedScope !== scope) return true;
    this.controller.editing.cancelGesture();
    await this.controller.editing.flush();
    if (scope !== this.scopeKey()) return true;
    const state = this.controller.getSnapshot();
    const options = drawingToolbarSettings(state.preferences.chartSettings);
    const drawings = target !== "indicators";
    const hasIndicators = (Object.keys(state.preferences.indicators) as IndicatorKey[]).some(
      (key) => !state.preferences.chartSettings.removedIndicators?.includes(key)
    );
    if (
      !forceLocked &&
      !options.deleteLocked &&
      ((drawings &&
        state.drawings.length + state.images.length > 0 &&
        (options.drawingsLocked ||
          [...state.drawings, ...state.images].some((item) => item.lock))) ||
        (target !== "drawings" && hasIndicators && options.indicatorsLocked))
    )
      return false;
    if (drawings)
      await this.controller.editing.change({ drawings: [], images: [], selectedObject: null });
    if (scope !== this.scopeKey()) return true;
    if (target !== "drawings") {
      const current = this.controller.getSnapshot();
      const keys = Object.keys(current.preferences.indicators) as IndicatorKey[];
      const indicators = { ...current.preferences.indicators };
      for (const key of keys) indicators[key] = false;
      await this.controller.setPreferences({
        indicators,
        chartSettings: {
          ...current.preferences.chartSettings,
          removedIndicators: keys
        }
      });
    }
    return true;
  };
  requestRemove = async (target: DrawingTarget): Promise<void> => {
    const scope = this.scopeKey();
    if ((await this.remove(target, false, scope)) || scope !== this.scopeKey()) return;
    this.pendingDeletion = { kind: "bulk", target, scope };
    this.controller.setDialog("delete-object");
  };
}
