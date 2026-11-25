import { t } from "../../../../i18n/messages.js";
import type { ResolvedDrawingStyle } from "../../../../model/drawing-model.js";
import type { DrawingSettings } from "../../../../model/types.js";
import { Swatch, type ColorTarget } from "../DrawingStylePopover.js";
import { LineStylePicker } from "./LineStylePicker.js";
import { OpacityControl } from "./OpacityControl.js";

export function DrawingLineControls({
  settings,
  trend = false,
  onOpen,
  onChange
}: {
  settings: ResolvedDrawingStyle;
  trend?: boolean;
  onOpen: (target: ColorTarget) => void;
  onChange: (patch: Partial<DrawingSettings>) => void;
}) {
  const open = () => onOpen({ kind: trend ? "trend" : "line" });
  const color = trend ? settings.trendColor : settings.color;
  const width = trend ? settings.trendWidth : settings.width;
  const opacity = trend ? settings.trendOpacity : settings.lineOpacity;
  return (
    <div className="drawing-line-controls">
      <Swatch
        color={trend ? settings.trendColor : settings.color}
        label={trend ? t("Цвет линии тренда") : t("Цвет линий")}
        onClick={open}
      />
      <select
        aria-label={trend ? t("Толщина линии тренда") : t("Толщина линии")}
        name={trend ? "trendWidth" : "width"}
        value={width}
        onChange={(event) =>
          onChange(
            trend
              ? { trendWidth: Number(event.currentTarget.value) }
              : { width: Number(event.currentTarget.value) }
          )
        }
      >
        {[1, 2, 3, 4, 5].map((value) => (
          <option key={value} value={value}>
            {value}px
          </option>
        ))}
      </select>
      <LineStylePicker
        label={trend ? t("Стиль линии тренда") : t("Стиль линий")}
        name={trend ? "trendStyle" : "lineStyle"}
        value={trend ? settings.trendStyle : settings.lineStyle}
        color={color}
        opacity={opacity}
        width={width}
        onChange={(value) => onChange(trend ? { trendStyle: value } : { lineStyle: value })}
      />
      <OpacityControl
        name={trend ? "trendOpacity" : "lineOpacity"}
        value={opacity}
        color={color}
        label={trend ? "Непрозрачность линии тренда" : "Непрозрачность линии"}
        onChange={(value) => onChange(trend ? { trendOpacity: value } : { lineOpacity: value })}
      />
    </div>
  );
}
