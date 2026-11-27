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
  const tools = drawingToolbarSettings(state.preferences.chartSettings);
  if (
    !drawing ||
    drawing.visible === false ||
    tools.drawingsHidden ||
    !drawingVisibleOnInterval(drawing.visibility, state.preferences.timeframe)
  )
    return null;
  const label = tools.drawingsLocked
    ? t("Объекты заблокированы глобально. Разблокируйте их в меню.")
    : drawing.lock
      ? t("Разблокировать объект")
      : t("Заблокировать объект");
  return (
    <button
      className="selected-drawing-lock"
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={!!drawing.lock || tools.drawingsLocked}
      disabled={saving || tools.drawingsLocked}
      onClick={() => {
        setSaving(true);
        void controller.tools
          .toggleSelectedLock()
          .catch((error: unknown) =>
            controller.notify(
              error instanceof Error ? error.message : t("Не удалось сохранить объект.")
            )
          )
          .finally(() => setSaving(false));
      }}
    >
      <LockIcon locked={!!drawing.lock || tools.drawingsLocked} />
    </button>
  );
}
