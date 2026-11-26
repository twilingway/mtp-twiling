import { t, systemText } from "../../../i18n/messages.js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TOOL_NAMES } from "../../../model/drawing-model.js";
import type {
  Drawing,
  DrawingPoint,
  DrawingTemplate,
  DrawingVisibility,
  FibLevelStyle,
  VisibilityRule
} from "../../../model/types.js";
import { useTerminal } from "../context.js";
import { DrawingTemplateMenu } from "./DrawingTemplateMenu.js";
import { DrawingStylePopover } from "./DrawingStylePopover.js";
import type { ColorTarget } from "./DrawingStylePopover.js";
import { defaultVisibility, initialSettings, settingsCandidate } from "./drawing-settings-model.js";
import type { DraftSettings, SettingsDraft } from "./drawing-settings-model.js";
import { DrawingStyleFields } from "./DrawingStyleFields.js";
import { DrawingCoordinatesFields } from "./DrawingCoordinatesFields.js";
import { DrawingVisibilityFields } from "./DrawingVisibilityFields.js";
import { LockIcon } from "../VisibilityIcon.js";

export function DrawingSettingsDialog() {
  const { state } = useTerminal();
  const drawing = state.drawings.find((item) => item.id === state.selectedObject);
  return state.dialog === "drawing-settings" && drawing ? (
    <DrawingSettingsForm key={drawing.id} drawing={drawing} />
  ) : null;
}
function DrawingSettingsForm({ drawing }: { drawing: Drawing }) {
  const { controller } = useTerminal();
  const ref = useRef<HTMLDialogElement>(null);
  const original = useRef(drawing);
  const token = useRef<string | null>(null);
  const mounted = useRef(false);
  const committing = useRef(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<SettingsDraft>(() => ({
    ...structuredClone(drawing),
    settings: initialSettings(drawing),
    visibility: { ...defaultVisibility(), ...structuredClone(drawing.visibility) }
  }));
  const [tab, setTab] = useState<"style" | "coordinates" | "visibility">("style");
  const [error, setError] = useState("");
  const [colorTarget, setColorTarget] = useState<ColorTarget | null>(null);
  const settings = draft.settings;
  const drawingLockLabel = draft.lock ? t("Разблокировать объект") : t("Заблокировать объект");
  const close = () => {
    if (token.current) controller.drawingSettings.cancel(token.current);
    controller.setDialog(null);
  };
  useLayoutEffect(() => {
    mounted.current = true;
    const initial = original.current;
    const current = controller.getSnapshot().drawings.find((item) => item.id === initial.id);
    if (current === initial) token.current = controller.drawingSettings.begin(initial.id);
    return () => {
      mounted.current = false;
      if (token.current) controller.drawingSettings.cancel(token.current);
      token.current = null;
    };
  }, [controller]);
  useLayoutEffect(() => {
    const item = settingsCandidate(draft);
    if (token.current && item) controller.drawingSettings.preview(token.current, item);
  }, [controller, draft]);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const change = <K extends keyof DraftSettings>(key: K, value: DraftSettings[K]) =>
    setDraft((previous) => ({ ...previous, settings: { ...previous.settings, [key]: value } }));
  const point = (index: number, patch: Partial<DrawingPoint>) =>
    setDraft((previous) =>
      previous.lock
        ? previous
        : {
            ...previous,
            points: previous.points.map((value, i) =>
              i === index ? { ...value, ...patch } : value
            )
          }
    );
  const level = (index: number, patch: Partial<FibLevelStyle>) =>
    change(
      "levelStyles",
      settings.levelStyles.map((value, i) => (i === index ? { ...value, ...patch } : value))
    );
  const visibility = (group: keyof DrawingVisibility, patch: Partial<VisibilityRule>) =>
    setDraft((previous) => ({
      ...previous,
      visibility: { ...previous.visibility, [group]: { ...previous.visibility[group], ...patch } }
    }));
  const candidate = (): Drawing | null => {
    const item = settingsCandidate(draft);
    setError(item ? "" : t("Проверьте координаты, уровни (от −100 до 100) и диапазоны видимости."));
    return item;
  };
  const save = async () => {
    if (committing.current) return;
    const item = candidate();
    if (!item) return;
    if (!token.current) {
      setError(t("Контекст рисунка изменился. Откройте настройки снова."));
      return;
    }
    committing.current = true;
    setSaving(true);
    try {
      const saved = await controller.drawingSettings.commit(token.current, item);
      if (!mounted.current) return;
      if (saved) close();
      else setError(t("Контекст рисунка изменился. Откройте настройки снова."));
    } catch (reason) {
      if (mounted.current)
        setError(reason instanceof Error ? reason.message : t("Не удалось сохранить рисунок."));
    } finally {
      committing.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  const applyTemplate = (template: DrawingTemplate) =>
    setDraft((previous) => ({
      ...previous,
      settings: initialSettings({ ...template, name: previous.name }),
      visibility: { ...defaultVisibility(), ...structuredClone(template.visibility) }
    }));
  const setColor = (color: string) => {
    if (colorTarget?.kind === "level") level(colorTarget.index, { color });
    else if (colorTarget?.kind === "text") change("textColor", color);
    else change(colorTarget?.kind === "trend" ? "trendColor" : "color", color);
  };
  return (
    <dialog id="drawing-settings" ref={ref} onCancel={close} onClose={close}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <header>
          <h2>{t(TOOL_NAMES[draft.name])}</h2>
          <button
            type="button"
            className="selected-drawing-lock"
            aria-label={drawingLockLabel}
            title={drawingLockLabel}
            aria-pressed={!!draft.lock}
            onClick={() => setDraft((previous) => ({ ...previous, lock: !previous.lock }))}
          >
            <LockIcon locked={!!draft.lock} />
          </button>
          <button type="button" aria-label={t("Закрыть настройки")} onClick={close}>
            ×
          </button>
        </header>
        <label className="drawing-title">
          <input
            name="title"
            aria-label={t("Название объекта")}
            placeholder={t("Название объекта")}
            value={draft.title ?? ""}
            maxLength={300}
            onChange={(event) => setDraft({ ...draft, title: event.currentTarget.value })}
          />
        </label>
        <nav className="settings-tabs" aria-label={t("Разделы настроек")}>
          {(["style", "coordinates", "visibility"] as const).map((key) => (
            <button
              type="button"
              key={key}
              data-tab={key}
              className={tab === key ? "active" : ""}
              onClick={() => {
                setTab(key);
                setColorTarget(null);
              }}
            >
              {key === "style"
                ? t("Стиль")
                : key === "coordinates"
                  ? t("Координаты")
                  : t("Видимость")}
            </button>
          ))}
        </nav>
        <section data-settings-page="style" hidden={tab !== "style"}>
          <DrawingStyleFields
            name={draft.name}
            settings={settings}
            change={change}
            level={level}
            setColorTarget={setColorTarget}
            onPatch={(patch) =>
              setDraft((previous) => ({
                ...previous,
                settings: { ...previous.settings, ...patch }
              }))
            }
          />
        </section>
        <section data-settings-page="coordinates" hidden={tab !== "coordinates"}>
          <DrawingCoordinatesFields
            points={draft.points}
            point={point}
            setError={setError}
            disabled={!!draft.lock}
          />
        </section>
        <section data-settings-page="visibility" hidden={tab !== "visibility"}>
          <DrawingVisibilityFields value={draft.visibility} visibility={visibility} />
        </section>
        <p className="drawing-error" role="alert" hidden={!error}>
          {systemText(error)}
        </p>
        <footer>
          <DrawingTemplateMenu
            getDrawing={candidate}
            onApply={applyTemplate}
            onReset={() => setDraft({ ...draft, settings: initialSettings({ name: draft.name }) })}
          />
          <span />
          <button type="button" onClick={close}>
            {t("Отмена")}
          </button>
          <button type="submit" className="primary-button" disabled={saving}>
            {t("Ок")}
          </button>
        </footer>
        {colorTarget && (
          <DrawingStylePopover
            target={colorTarget}
            settings={settings}
            onColor={setColor}
            onChange={(patch) =>
              setDraft((previous) => ({
                ...previous,
                settings: { ...previous.settings, ...patch }
              }))
            }
            onClose={() => setColorTarget(null)}
          />
        )}
      </form>
    </dialog>
  );
}
