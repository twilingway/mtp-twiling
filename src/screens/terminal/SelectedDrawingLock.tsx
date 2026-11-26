import { useState } from "react";
import { t } from "../../i18n/messages.js";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import { drawingVisibleOnInterval } from "../../model/intervals/drawing-visibility.js";
import { useTerminal } from "./context.js";
import { LockIcon } from "./VisibilityIcon.js";

export function SelectedDrawingLock() {
  const { controller, state } = useTerminal();
  const [saving, setSaving] = useState(false);
  const drawing = state.drawings.find((item) => item.id === state.selectedObject);
  if (
    !drawing ||
    drawing.visible === false ||
    drawingToolbarSettings(state.preferences.chartSettings).drawingsHidden ||
    !drawingVisibleOnInterval(drawing.visibility, state.preferences.timeframe)
  )
    return null;
  const label = drawing.lock ? t("Разблокировать объект") : t("Заблокировать объект");
  return (
    <button
      className="selected-drawing-lock"
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={!!drawing.lock}
      disabled={saving}
      onClick={() => {
        setSaving(true);
        void controller
          .updateDrawing({ ...drawing, lock: !drawing.lock })
          .catch((error: unknown) =>
            controller.notify(
              error instanceof Error ? error.message : t("Не удалось сохранить объект.")
            )
          )
          .finally(() => setSaving(false));
      }}
    >
      <LockIcon locked={!!drawing.lock} />
    </button>
  );
}
