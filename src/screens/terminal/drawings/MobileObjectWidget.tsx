import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore
} from "react";
import { t } from "../../../i18n/messages.js";
import { drawingStyle, TOOL_NAMES } from "../../../model/drawing-model.js";
import { isAnnotationTool } from "../../../model/drawing-annotation.js";
import type { DrawingSettings, PixelPoint } from "../../../model/types.js";
import { useTerminal } from "../context.js";
import {
  clampObjectWidget,
  defaultObjectWidgetPosition,
  selectedWidgetObject,
  widgetLineColor
} from "./mobile-object-widget.js";

const MEDIA = "(max-width: 650px), (pointer: coarse)";
const widgetPositions = new WeakMap<object, Map<string, PixelPoint>>();
const subscribeMobile = (listener: () => void) => {
  const media = window.matchMedia(MEDIA);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
};
export function useMobileObjectWidget() {
  return useSyncExternalStore(
    subscribeMobile,
    () => window.matchMedia(MEDIA).matches,
    () => false
  );
}

function viewport() {
  const visible = window.visualViewport;
  return {
    left: visible?.offsetLeft ?? 0,
    top: visible?.offsetTop ?? 0,
    width: visible?.width ?? window.innerWidth,
    height: visible?.height ?? window.innerHeight
  };
}

function activeHeading() {
  return document.querySelector<HTMLElement>(
    '.chart-panel[data-chart-active="true"] .chart-heading, [data-chart-active="true"] .chart-panel .chart-heading'
  );
}

