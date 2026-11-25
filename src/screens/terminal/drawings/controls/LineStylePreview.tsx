import type { LineStyle } from "../../../../model/types.js";

export interface LineStylePreviewProps {
  value: LineStyle;
  color?: string;
  opacity?: number;
  width?: number;
}

export function LineStylePreview({
  value,
  color = "currentColor",
  opacity = 1,
  width = 2
}: LineStylePreviewProps) {
  return (
    <svg
      className="drawing-line-preview"
      width="64"
      height="16"
      viewBox="0 0 64 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M4 8H60"
        fill="none"
        stroke={color}
        strokeOpacity={opacity}
        strokeWidth={width}
        strokeDasharray={value === "dashed" ? "6 4" : value === "dotted" ? "2 3" : undefined}
        strokeLinecap="butt"
      />
    </svg>
  );
}
