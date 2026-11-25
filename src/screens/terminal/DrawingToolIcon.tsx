import type { ReactNode } from "react";

export type DrawingIconName =
  | "crosshair"
  | "dot"
  | "arrowCursor"
  | "demonstration"
  | "eraser"
  | "trend"
  | "ray"
  | "extended"
  | "horizontal"
  | "horizontalRay"
  | "vertical"
  | "fibonacci"
  | "fibExtension"
  | "patterns"
  | "forecast"
  | "brush"
  | "text"
  | "symbols"
  | "ruler"
  | "zoom"
  | "magnet"
  | "keepDrawing"
  | "lock"
  | "unlock"
  | "hide"
  | "trash"
  | "image"
  | "fit"
  | "settings"
  | "chevron"
  | "star";

function Endpoints({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <circle cx="5" cy="23" r="1.6" />
      <circle cx="23" cy="5" r="1.6" />
    </>
  );
}
const icons: Record<DrawingIconName, ReactNode> = {
  crosshair: <path d="M14 2v8m0 8v8M2 14h8m8 0h8M14 12v4m-2-2h4" />,
  dot: <circle cx="14" cy="14" r="2" fill="currentColor" stroke="none" />,
  arrowCursor: <path d="m7 3 14 13-8 1-4 7Z" />,
  demonstration: (
    <>
      <circle cx="14" cy="14" r="8" />
      <path d="M14 2v4m0 16v4M2 14h4m16 0h4" />
    </>
  ),
  eraser: (
    <>
      <path d="m5 14 11-11 9 9-11 11H9Zm5-5 9 9M4 25h21" />
    </>
  ),
  trend: (
    <Endpoints>
      <path d="M6 22 22 6" />
    </Endpoints>
  ),
  ray: (
    <>
      <path d="M6 22 25 3" />
      <circle cx="5" cy="23" r="1.6" />
      <circle cx="17" cy="11" r="1.6" />
    </>
  ),
  extended: (
    <>
      <path d="M2 26 26 2" />
      <circle cx="8" cy="20" r="1.6" />
      <circle cx="20" cy="8" r="1.6" />
    </>
  ),
  horizontal: <path d="M2 14h24" />,
  horizontalRay: (
    <>
      <path d="M7 14h19" />
      <circle cx="5" cy="14" r="1.6" />
    </>
  ),
  vertical: <path d="M14 2v24" />,
  fibonacci: (
    <>
      <path d="M3 5h22M3 12h22M3 18h22M3 24h22" />
      <circle cx="7" cy="5" r="1.6" />
      <circle cx="21" cy="24" r="1.6" />
    </>
  ),
  fibExtension: (
    <>
      <path d="M3 6h22M3 13h22M3 20h22M5 24 13 9l7 14" />
      <circle cx="5" cy="24" r="1.4" />
      <circle cx="13" cy="9" r="1.4" />
    </>
  ),
  patterns: (
    <>
      <path d="m4 23 5-17 6 11 7-13 3 18M4 23 22 4M9 6l16 16" />
      {[
        [4, 23],
        [9, 6],
        [15, 17],
        [22, 4],
        [25, 22]
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="1.5" />
      ))}
    </>
  ),
  forecast: (
    <>
      <path d="M3 5h22M3 14h22M3 23h22M8 2v7m12 2v7m-9 2v6" />
      <circle cx="8" cy="5" r="1.5" />
      <circle cx="20" cy="14" r="1.5" />
      <circle cx="11" cy="23" r="1.5" />
    </>
  ),
  brush: (
    <>
      <path d="M3 24c5 0 8-2 10-6l3-7 8-8 2 2-8 8-7 3c-4 2-3 8-8 8Z" />
      <path d="M14 15c2 0 3 1 3 2" />
    </>
  ),
  text: <path d="M5 8V4h18v4M14 4v20M10 24h8" />,
  symbols: (
    <>
      <circle cx="14" cy="14" r="10" />
      <path d="M8 17c3 5 9 5 12 0" />
      <circle cx="10" cy="10" r=".7" fill="currentColor" />
      <circle cx="18" cy="10" r=".7" fill="currentColor" />
    </>
  ),
  ruler: (
    <>
      <path d="m3 21 18-18 5 5L8 26ZM8 17l3 3m1-7 3 3m1-7 3 3m1-7 3 3" />
    </>
  ),
  zoom: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="m18 18 8 8M8 12h8m-4-4v8" />
    </>
  ),
  magnet: (
    <>
      <path d="M6 14V9a8 8 0 0 1 16 0v14h-5V9a3 3 0 0 0-6 0v14H6Zm0 2h5m6 0h5" />
    </>
  ),
  keepDrawing: (
    <>
      <path d="m3 18 13-13 5 5L8 23l-6 2Zm10-10 5 5" />
      <rect x="17" y="18" width="9" height="8" rx="1" />
      <path d="M19 18v-3a2.5 2.5 0 0 1 5 0v3" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="12" width="18" height="14" rx="2" />
      <path d="M9 12V7a5 5 0 0 1 10 0v5m-5 6v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="12" width="18" height="14" rx="2" />
      <path d="M9 12V7a5 5 0 0 1 10 0m-5 11v3" />
    </>
  ),
  hide: (
    <>
      <path d="M2 11s4-7 11-7 11 7 11 7-4 7-11 7S2 11 2 11Z" />
      <circle cx="13" cy="11" r="3" />
      <path d="m18 25 2-9h4m-5 4h4m1 5 4-5m-4 0 4 5" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7h18M10 7V3h8v4M7 7l1 18h12l1-18M11 11v10m6-10v10" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="22" height="20" rx="1" />
      <circle cx="9" cy="10" r="2" />
      <path d="m3 22 7-7 4 4 4-7 7 10" />
    </>
  ),
  fit: <path d="M3 10V3h7m8 0h7v7m0 8v7h-7m-8 0H3v-7" />,
  settings: (
    <>
      <path d="m11 3-1 3-3 1-3-1-2 5 3 2v3l-3 2 2 5 3-1 3 1 1 3h6l1-3 3-1 3 1 2-5-3-2v-3l3-2-2-5-3 1-3-1-1-3Z" />
      <circle cx="14" cy="14" r="4" />
    </>
  ),
  chevron: <path d="m10 6 8 8-8 8" />,
  star: <path d="m14 3 3.4 6.8 7.6 1.1-5.5 5.4 1.3 7.5-6.8-3.6-6.8 3.6 1.3-7.5L3 10.9l7.6-1.1Z" />
};

export function DrawingToolIcon({ name }: { name: DrawingIconName }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {icons[name]}
    </svg>
  );
}
