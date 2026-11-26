import { t } from "../../../i18n/messages.js";
import type { DrawingSettings, DrawingTool, FibLevelStyle } from "../../../model/types.js";
import { Swatch } from "./DrawingStylePopover.js";
import type { ColorTarget } from "./DrawingStylePopover.js";
import { DrawingLineControls } from "./controls/DrawingLineControls.js";
import { OpacityControl } from "./controls/OpacityControl.js";
import { draftNumber } from "./drawing-settings-model.js";
import type { DraftSettings } from "./drawing-settings-model.js";
type CheckKey = "trendLine" | "oneColor" | "fill" | "reverse" | "prices" | "labels" | "textEnabled";
type Change = <K extends keyof DraftSettings>(key: K, value: DraftSettings[K]) => void;
const fontSizes = Array.from({ length: 72 }, (_, index) => index + 1);
export function DrawingStyleFields({
  name,
  settings,
  change,
  level,
  setColorTarget,
  onPatch
}: {
  name: DrawingTool;
  settings: DraftSettings;
  change: Change;
  level: (index: number, patch: Partial<FibLevelStyle>) => void;
  setColorTarget: (target: ColorTarget) => void;
  onPatch: (patch: Partial<DrawingSettings>) => void;
}) {
  const fib = name.startsWith("fibonacci");
  const rectangle = name === "rectangle";
  const checked = (key: CheckKey, label: string) => (
    <label className="checkbox-label">
      <input
        type="checkbox"
        name={key}
        checked={settings[key]}
        onChange={(event) => change(key, event.currentTarget.checked)}
      />
      {t(label)}
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
      <span>{t(label)}</span>
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
            {t(title)}
          </option>
        ))}
      </select>
    </label>
  );
  const colorControl = (trend = false) => (
    <DrawingLineControls
      settings={settings}
      trend={trend}
      onOpen={setColorTarget}
      onChange={onPatch}
    />
  );
  const fillControl = (label: string) => (
    <div className="setting-row">
      {checked("fill", label)}
      <OpacityControl
        name="opacity"
        value={settings.opacity}
        color={settings.color}
        label="Непрозрачность фона"
        onChange={(value) => change("opacity", value)}
      />
    </div>
  );

  return (
    <>
      {fib ? (
        <>
          <div className="setting-row">
            {checked("trendLine", t("Линия тренда"))}
            {colorControl(true)}
          </div>
          <div className="setting-row">
            <span>{t("Линии уровня")}</span>
            {colorControl()}
          </div>
          {choice("extend", t("Продолжить"), [
            ["none", t("Не продолжать")],
            ["right", t("Вправо")],
            ["left", t("Влево")],
            ["both", t("В обе стороны")]
          ])}
          <div className="fib-levels">
            {settings.levelStyles.map((l, index) => (
              <div key={index} className={`fib-level ${l.enabled ? "" : "disabled"}`}>
                <input
                  type="checkbox"
                  data-level-enabled={index}
                  aria-label={t("Включить уровень ") + l.value}
                  checked={l.enabled}
                  onChange={(event) => level(index, { enabled: event.currentTarget.checked })}
                />
                <input
                  type="number"
                  step="any"
                  min={-100}
                  max={100}
                  data-level-value={index}
                  aria-label={t("Значение уровня ") + (index + 1)}
                  value={Number.isFinite(l.value) ? l.value : ""}
                  onChange={(event) =>
                    level(index, { value: draftNumber(event.currentTarget.value) })
                  }
                />
                <Swatch
                  color={l.color}
                  label={t("Цвет уровня ") + l.value}
                  onClick={() => setColorTarget({ kind: "level", index })}
                />
                {settings.textEnabled && (
                  <input
                    type="text"
                    data-level-text={index}
                    aria-label={t("Текст уровня ") + l.value}
                    placeholder={t("Текст уровня")}
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
            {t("＋ Добавить уровень")}
          </button>
          <div className="setting-row">
            {checked("oneColor", t("Использовать один цвет"))}
            <Swatch
              color={settings.color}
              label={t("Общий цвет уровней")}
              onClick={() => setColorTarget({ kind: "line" })}
            />
          </div>
          {fillControl("Фон")}
          {checked("reverse", t("Переворот"))}
          {checked("prices", t("Цены"))}
          <div className="setting-row">
            {checked("labels", t("Уровни"))}
            {choice("labelFormat", "", [
              ["value", t("Значения")],
              ["percent", t("Проценты")]
            ])}
          </div>
          <div className="setting-row">
            {choice("labelSide", t("Метки"), [
              ["left", t("Слева")],
              ["center", t("По центру")],
              ["right", t("Справа")]
            ])}
            {choice("labelVertical", "", [
              ["top", t("Сверху")],
              ["middle", t("По центру")],
              ["bottom", t("Снизу")]
            ])}
          </div>
        </>
      ) : (
        <>
          <div className="setting-row">
            <span>{t(rectangle ? "Контур" : "Линия")}</span>
            {colorControl()}
          </div>
          {rectangle && fillControl("Заливка")}
        </>
      )}
      <div className="setting-row">
        {checked("textEnabled", t("Текст"))}
        <input
          name="text"
          placeholder={t("Текст")}
          aria-label={t("Текст рисунка")}
          maxLength={300}
          value={settings.text}
          onChange={(event) => change("text", event.currentTarget.value)}
        />
      </div>
      <div className="setting-row">
        <span>{t("Цвет текста")}</span>
        <Swatch
          color={settings.textColor ?? settings.color}
          label={t("Цвет текста")}
          onClick={() => setColorTarget({ kind: "text" })}
        />
      </div>
      {choice("textAlign", "Текст по горизонтали", [
        ["left", t("Слева")],
        ["center", t("По центру")],
        ["right", t("Справа")]
      ])}
      {choice("textVertical", "Текст по вертикали", [
        ["top", t("Сверху")],
        ["center", t("По центру")],
        ["bottom", t("Снизу")]
      ])}
      {choice(
        "fontSize",
        t("Размер шрифта"),
        (fontSizes.includes(settings.fontSize) ? fontSizes : [...fontSizes, settings.fontSize]).map(
          (size) => [size, String(size)]
        )
      )}
    </>
  );
}
