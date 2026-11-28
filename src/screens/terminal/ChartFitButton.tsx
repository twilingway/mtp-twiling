import { useSyncExternalStore } from "react";
import { t } from "../../i18n/messages.js";
import { useTerminalController } from "./context.js";
import { chartFitProgress, requestChartFit } from "./chart-fit-controller.js";
import { DrawingToolIcon } from "./DrawingToolIcon.js";

export function ChartFitButton({
  menu = false,
  onClose
}: {
  menu?: boolean;
  onClose?: () => void;
}) {
  const controller = useTerminalController(),
    progress = chartFitProgress(controller),
    busy = useSyncExternalStore(progress.subscribe, progress.getSnapshot, progress.getSnapshot),
    label = t("Показать весь график");
  return (
    <button
      type="button"
      id={menu ? undefined : "fit-chart"}
      className={menu ? undefined : "tool"}
      role={menu ? "menuitem" : undefined}
      title={label}
      aria-label={label}
      disabled={busy}
      onClick={() => {
        requestChartFit(controller);
        onClose?.();
      }}
    >
      {menu ? label : <DrawingToolIcon name="fit" />}
    </button>
  );
}
