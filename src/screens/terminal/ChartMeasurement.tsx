import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { chartPriceFormat, nativePriceStep, priceStepDecimals } from "../../charts/price-format.js";
import { formatNumber } from "../../i18n/format.js";
import { t } from "../../i18n/messages.js";
import { intlLocale } from "../../i18n/preferences.js";
import type { Locale } from "../../i18n/preferences.js";
import { measureChartRange } from "../../model/chart-measurement.js";
import { selectedMarketRow } from "../../model/selected-instrument.js";
import type { DrawingPoint, PixelPoint } from "../../model/types.js";
import { chartMeasurement } from "./chart-measurement-session.js";
import { useTerminal } from "./context.js";
import type { TerminalController } from "./controller.js";
import type { TerminalState } from "./state.js";
import { DrawingToolIcon } from "./DrawingToolIcon.js";

const strings = {
  en: {
    first: "Pick the first point",
    second: "Pick the second point",
    result: "Measurement",
    bars: "Bars",
    elapsed: "Elapsed"
  },
  ru: {
    first: "Укажите первую точку",
    second: "Укажите вторую точку",
    result: "Результат измерения",
    bars: "Свечи",
    elapsed: "Время"
  }
};

export function ChartMeasurementButton({ onChoose }: { onChoose: () => void }) {
  const { controller, state } = useTerminal();
  const session = chartMeasurement(controller);
  const active = useSyncExternalStore(session.subscribe, session.isActive, session.isActive);
  const label = t("Линейка", state.preferences.locale);
  return (
    <button
      id="measure"
      type="button"
      className={`tool ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={!state.candles.length || state.historyViewReady === false}
      onClick={() => {
        onChoose();
        if (!active && state.activeTool) controller.setTool(null);
        session.toggle();
      }}
    >
      <DrawingToolIcon name="ruler" />
    </button>
  );
}

interface Projection {
  from: PixelPoint;
  to: PixelPoint | null;
  width: number;
  height: number;
}

function useProjection(
  controller: TerminalController,
  projection: EventTarget | undefined,
  start: DrawingPoint | undefined,
  end: DrawingPoint | null
) {
  const [view, setView] = useState<Projection | null>(null);
  useLayoutEffect(() => {
    if (!start) {
      setView(null);
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const chart = controller.chart;
      if (!chart || chart.retired) {
        setView(null);
        return;
      }
      const { width, height } = chart.plotSize();
      const from = chart.pointToPixel(start);
      const to = end && chart.pointToPixel(end);
      const next =
        from && (!end || to) && width > 0 && height > 0 ? { from, to, width, height } : null;
      setView((previous) =>
        previous?.width === next?.width &&
        previous?.height === next?.height &&
        previous?.from.x === next?.from.x &&
        previous?.from.y === next?.from.y &&
        previous?.to?.x === next?.to?.x &&
        previous?.to?.y === next?.to?.y
          ? previous
          : next
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    projection?.addEventListener("change", schedule);
    return () => {
      projection?.removeEventListener("change", schedule);
      cancelAnimationFrame(frame);
    };
  }, [controller, projection, start, end]);
  return view;
}

function elapsedText(milliseconds: number, locale: Locale): string {
  let seconds = Math.round(milliseconds / 1000);
  const parts = [];
  for (const [unit, length] of [
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1]
  ] as const) {
    const count = Math.floor(seconds / length);
    seconds %= length;
    if (count || (unit === "second" && !parts.length))
      parts.push(
        new Intl.NumberFormat(intlLocale(locale), {
          style: "unit",
          unit,
          unitDisplay: "narrow"
        }).format(count)
      );
  }
  return parts.join(" ");
}

function arrowPath(from: PixelPoint, to: PixelPoint): string | undefined {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!length) return undefined;
  const head = Math.min(6, length / 3) / length;
  const baseX = to.x - dx * head;
  const baseY = to.y - dy * head;
  const wingX = dy * head * 0.55;
  const wingY = dx * head * 0.55;
  return `M${from.x} ${from.y}L${to.x} ${to.y}M${baseX - wingX} ${baseY + wingY}L${to.x} ${to.y}L${baseX + wingX} ${baseY - wingY}`;
}

export function ChartMeasurementOverlay({
  controller,
  state,
  drawingProjection
}: {
  controller: TerminalController;
  state: TerminalState;
  drawingProjection?: EventTarget;
}) {
  const session = chartMeasurement(controller);
  const selection = useSyncExternalStore(session.subscribe, session.get, session.get);
  const start = "from" in selection ? selection.from : undefined;
  const end = "to" in selection ? selection.to : null;
  const view = useProjection(controller, drawingProjection, start, end);
  const active = selection.phase !== "idle";
  useEffect(() => {
    if (!active) return;
    const dismiss = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !(event.target instanceof Element && event.target.closest("input,textarea,select,dialog"))
      )
        session.dismiss();
    };
    document.addEventListener("keydown", dismiss, true);
    return () => document.removeEventListener("keydown", dismiss, true);
  }, [active, session]);
  if (!active) return null;
  const locale = state.preferences.locale ?? "ru";
  const text = strings[locale];
  if (!view || !start)
    return (
      <div className="chart-measurement-prompt" role="status">
        {text.first}
      </div>
    );
  const { from, width, height } = view;
  const to = view.to ?? from;
  const minX = Math.min(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const maxX = Math.max(from.x, to.x);
  const maxY = Math.max(from.y, to.y);
  if (maxX < 0 || minX > width || maxY < 0 || minY > height) return null;
  const result = end && measureChartRange(start, end, state.candles);
  const change = result?.change ?? 0;
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const timeArrow =
    end && start.timestamp !== end.timestamp
      ? arrowPath({ x: from.x, y: midY }, { x: to.x, y: midY })
      : undefined;
  const priceArrow = change ? arrowPath({ x: midX, y: from.y }, { x: midX, y: to.y }) : undefined;
  const row = selectedMarketRow(state.rows, state.preferences);
  const step = nativePriceStep(row);
  const digits = step
    ? Math.min(9, priceStepDecimals(step))
    : row
      ? chartPriceFormat(row).precision
      : 2;
  const amount = result && formatNumber(result.change, digits, true, { locale });
  const percent =
    result && result.percent !== null
      ? `${formatNumber(result.percent, 2, true, { locale })}%`
      : "—";
  const inset = Math.min(6, width / 4, height / 4);
  const cardWidth = Math.min(254, width - 2 * inset);
  const left = Math.max(inset, Math.min(width - cardWidth - inset, midX - cardWidth / 2));
  const top = Math.max(inset, Math.min(height - inset, maxY + 9));
  return (
    <div
      className="chart-measurement"
      style={{ width, height }}
      data-measurement={selection.phase}
      data-measurement-direction={direction}
    >
      <svg width={width} height={height} aria-hidden="true">
        {minX < maxX && minY < maxY && (
          <rect
            x={minX}
            y={minY}
            width={maxX - minX}
            height={maxY - minY}
            className="chart-measurement-area"
          />
        )}
        {timeArrow && <path d={timeArrow} className="chart-measurement-arrow" />}
        {priceArrow && <path d={priceArrow} className="chart-measurement-arrow" />}
        {(minX < maxX || minY < maxY) && <circle cx={to.x} cy={to.y} r="4" />}
        <circle cx={from.x} cy={from.y} r="4" />
      </svg>
      <div
        className="chart-measurement-card"
        data-compact={cardWidth < 185 || height < 110 ? "true" : undefined}
        style={{
          left,
          top,
          width: cardWidth,
          maxHeight: height - 2 * inset,
          // The translate percentage uses the card's actual height, including wrapped lines.
          transform: `translateY(min(0px, calc(${height - inset - top}px - 100%)))`
        }}
        role={selection.phase === "result" || !result ? "status" : undefined}
        aria-label={selection.phase === "result" ? text.result : undefined}
      >
        {result ? (
          <>
            <strong className="chart-measurement-change">
              <span>{amount}</span>
              <span>{percent}</span>
            </strong>
            <dl className="chart-measurement-stats">
              <div>
                <dt>{text.bars}</dt>
                <dd>{formatNumber(result.bars, 0, false, { locale })}</dd>
              </div>
              <div>
                <dt>{text.elapsed}</dt>
                <dd>{elapsedText(result.elapsed, locale)}</dd>
              </div>
            </dl>
          </>
        ) : (
          text.second
        )}
      </div>
    </div>
  );
}
