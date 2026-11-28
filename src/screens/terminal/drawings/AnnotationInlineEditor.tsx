import { useEffect, useRef, useState } from "react";
import { t } from "../../../i18n/messages.js";
import { drawingGeometry } from "../../../model/drawing-model.js";
import { annotationMeasureText } from "../../../model/drawing-annotation-measure.js";
import { useTerminal } from "../context.js";
import { annotationUsesInlineEditor } from "./annotation-edit-policy.js";
import { shallowEqual } from "../snapshot-selector.js";
import type { TerminalState } from "../state.js";

export function selectAnnotationInlineState(state: TerminalState) {
  return {
    dialog: state.dialog,
    drawingCreationDraft: state.drawingCreationDraft,
    drawingSettingsPreview: state.drawingSettingsPreview
  };
}

export function AnnotationInlineEditor({ projection }: { projection?: EventTarget | undefined }) {
  const { controller, state } = useTerminal(selectAnnotationInlineState, shallowEqual),
    creation = state.drawingCreationDraft,
    draft = creation ?? state.drawingSettingsPreview;
  const input = useRef<HTMLTextAreaElement>(null),
    submitting = useRef(false);
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [text, setText] = useState<{ token: string; value: string } | null>(null);
  const [, repaint] = useState(0);
  const token =
    state.dialog === "annotation-editor" && draft && annotationUsesInlineEditor(draft.drawing.name)
      ? draft.token
      : undefined;
  useEffect(() => {
    if (!token) return;
    input.current?.focus();
    input.current?.select();
  }, [token]);
  useEffect(() => {
    if (!token) return;
    const update = () => repaint((value) => value + 1);
    projection?.addEventListener("change", update);
    return () => projection?.removeEventListener("change", update);
  }, [projection, token]);
  if (
    !draft ||
    !annotationUsesInlineEditor(draft.drawing.name) ||
    state.dialog !== "annotation-editor" ||
    !controller.chart
  )
    return null;
  const drawing = draft.drawing,
    chart = controller.chart,
    size = chart.plotSize();
  const geometry = drawingGeometry(
    drawing,
    (point) => chart.pointToPixel(point),
    size.width,
    size.height,
    { selected: true, measureText: annotationMeasureText }
  );
  const bounds = geometry?.annotation?.body;
  const width = Math.min(340, size.width - 16);
  const left = Math.max(8, Math.min(bounds?.left ?? 8, size.width - width - 8));
  const top = Math.max(8, Math.min(bounds?.top ?? 8, size.height - 190));
  const transaction = creation ? controller.drawingCreation : controller.drawingSettings;
  const cancel = () => {
    transaction.cancel(draft.token);
    controller.setDialog(null);
  };
  const save = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      const current =
        controller.getSnapshot().drawingCreationDraft ??
        controller.getSnapshot().drawingSettingsPreview;
      const candidate = current && {
        ...current.drawing,
        settings: {
          ...current.drawing.settings,
          text: text?.token === current.token ? text.value : (current.drawing.settings?.text ?? "")
        }
      };
      if (!current || !candidate || !(await transaction.commit(current.token, candidate)))
        setError(t("Введите текст и проверьте настройки рисунка."));
      else controller.setDialog(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Не удалось сохранить рисунок."));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };
  return (
    <div
      className="annotation-inline-editor"
      role="dialog"
      aria-label={t("Редактировать текст")}
      style={{ left, top, width }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          void save();
        }
      }}
    >
      <textarea
        ref={input}
        aria-label={t("Текст рисунка")}
        name="annotation-text"
        rows={4}
        maxLength={10000}
        value={text?.token === draft.token ? text.value : (drawing.settings?.text ?? "")}
        onChange={(event) => {
          setError("");
          setText({ token: draft.token, value: event.currentTarget.value });
          transaction.preview(draft.token, {
            ...drawing,
            settings: { ...drawing.settings, text: event.currentTarget.value }
          });
        }}
      />
      {error && <p role="alert">{error}</p>}
      <div className="annotation-inline-actions">
        <button type="button" onClick={() => controller.setDialog("drawing-settings")}>
          {t("Настройки")}
        </button>
        <span />
        <button type="button" onClick={cancel}>
          {t("Отмена")}
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={saving}
          onClick={() => void save()}
        >
          {t("Сохранить")}
        </button>
      </div>
    </div>
  );
}
