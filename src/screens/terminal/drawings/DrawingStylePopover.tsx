import type { CSSProperties } from "react";
import type { ResolvedDrawingStyle } from "../../../model/drawing-model.js";
import type { DrawingSettings, FibLevelStyle } from "../../../model/types.js";

const PALETTE =
  "#ffffff #dbdbdb #b8b8b8 #959595 #757575 #565656 #363636 #1a1a1a #000000 #f23645 #ff9800 #ffeb3b #4caf50 #00bcd4 #2196f3 #673ab7 #9c27b0 #e91e63 #ffcdd2 #ffe0b2 #fff9c4 #c8e6c9 #b2ebf2 #bbdefb #d1c4e9 #e1bee7 #f8bbd0 #ef9a9a #ffcc80 #fff59d #a5d6a7 #80deea #90caf9 #b39ddb #ce93d8 #f48fb1 #e57373 #ffb74d #fff176 #81c784 #4dd0e1 #64b5f6 #9575cd #ba68c8 #f06292 #ef5350 #ffa726 #ffee58 #66bb6a #26c6da #42a5f5 #7e57c2 #ab47bc #ec407a #b71c1c #e65100 #f57f17 #1b5e20 #006064 #0d47a1 #311b92 #4a148c #880e4f".split(
    " "
  );
export type ColorTarget = { kind: "line" | "trend" } | { kind: "level"; index: number };
export function Swatch({
  color,
  label,
  onClick
}: {
  color: string;
  label: string;
  onClick: () => void;
}) {
  const style: CSSProperties & { "--swatch": string } = { "--swatch": color };
  return (
    <button
      type="button"
      className="colour-swatch"
      aria-label={label}
      style={style}
      onClick={onClick}
    >
      <span />
    </button>
  );
}
interface Props {
  target: ColorTarget;
  settings: ResolvedDrawingStyle & { levelStyles: FibLevelStyle[] };
  onColor: (color: string) => void;
  onChange: (patch: Partial<DrawingSettings>) => void;
  onClose: () => void;
}
export function DrawingStylePopover({ target, settings, onColor, onChange, onClose }: Props) {
  const trend = target.kind === "trend";
  const color =
    target.kind === "level"
      ? (settings.levelStyles[target.index]?.color ?? settings.color)
      : trend
        ? settings.trendColor
        : settings.color;
  const opacity = trend ? settings.trendOpacity : settings.lineOpacity;
  const width = trend ? settings.trendWidth : settings.width;
  const lineStyle = trend ? settings.trendStyle : settings.lineStyle;
  return (
    <div className="colour-popover">
      <div className="colour-palette">
        {PALETTE.map((value) => (
          <button
            type="button"
            key={value}
            style={{ background: value }}
            aria-label={value}
            onClick={() => onColor(value)}
          />
        ))}
      </div>
      <label className="custom-colour">
        Другой цвет
        <input
          type="color"
          value={color}
          onChange={(event) => onColor(event.currentTarget.value)}
        />
      </label>
      {target.kind !== "level" && (
        <>
          <label>
            Непрозрачность
            <input
              type="range"
              min="0"
              max="1"
              step=".01"
              value={opacity}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                onChange(trend ? { trendOpacity: value } : { lineOpacity: value });
              }}
            />
          </label>
          <label className="setting-row">
            Толщина
            <select
              value={width}
              onChange={(event) => {
                const value = Number(event.currentTarget.value);
                onChange(trend ? { trendWidth: value } : { width: value });
              }}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="setting-row">
            Стиль линии
            <select
              value={lineStyle}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (value === "solid" || value === "dashed" || value === "dotted")
                  onChange(trend ? { trendStyle: value } : { lineStyle: value });
              }}
            >
              <option value="solid">Линия</option>
              <option value="dashed">Штриховой пунктир</option>
              <option value="dotted">Точечный пунктир</option>
            </select>
          </label>
        </>
      )}
      <button type="button" className="close-colour" onClick={onClose}>
        Готово
      </button>
    </div>
  );
}