export function MobileObjectWidget() {
  const { controller, state } = useTerminal();
  const scope = controller.tools.scopeKey();
  const object = selectedWidgetObject(state.selectedObject, state.drawings, state.images);
  const root = useRef<HTMLDivElement>(null);
  const position = useRef<PixelPoint>(
    widgetPositions.get(controller)?.get(scope) ?? { x: 12, y: 108 }
  );
  const drag = useRef<{ pointer: number; x: number; y: number; origin: PixelPoint } | null>(null);
  const [point, setPoint] = useState(position.current);
  const place = useCallback(
    (next?: PixelPoint) => {
      const bounds = root.current?.getBoundingClientRect();
      if (!bounds) return;
      if (next) {
        const saved = widgetPositions.get(controller) ?? new Map<string, PixelPoint>();
        saved.set(scope, next);
        widgetPositions.set(controller, saved);
      }
      const visible = viewport();
      const preferred = widgetPositions.get(controller)?.get(scope);
      const heading = !preferred ? activeHeading()?.getBoundingClientRect() : undefined;
      const clamped = preferred
        ? clampObjectWidget(preferred, bounds, visible)
        : defaultObjectWidgetPosition(
            bounds,
            visible,
            heading && heading.height > 0 ? heading : undefined
          );
      position.current = clamped;
      setPoint((previous) =>
        previous.x === clamped.x && previous.y === clamped.y ? previous : clamped
      );
    },
    [controller, scope]
  );
  useLayoutEffect(() => {
    place();
    const resize = () => place();
    const observer = new ResizeObserver(() => place());
    if (root.current) observer.observe(root.current);
    const heading = activeHeading();
    if (heading) observer.observe(heading);
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("scroll", resize);
    };
  }, [controller, place]);
  useEffect(() => {
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target) &&
        !(
          event.target instanceof Element &&
          event.target.closest(
            ".drawing-toolbar, #drawing-toolbar-menu, #objects-view, .selected-drawing-lock, #drawing-settings, .annotation-inline-editor"
          )
        )
      )
        controller.selectObject(null);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      controller.selectObject(null);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside, true);
      document.removeEventListener("keydown", key);
    };
  }, [controller]);
  if (!object) return null;
  const drawing = object.kind === "drawing" ? object.drawing : null;
  const id = drawing?.id ?? (object.kind === "image" ? object.image.id : "");
  const title = drawing
    ? drawing.title || t(TOOL_NAMES[drawing.name])
    : object.kind === "image"
      ? object.image.name
      : "";
  const style = drawing ? drawingStyle(drawing) : null;
  const annotation = drawing && isAnnotationTool(drawing.name);
  const run = (action: Promise<void>) =>
    void action.catch((error: unknown) =>
      controller.notify(
        error instanceof Error ? error.message : t("Не удалось выполнить действие.")
      )
    );
  const change = (patch: Partial<DrawingSettings>) => {
    // Read the current selection so consecutive controls never overwrite each other.
    const current = controller.getSnapshot().drawings.find((item) => item.id === id);
    if (current)
      run(controller.updateDrawing({ ...current, settings: { ...current.settings, ...patch } }));
  };
  return (
    <div
      ref={root}
      className="mobile-object-widget"
      role="group"
      aria-label={`${t("Выбранный объект")}: ${title}`}
      style={{ left: point.x, top: point.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        className="mobile-object-handle"
        aria-label={t("Переместить панель")}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          drag.current = {
            pointer: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            origin: position.current
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const active = drag.current;
          if (!active || active.pointer !== event.pointerId) return;
          place({
            x: active.origin.x + event.clientX - active.x,
            y: active.origin.y + event.clientY - active.y
          });
        }}
        onPointerUp={(event) => {
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          const shifts: Record<string, PixelPoint> = {
            ArrowLeft: { x: -12, y: 0 },
            ArrowRight: { x: 12, y: 0 },
            ArrowUp: { x: 0, y: -12 },
            ArrowDown: { x: 0, y: 12 }
          };
          const shift = shifts[event.key];
          if (!shift) return;
          event.preventDefault();
          place({ x: position.current.x + shift.x, y: position.current.y + shift.y });
        }}
      >
        <span aria-hidden="true">⠿</span>
      </button>
      {drawing && style && (
        <>
          {!annotation && (
            <label className="mobile-object-color" title={t("Цвет линий")}>
              <span aria-hidden="true">╱</span>
              <input
                type="color"
                aria-label={t("Цвет линий")}
                value={style.color}
                onChange={(event) => change(widgetLineColor(drawing, event.currentTarget.value))}
              />
            </label>
          )}
          <label className="mobile-object-color" title={t("Цвет текста")}>
            <span aria-hidden="true">T</span>
            <input
              type="color"
              aria-label={t("Цвет текста")}
              value={style.textColor ?? style.color}
              onChange={(event) => change({ textColor: event.currentTarget.value })}
            />
          </label>
          {annotation ? (
            <>
              <button
                type="button"
                aria-label={t(drawing.name === "priceLabel" ? "Настройки" : "Редактировать текст")}
                onClick={() => controller.setDialog("drawing-settings")}
              >
                ✎
              </button>
              <select
                aria-label={t("Размер шрифта")}
                value={style.fontSize}
                onChange={(event) => change({ fontSize: Number(event.currentTarget.value) })}
              >
                {[...new Set([10, 12, 14, 16, 18, 20, 24, 28, 32, 48, 72, style.fontSize])]
                  .sort((a, b) => a - b)
                  .map((size) => (
                    <option key={size} value={size}>
                      {size}px
                    </option>
                  ))}
              </select>
            </>
          ) : (
            <>
              <select
                aria-label={t("Толщина линии")}
                value={style.width}
                onChange={(event) => change({ width: Number(event.currentTarget.value) })}
              >
                {[1, 2, 3, 4, 5].map((width) => (
                  <option key={width} value={width}>
                    {width}px
                  </option>
                ))}
              </select>
              <select
                aria-label={t("Стиль линии")}
                value={style.lineStyle}
                onChange={(event) => {
                  const lineStyle = event.currentTarget.value;
                  if (lineStyle === "solid" || lineStyle === "dashed" || lineStyle === "dotted")
                    change({ lineStyle });
                }}
              >
                <option value="solid" aria-label={t("Линия")}>
                  ━━
                </option>
                <option value="dashed" aria-label={t("Штриховой пунктир")}>
                  ┄┄
                </option>
                <option value="dotted" aria-label={t("Точечный пунктир")}>
                  ···
                </option>
              </select>
            </>
          )}
        </>
      )}
      <button
        type="button"
        aria-label={t("Удалить")}
        onClick={() => run(controller.tools.deleteObject(id))}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="M4 6h16M9 6V3h6v3M7 6l1 15h8l1-15M10 10v7m4-7v7" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={t("Другие действия")}
        aria-haspopup="menu"
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          controller.setContext({
            x: bounds.left,
            y: bounds.bottom + 4,
            target: { kind: object.kind, id }
          });
        }}
      >
        <span aria-hidden="true">•••</span>
      </button>
    </div>
  );
}
