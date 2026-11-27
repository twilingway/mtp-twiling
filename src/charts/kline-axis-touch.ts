import { DomPosition } from "klinecharts";
import type { Chart } from "klinecharts";

/** KLine 9.8.12 scales Y in its mouse path, but its touch path only dispatches overlays. */
export function attachKlineAxisTouch(container: HTMLElement, chart: Pick<Chart, "getDom">) {
  const host = container.ownerDocument?.defaultView;
  if (!host) return () => {};
  let active: {
    id: number;
    axis: HTMLElement;
    x: number;
    y: number;
    startY: number;
    started: boolean;
  } | null = null;
  const send = (type: string, x: number, y: number, axis: HTMLElement) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: type === "mouseup" ? 0 : 1,
      clientX: x,
      clientY: y
    });
    // Only our synthetic events bypass the SDK's 500ms compatibility-mouse filter.
    Object.defineProperty(event, "sourceCapabilities", { value: { firesTouchEvents: false } });
    axis.dispatchEvent(event);
  };
  const finish = () => {
    const owned = active;
    if (!owned) return;
    active = null;
    if (owned.started) send("mouseup", owned.x, owned.y, owned.axis);
  };
  const consume = (event: TouchEvent) => {
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  };
  const start = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      finish();
      return;
    }
    if (active) return;
    const axis = chart.getDom("candle_pane", DomPosition.YAxis),
      touch = event.touches[0];
    if (!axis || !touch) return;
    const rect = axis.getBoundingClientRect();
    if (
      touch.clientX < rect.left ||
      touch.clientX >= rect.right ||
      touch.clientY < rect.top ||
      touch.clientY >= rect.bottom
    )
      return;
    active = {
      id: touch.identifier,
      axis,
      x: touch.clientX,
      y: touch.clientY,
      startY: touch.clientY,
      started: false
    };
    consume(event);
  };
  const move = (event: TouchEvent) => {
    const owned = active;
    if (!owned) return;
    if (event.touches.length !== 1) {
      finish();
      return;
    }
    const touch = Array.from(event.changedTouches).find((item) => item.identifier === owned.id);
    if (!touch) return;
    consume(event);
    // Match SDK CancelClick: a stationary cancelled press must never enter manual scale mode.
    if (!owned.started) {
      if (Math.abs(touch.clientY - owned.startY) < 5) return;
      send("mousedown", owned.x, owned.startY, owned.axis);
      owned.started = true;
    }
    owned.y = touch.clientY;
    // Keep the gesture in its original axis lane if the finger drifts horizontally.
    send("mousemove", owned.x, owned.y, owned.axis);
  };
  const end = (event: TouchEvent) => {
    if (
      !active ||
      !Array.from(event.changedTouches).some((touch) => touch.identifier === active?.id)
    )
      return;
    consume(event);
    finish();
  };
  const blur = () => finish();
  container.addEventListener("touchstart", start, { capture: true, passive: false });
  host.addEventListener("touchmove", move, { capture: true, passive: false });
  host.addEventListener("touchend", end, { capture: true, passive: false });
  host.addEventListener("touchcancel", end, { capture: true, passive: false });
  host.addEventListener("blur", blur);
  return () => {
    finish();
    container.removeEventListener("touchstart", start, true);
    host.removeEventListener("touchmove", move, true);
    host.removeEventListener("touchend", end, true);
    host.removeEventListener("touchcancel", end, true);
    host.removeEventListener("blur", blur);
  };
}
