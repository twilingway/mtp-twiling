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
  | "hideOff"
  | "trash"
  | "image"
  | "fit"
  | "settings"
  | "chevron"
  | "star"
  | "infoLine"
  | "angle"
  | "channel"
  | "regression"
  | "flatChannel"
  | "angleChannel"
  | "pitchfork"
  | "timeZones"
  | "fan"
  | "circles"
  | "spiral"
  | "arc"
  | "wedge"
  | "grid"
  | "wave"
  | "triangle"
  | "cycles"
  | "sine"
  | "bars"
  | "shortPosition"
  | "anchoredVwap"
  | "volumeProfile"
  | "priceRange"
  | "dateRange"
  | "range"
  | "highlighter"
  | "arrowLine"
  | "arrowUp"
  | "arrowDown"
  | "rectangle"
  | "rotatedRectangle"
  | "circle"
  | "ellipse"
  | "path"
  | "curve"
  | "doubleCurve"
  | "note"
  | "priceNote"
  | "label"
  | "callout"
  | "comment"
  | "signpost"
  | "flag"
  | "post"
  | "idea"
  | "check"
  | "close"
  | "objects"
  | "zoomOut"
  | "strongMagnet"
  | "show";

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
  hideOff: (
    <>
      <path d="M2 11s4-7 11-7 11 7 11 7-4 7-11 7S2 11 2 11Z" />
      <circle cx="13" cy="11" r="3" />
      <path d="M3 2 25 24m-7 1 2-9h4m-5 4h4m1 5 4-5m-4 0 4 5" />
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
  star: <path d="m14 3 3.4 6.8 7.6 1.1-5.5 5.4 1.3 7.5-6.8-3.6-6.8 3.6 1.3-7.5L3 10.9l7.6-1.1Z" />,
  infoLine: <path d="m4 24 20-20M6 7h8m-8 4h5m7 8v6m-2-8h4" />,
  angle: <path d="M3 24h22M4 23 23 4M13 24a9 9 0 0 0-3-7" />,
  channel: <path d="m3 19 16-16M9 25 25 9M6 22 22 6" />,
  regression: <path d="M2 21 23 2M5 26 26 7M4 15l4 1 2-6 5 1 3-6 4 1" />,
  flatChannel: <path d="M3 6h22M3 23l22-12M3 15h22" />,
  angleChannel: <path d="m2 6 24-3M2 21l24-8M2 14l24-6" />,
  pitchfork: <path d="m3 25 16-16M7 14l7 7M7 14 20 1M14 21 27 8M3 25l7-7" />,
  timeZones: <path d="M3 3v22M6 3v22M11 3v22M18 3v22M26 3v22" />,
  fan: <path d="M3 25 25 3M3 25 25 9M3 25l22-9M3 25h22" />,
  circles: (
    <>
      <circle cx="14" cy="14" r="3" />
      <circle cx="14" cy="14" r="7" />
      <circle cx="14" cy="14" r="12" />
    </>
  ),
  spiral: <path d="M14 14c-4-3-6 5-1 6 9 2 13-11 4-15C5-1-4 16 6 24c9 7 20-1 20-10" />,
  arc: <path d="M3 24A21 21 0 0 1 24 3M9 24A15 15 0 0 1 24 9M16 24a8 8 0 0 1 8-8" />,
  wedge: <path d="M3 24 25 3M3 24l22-8M17 10a17 17 0 0 1 4 7M11 16a9 9 0 0 1 2 4" />,
  grid: <path d="M3 3h22v22H3ZM3 10h22M3 18h22M10 3v22M18 3v22M3 25 25 3M3 3l22 22" />,
  wave: <path d="m2 23 5-15 5 10 5-15 5 10 4-6M5 25h3m7-22h3m3 11h3" />,
  triangle: <path d="m3 23 11-20 11 20ZM3 23 20 13M8 14l17 9" />,
  cycles: <path d="M2 24V4m0 20a6 12 0 0 1 12 0 6 12 0 0 1 12 0M14 4v20M26 4v20" />,
  sine: <path d="M2 14h24M2 14C6-2 10-2 14 14s8 16 12 0" />,
  bars: <path d="M5 6v17m-3-9h3m0 5h3M14 2v17m-3-9h3m0 4h3M23 5v17m-3-11h3m0 7h3" />,
  shortPosition: <path d="M3 3h22v22H3ZM3 12h22M7 7h14M14 15v7m-3-3 3 3 3-3" />,
  anchoredVwap: <path d="M4 4v21m-2-3h4M4 20c4 0 5-9 9-8s4 4 7-2l5-6M11 4v4m7-6v4" />,
  volumeProfile: <path d="M3 3v22h22M3 6h9v4H3m0 0h18v5H3m0 0h13v5H3m0 0h6v5" />,
  priceRange: <path d="M5 3h18M5 25h18M14 3v22M10 7l4-4 4 4m-8 14 4 4 4-4" />,
  dateRange: <path d="M3 5v18M25 5v18M3 14h22m-18-4-4 4 4 4m14-8 4 4-4 4" />,
  range: <path d="M3 3h22v22H3Zm0 0 22 22M3 10V3h7m8 22h7v-7" />,
  highlighter: <path d="m5 17 12-14 8 7-13 13-5-1-4 4H1l4-6Zm2-2 8 7M2 27h23" />,
  arrowLine: <path d="M3 25 24 4M14 4h10v10" />,
  arrowUp: <path d="m14 3 10 10h-6v12h-8V13H4Z" />,
  arrowDown: <path d="m14 25 10-10h-6V3h-8v12H4Z" />,
  rectangle: <rect x="3" y="6" width="22" height="16" />,
  rotatedRectangle: <path d="m3 13 15-10 7 12-15 10Z" />,
  circle: <circle cx="14" cy="14" r="11" />,
  ellipse: <ellipse cx="14" cy="14" rx="12" ry="8" />,
  path: <path d="m3 23 6-17 6 14 10-14m-6 0h6v6" />,
  curve: <path d="M3 24Q4-6 25 4M3 24l3-4m15-16h4v4" />,
  doubleCurve: <path d="M3 23C3-6 25 32 25 3M3 23l4-3m14-14 4-3" />,
  note: <path d="M5 3h18v17l-6 5H5Zm12 22v-6h6M9 8h10M9 12h10M9 16h6" />,
  priceNote: <path d="M3 4h22v14H13l-7 7v-7H3Zm5 5h12M8 13h8" />,
  label: <path d="M3 6h17l5 8-5 8H3Zm6 5v6m-3-3h6" />,
  callout: <path d="M3 3h22v15H14L4 25l4-7H3Zm5 6h12m-12 4h8" />,
  comment: <path d="M25 13a11 10 0 0 1-13 10l-8 3 2-8A11 10 0 1 1 25 13ZM8 9h12M8 14h9" />,
  signpost: <path d="M13 2v24M3 5h18l5 5-5 5H3Zm5 14h10" />,
  flag: <path d="M6 26V3c6-5 11 5 18 0v13c-7 5-12-5-18 0" />,
  post: <path d="M4 4h20v20H4Zm4 5h12M8 14h12M8 19h7" />,
  idea: <path d="M10 20c0-5-5-5-5-11a9 9 0 0 1 18 0c0 6-5 6-5 11Zm0 4h8M12 27h4M14 13v7" />,
  check: <path d="m5 14 6 6L24 6" />,
  close: <path d="m6 6 16 16M6 22 22 6" />,
  objects: <path d="M4 3v19h7M4 8h7M4 15h7M14 5h11v6H14Zm0 13h11v6H14Z" />,
  zoomOut: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="m18 18 8 8M8 12h8" />
    </>
  ),
  strongMagnet: (
    <path d="M4 22V10a10 10 0 0 1 20 0v12h-6V10a4 4 0 0 0-8 0v12ZM4 16h6m8 0h6M1 10h2m22 0h2M14 0v2" />
  ),
  show: (
    <>
      <path d="M2 14s4-8 12-8 12 8 12 8-4 8-12 8S2 14 2 14Z" />
      <circle cx="14" cy="14" r="4" />
    </>
  )
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
