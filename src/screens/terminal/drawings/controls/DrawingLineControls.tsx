import { t } from "../../../../i18n/messages.js";
import type { ResolvedDrawingStyle } from "../../../../model/drawing-model.js";
import { Swatch, type ColorTarget } from "../DrawingStylePopover.js";
import { LineStylePreview } from "./LineStylePreview.js";

export function DrawingLineControls({
  settings,
  trend = false,
  onOpen
}: {
  settings: ResolvedDrawingStyle;
  trend?: boolean;
  onOpen: (target: ColorTarget) => void;
}) {
  const open = () => onOpen({ kind: trend ? "trend" : "line" });
  return (
    <>
      <Swatch
        color={trend ? settings.trendColor : settings.color}
        label={trend ? t("Цвет линии тренда") : t("Цвет линий")}
        onClick={open}
      />
      <button
        type="button"
        className="line-style-button"
        aria-label={trend ? t("Стиль линии тренда") : t("Стиль линий")}
        onClick={open}
      >
        <LineStylePreview
          value={trend ? settings.trendStyle : settings.lineStyle}
          color={trend ? settings.trendColor : settings.color}
          opacity={trend ? settings.trendOpacity : settings.lineOpacity}
          width={trend ? settings.trendWidth : settings.width}
        />
      </button>
    </>
  );
}
