import { useEffect, useRef, useState } from "react";
import { logicalForTime, timeForLogical } from "../../../charts/adapter.js";
import { isDrawing } from "../../../model/backup-format.js";
import { TOOL_NAMES } from "../../../model/drawing-model.js";
import { TIMEFRAMES } from "../../../model/history-codec.js";
import type {
  Drawing,
  DrawingDraft,
  DrawingPoint,
  DrawingTemplate,
  DrawingVisibility,
  FibLevelStyle,
  VisibilityRule
} from "../../../model/types.js";
import { useTerminal } from "../context.js";
import { DrawingTemplateMenu } from "./DrawingTemplateMenu.js";
import { DrawingStylePopover, Swatch } from "./DrawingStylePopover.js";
import type { ColorTarget } from "./DrawingStylePopover.js";
import { defaultVisibility, initialSettings, formatDate } from "./drawing-settings-model.js";
import type { DraftSettings } from "./drawing-settings-model.js";
const GROUPS = [
  ["minutes", "Минуты", 59],
  ["hours", "Часы", 24],
  ["days", "Дни", 366],
  ["weeks", "Недели", 52]
] as const;
interface Draft extends DrawingDraft {
  settings: DraftSettings;
  visibility: Required<DrawingVisibility>;
}
type CheckKey = "trendLine" | "oneColor" | "fill" | "reverse" | "prices" | "labels" | "textEnabled";
export function DrawingSettingsDialog() {
  const { state } = useTerminal();
  const drawing = state.drawings.find((item) => item.id === state.selectedObject);
  return state.dialog === "drawing-settings" && drawing ? (
    <DrawingSettingsForm key={drawing.id} drawing={drawing} />
  ) : null;
}
function DrawingSettingsForm({ drawing }: { drawing: Drawing }) {
  const { controller, state } = useTerminal();
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Draft>(() => ({
    ...structuredClone(drawing),
    settings: initialSettings(drawing),
    visibility: { ...defaultVisibility(), ...structuredClone(drawing.visibility) }
  }));
  const [tab, setTab] = useState<"style" | "coordinates" | "visibility">("style");
  const [error, setError] = useState("");
  const [colorTarget, setColorTarget] = useState<ColorTarget | null>(null);
  const settings = draft.settings,
    fib = draft.name.startsWith("fibonacci");
  const close = () => controller.setDialog(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  const change = <K extends keyof DraftSettings>(key: K, value: DraftSettings[K]) =>
    setDraft((previous) => ({ ...previous, settings: { ...previous.settings, [key]: value } }));
  const point = (index: number, patch: Partial<DrawingPoint>) =>
    setDraft((previous) => ({
      ...previous,
      points: previous.points.map((p, i) => (i === index ? { ...p, ...patch } : p))
    }));
  const level = (index: number, patch: Partial<FibLevelStyle>) =>
    change(
      "levelStyles",
      settings.levelStyles.map((l, i) => (i === index ? { ...l, ...patch } : l))
    );
  const visibility = (group: keyof DrawingVisibility, patch: Partial<VisibilityRule>) =>
    setDraft((previous) => ({
      ...previous,
      visibility: { ...previous.visibility, [group]: { ...previous.visibility[group], ...patch } }
    }));
  const checked = (key: CheckKey, label: string) => (
    <label className="checkbox-label">
      <input
        type="checkbox"
        name={key}
        checked={settings[key]}
        onChange={(event) => change(key, event.currentTarget.checked)}
      />
      {label}
    </label>
  );
  const choiceValue = (value: unknown) =>
    typeof value === "string" || typeof value === "number" ? String(value) : "";
  const choice = <K extends keyof DraftSettings>(
    key: K,
    label: string,
    options: readonly (readonly [DraftSettings[K], string])[]
  ) => (
    <label className="setting-row">
      <span>{label}</span>
      <select
        name={key}
        value={choiceValue(settings[key])}
        onChange={(event) => {
          const selected = options.find(
            ([value]) => choiceValue(value) === event.currentTarget.value
          );
          if (selected) change(key, selected[0]);
        }}
      >
        {options.map(([value, title]) => (
          <option key={choiceValue(value)} value={choiceValue(value)}>
            {title}
          </option>
        ))}
      </select>
    </label>
  );
  const colorControl = (trend = false) => (
    <>
      <Swatch
        color={trend ? settings.trendColor : settings.color}
        label={trend ? "Цвет линии тренда" : "Цвет линий"}
        onClick={() => setColorTarget({ kind: trend ? "trend" : "line" })}
      />
      <button
        type="button"
        className="line-style-button"
        aria-label={trend ? "Стиль линии тренда" : "Стиль линий"}
        onClick={() => setColorTarget({ kind: trend ? "trend" : "line" })}
      >
        {trend ? "╌╌╌" : "━━"}
      </button>
    </>
  );
  const candidate = (): Drawing | null => {
    if (GROUPS.some(([group, , max]) => draft.visibility[group].to > max)) {
      setError("Проверьте допустимые диапазоны видимости.");
      return null;
    }
    const item = {
      ...draft,
      title: draft.title?.trim() ?? "",
      settings: {
        ...settings,
        extendLeft: settings.extend === "left" || settings.extend === "both",
        extendRight: settings.extend === "right" || settings.extend === "both",
        levels: settings.levelStyles.filter((l) => l.enabled).map((l) => l.value)
      }
    };
    if (!isDrawing(item)) {
      setError("Проверьте координаты, уровни (от −100 до 100) и диапазоны видимости.");
      return null;
    }
    setError("");
    return item;
  };
  const save = async () => {
    const item = candidate();
    if (!item) return;
    try {
      await controller.updateDrawing(item);
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить рисунок.");
    }
  };
  const applyTemplate = (template: DrawingTemplate) =>
    setDraft((previous) => ({
      ...previous,
      settings: initialSettings(template),
      visibility: { ...defaultVisibility(), ...structuredClone(template.visibility) }
    }));
  const setColor = (color: string) => {
    if (colorTarget?.kind === "level") level(colorTarget.index, { color });
    else change(colorTarget?.kind === "trend" ? "trendColor" : "color", color);
  };
  const interval = TIMEFRAMES[state.preferences.timeframe].ms;
  const coordinate = (p: DrawingPoint, index: number) => (
    <div className="coordinate-row" key={index}>
      <span>#{index + 1} (цена, бар)</span>
      <input
        type="number"
        step="any"
        data-coordinate-value={index}
        aria-label={`Точка ${index + 1}: цена`}
        value={Number.isFinite(p.value) ? p.value : ""}
        onChange={(event) => point(index, { value: Number(event.currentTarget.value) })}
      />
      <input
        type="number"
        step="1"
        data-coordinate-bar={index}
        aria-label={`Точка ${index + 1}: бар`}
        value={
          Number.isFinite(p.timestamp)
            ? Math.round(logicalForTime(state.candles, p.timestamp, interval))
            : ""
        }
        onChange={(event) => {
          const timestamp = timeForLogical(
            state.candles,
            Number(event.currentTarget.value),
            interval
          );
          if (timestamp !== null) point(index, { timestamp });
        }}
      />
      <input
        type="datetime-local"
        step="60"
        data-coordinate-time={index}
        aria-label={`Точка ${index + 1}: дата UTC`}
        value={formatDate(p.timestamp)}
        onChange={(event) =>
          point(index, { timestamp: Date.parse(event.currentTarget.value + "Z") })
        }
      />
    </div>
  );
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
          <h2>{TOOL_NAMES[draft.name]}</h2>
          <button type="button" aria-label="Закрыть настройки" onClick={close}>
            ×
          </button>
        </header>
        <label className="drawing-title">
          <input
            name="title"
            aria-label="Название объекта"
            placeholder="Название объекта"
            value={draft.title ?? ""}
            maxLength={300}
            onChange={(event) => setDraft({ ...draft, title: event.currentTarget.value })}
          />
        </label>
        <nav className="settings-tabs" aria-label="Разделы настроек">
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
              {key === "style" ? "Стиль" : key === "coordinates" ? "Координаты" : "Видимость"}
            </button>
          ))}
        </nav>
        <section data-settings-page="style" hidden={tab !== "style"}>
          {fib ? (
            <>
              <div className="setting-row">
                {checked("trendLine", "Линия тренда")}
                {colorControl(true)}
              </div>
              <div className="setting-row">
                <span>Линии уровня</span>
                {colorControl()}
              </div>
              {choice("extend", "Продолжить", [
                ["none", "Не продолжать"],
                ["right", "Вправо"],
                ["left", "Влево"],
                ["both", "В обе стороны"]
              ])}
              <div className="fib-levels">
                {settings.levelStyles.map((l, index) => (
                  <div key={index} className={`fib-level ${l.enabled ? "" : "disabled"}`}>
                    <input
                      type="checkbox"
                      data-level-enabled={index}
                      aria-label={`Включить уровень ${l.value}`}
                      checked={l.enabled}
                      onChange={(event) => level(index, { enabled: event.currentTarget.checked })}
                    />
                    <input
                      type="number"
                      step="any"
                      min={-100}
                      max={100}
                      data-level-value={index}
                      aria-label={`Значение уровня ${index + 1}`}
                      value={l.value}
                      onChange={(event) =>
                        level(index, { value: Number(event.currentTarget.value) })
                      }
                    />
                    <Swatch
                      color={l.color}
                      label={`Цвет уровня ${l.value}`}
                      onClick={() => setColorTarget({ kind: "level", index })}
                    />
                    {settings.textEnabled && (
                      <input
                        type="text"
                        data-level-text={index}
                        aria-label={`Текст уровня ${l.value}`}
                        placeholder="Текст уровня"
                        maxLength={150}
                        value={l.text ?? ""}
                        onChange={(event) => level(index, { text: event.currentTarget.value })}
                      />
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="add-level"
                disabled={settings.levelStyles.length >= 40}
                onClick={() =>
                  change("levelStyles", [
                    ...settings.levelStyles,
                    { value: 1, enabled: true, color: "#787b86", text: "" }
                  ])
                }
              >
                ＋ Добавить уровень
              </button>
              <div className="setting-row">
                {checked("oneColor", "Использовать один цвет")}
                <Swatch
                  color={settings.color}
                  label="Общий цвет уровней"
                  onClick={() => setColorTarget({ kind: "line" })}
                />
              </div>
              <div className="setting-row">
                {checked("fill", "Фон")}
                <input
                  type="range"
                  name="opacity"
                  min="0"
                  max="1"
                  step=".01"
                  aria-label="Непрозрачность фона"
                  value={settings.opacity}
                  onChange={(event) => change("opacity", Number(event.currentTarget.value))}
                />
              </div>
              {checked("reverse", "Переворот")}
              {checked("prices", "Цены")}
              <div className="setting-row">
                {checked("labels", "Уровни")}
                {choice("labelFormat", "", [
                  ["value", "Значения"],
                  ["percent", "Проценты"]
                ])}
              </div>
              <div className="setting-row">
                {choice("labelSide", "Метки", [
                  ["left", "Слева"],
                  ["center", "По центру"],
                  ["right", "Справа"]
                ])}
                {choice("labelVertical", "", [
                  ["top", "Сверху"],
                  ["middle", "По центру"],
                  ["bottom", "Снизу"]
                ])}
              </div>
              <div className="setting-row">
                {checked("textEnabled", "Текст")}
                <input
                  name="text"
                  placeholder="Текст"
                  aria-label="Текст рисунка"
                  maxLength={300}
                  value={settings.text}
                  onChange={(event) => change("text", event.currentTarget.value)}
                />
              </div>
              <div className="setting-row">
                {choice("textAlign", "", [
                  ["left", "Слева"],
                  ["center", "По центру"],
                  ["right", "Справа"]
                ])}
                {choice("textVertical", "", [
                  ["top", "Сверху"],
                  ["center", "По центру"],
                  ["bottom", "Снизу"]
                ])}
              </div>
              {choice(
                "fontSize",
                "Размер шрифта",
                [10, 11, 12, 13, 14, 16, 18, 20, 24].map((size) => [size, String(size)])
              )}
            </>
          ) : (
            <div className="setting-row">
              <span>Линия</span>
              {colorControl()}
            </div>
          )}
        </section>
        <section data-settings-page="coordinates" hidden={tab !== "coordinates"}>
          {draft.points.map(coordinate)}
        </section>
        <section data-settings-page="visibility" hidden={tab !== "visibility"}>
          <p>Показывать на интервалах</p>
          {GROUPS.map(([group, label, max]) => (
            <div className="visibility-row" key={group}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  data-visible-group={group}
                  checked={draft.visibility[group].enabled}
                  onChange={(event) => visibility(group, { enabled: event.currentTarget.checked })}
                />
                {label}
              </label>
              <input
                type="number"
                min="1"
                max={max}
                data-visible-from={group}
                aria-label={`${label} от`}
                value={draft.visibility[group].from}
                onChange={(event) => visibility(group, { from: Number(event.currentTarget.value) })}
              />
              <span>—</span>
              <input
                type="number"
                min="1"
                max={max}
                data-visible-to={group}
                aria-label={`${label} до`}
                value={draft.visibility[group].to}
                onChange={(event) => visibility(group, { to: Number(event.currentTarget.value) })}
              />
            </div>
          ))}
          <small>Применяется к таймфреймам: 1, 5, 15, 30 минут, 1 час, 1 день и 1 неделя.</small>
        </section>
        <p className="drawing-error" role="alert" hidden={!error}>
          {error}
        </p>
        <footer>
          <DrawingTemplateMenu
            getDrawing={candidate}
            onApply={applyTemplate}
            onReset={() => setDraft({ ...draft, settings: initialSettings({}) })}
          />
          <span />
          <button type="button" onClick={close}>
            Отмена
          </button>
          <button type="submit" className="primary-button">
            Ок
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
