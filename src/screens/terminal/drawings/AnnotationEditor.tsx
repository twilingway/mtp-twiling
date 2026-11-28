import { t } from "../../../i18n/messages.js";
import type { DrawingAnnotationSettings, DrawingTool } from "../../../model/types.js";
import { AnnotationTableEditor } from "./AnnotationTableEditor.js";
import type { DraftSettings } from "./drawing-settings-model.js";
import { annotationSupportsCustomText } from "./annotation-edit-policy.js";

export function AnnotationEditor({
  name,
  settings,
  change,
  screenAnchor
}: {
  name: DrawingTool;
  settings: DraftSettings;
  change: <K extends keyof DraftSettings>(key: K, value: DraftSettings[K]) => void;
  screenAnchor?: (() => Partial<DrawingAnnotationSettings>) | undefined;
}) {
  const annotation = settings.annotation ?? {};
  const patch = (value: Partial<DrawingAnnotationSettings>) =>
    change("annotation", { ...annotation, ...value });
  const numeric = (
    key: "width" | "height" | "offsetX" | "offsetY" | "borderWidth",
    label: string,
    fallback: number,
    min: number,
    max: number
  ) => (
    <label className="setting-row">
      <span>{t(label)}</span>
      <input
        type="number"
        name={`annotation-${key}`}
        min={min}
        max={max}
        value={annotation[key] ?? fallback}
        onChange={(event) => patch({ [key]: Number(event.currentTarget.value) })}
      />
    </label>
  );
  const color = (key: "backgroundColor" | "borderColor", label: string) => (
    <label className="setting-row">
      <span>{t(label)}</span>
      <input
        type="color"
        aria-label={t(label)}
        value={annotation[key] ?? settings.color}
        onChange={(event) => patch({ [key]: event.currentTarget.value })}
      />
    </label>
  );
  const opacity = (key: "backgroundOpacity" | "borderOpacity", label: string, fallback: number) => (
    <label className="setting-row">
      <span>{t(label)}</span>
      <input
        type="range"
        aria-label={t(label)}
        min={0}
        max={100}
        value={Math.round((annotation[key] ?? fallback) * 100)}
        onChange={(event) => patch({ [key]: Number(event.currentTarget.value) / 100 })}
      />
      <output>{Math.round((annotation[key] ?? fallback) * 100)}%</output>
    </label>
  );
  return (
    <div className="annotation-editor">
      {annotationSupportsCustomText(name) && (
        <label className="annotation-text">
          <span>{t("Текст")}</span>
          <textarea
            name="text"
            autoFocus
            rows={4}
            aria-label={t("Текст рисунка")}
            maxLength={10000}
            value={settings.text}
            onChange={(event) => change("text", event.currentTarget.value)}
          />
        </label>
      )}
      {name === "table" && (
        <AnnotationTableEditor
          table={
            annotation.table ?? {
              cells: [
                ["", "", ""],
                ["", "", ""],
                ["", "", ""]
              ]
            }
          }
          onChange={(table) => patch({ table })}
        />
      )}
      {name !== "flag" && (
        <>
          <div className="annotation-format">
            <button
              type="button"
              aria-label={t("Жирный")}
              aria-pressed={annotation.bold ?? false}
              onClick={() => patch({ bold: !annotation.bold })}
            >
              <b>B</b>
            </button>
            <button
              type="button"
              aria-label={t("Курсив")}
              aria-pressed={annotation.italic ?? false}
              onClick={() => patch({ italic: !annotation.italic })}
            >
              <i>I</i>
            </button>
            <label>
              {t("Размер шрифта")}
              <input
                type="number"
                aria-label={t("Размер шрифта")}
                min={1}
                max={100}
                value={settings.fontSize}
                onChange={(event) => change("fontSize", Number(event.currentTarget.value))}
              />
            </label>
            <label>
              {t("Цвет текста")}
              <input
                type="color"
                aria-label={t("Цвет текста")}
                value={settings.textColor ?? settings.color}
                onChange={(event) => change("textColor", event.currentTarget.value)}
              />
            </label>
          </div>
          <label className="setting-row">
            <span>{t("Выравнивание текста")}</span>
            <select
              aria-label={t("Выравнивание текста")}
              value={settings.textAlign}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (value === "left" || value === "center" || value === "right")
                  change("textAlign", value);
              }}
            >
              <option value="left">{t("Слева")}</option>
              <option value="center">{t("По центру")}</option>
              <option value="right">{t("Справа")}</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={annotation.wrap ?? true}
              onChange={(event) => patch({ wrap: event.currentTarget.checked })}
            />
            {t("Перенос строк")}
          </label>
        </>
      )}
      {color("backgroundColor", "Цвет фона")}
      {opacity("backgroundOpacity", "Непрозрачность фона", 0.9)}
      {color("borderColor", "Цвет рамки")}
      {opacity("borderOpacity", "Непрозрачность рамки", 1)}
      {numeric("borderWidth", "Толщина рамки", 1, 0, 5)}
      <label className="setting-row">
        <span>{t("Стиль рамки")}</span>
        <select
          aria-label={t("Стиль рамки")}
          value={annotation.borderStyle ?? "solid"}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value === "solid" || value === "dashed" || value === "dotted")
              patch({ borderStyle: value });
          }}
        >
          <option value="solid">{t("Сплошная")}</option>
          <option value="dashed">{t("Штриховой пунктир")}</option>
          <option value="dotted">{t("Точечный пунктир")}</option>
        </select>
      </label>
      {numeric(
        "width",
        "Ширина",
        name === "table" ? (annotation.table?.cells[0]?.length ?? 3) * 120 : 180,
        name === "table" ? (annotation.table?.cells[0]?.length ?? 3) * 24 : 24,
        1600
      )}
      {name === "table" &&
        numeric(
          "height",
          "Высота",
          (annotation.table?.cells.length ?? 3) * 34,
          (annotation.table?.cells.length ?? 3) * 16,
          1200
        )}
      {name === "signpost" && (
        <>
          {numeric("offsetX", "Смещение по горизонтали", 0, -4000, 4000)}
          {numeric("offsetY", "Смещение по вертикали", -60, -4000, 4000)}
        </>
      )}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={annotation.screenAnchored ?? false}
          onChange={(event) =>
            patch({
              screenAnchored: event.currentTarget.checked,
              screenX: annotation.screenX ?? 0.5,
              screenY: annotation.screenY ?? 0.3,
              ...(event.currentTarget.checked && screenAnchor?.())
            })
          }
        />
        {t("Закрепить на экране")}
      </label>
      {name === "table" && (
        <div className="annotation-position-grid" role="group" aria-label={t("Положение таблицы")}>
          {Array.from({ length: 9 }, (_, index) => {
            const x = (index % 3) / 2,
              y = Math.floor(index / 3) / 2;
            const label =
              [
                "Слева вверху",
                "Вверху по центру",
                "Справа вверху",
                "Слева по центру",
                "По центру",
                "Справа по центру",
                "Слева внизу",
                "Внизу по центру",
                "Справа внизу"
              ][index] ?? "";
            return (
              <button
                type="button"
                key={index}
                aria-label={t(label)}
                title={t(label)}
                aria-pressed={
                  !!annotation.screenAnchored &&
                  annotation.screenX === x &&
                  annotation.screenY === y
                }
                onClick={() => patch({ screenAnchored: true, screenX: x, screenY: y })}
              >
                ▪
              </button>
            );
          })}
        </div>
      )}
      {annotation.screenAnchored &&
        (["screenX", "screenY"] as const).map((key) => (
          <label className="setting-row" key={key}>
            <span>{t(key === "screenX" ? "Положение X (%)" : "Положение Y (%)")}</span>
            <input
              type="number"
              min={0}
              max={100}
              value={Math.round((annotation[key] ?? 0.5) * 100)}
              onChange={(event) => patch({ [key]: Number(event.currentTarget.value) / 100 })}
            />
          </label>
        ))}
    </div>
  );
}
