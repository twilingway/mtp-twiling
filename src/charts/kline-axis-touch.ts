import { DomPosition } from "klinecharts";
import type { Chart } from "klinecharts";

/** KLine 9.8.12 scales Y in its mouse path, but its touch path only dispatches overlays. */
export function attachKlineAxisTouch(container: HTMLElement, chart: Pick<Chart, "getDom">) {
  const host = container.ownerDocument?.defaultView;
  if (!host) return () => {};
  let active: { id: number; axis: HTMLElement; x: number; y: number } | null = null;
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
  const finish = (cancelled = false) => {
    const owned = active;
    if (!owned) return;
    active = null;
    // Mark cancellation as a drag so two cancelled taps cannot reset native autoscale.
    if (cancelled) send("mousemove", owned.x + 6, owned.y, owned.axis);
    send("mouseup", owned.x, owned.y, owned.axis);
  };
  const consume = (event: TouchEvent) => {
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  };
  const start = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      finish(true);
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
    active = { id: touch.identifier, axis, x: touch.clientX, y: touch.clientY };
    consume(event);
    send("mousedown", touch.clientX, touch.clientY, axis);
  };
  const move = (event: TouchEvent) => {
    const owned = active;
    if (!owned) return;
    if (event.touches.length !== 1) {
      finish(true);
      return;
    }
    const touch = Array.from(event.changedTouches).find((item) => item.identifier === owned.id);
    if (!touch) return;
    consume(event);
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
    finish(event.type === "touchcancel");
  };
  const blur = () => finish(true);
  container.addEventListener("touchstart", start, { capture: true, passive: false });
  host.addEventListener("touchmove", move, { capture: true, passive: false });
  host.addEventListener("touchend", end, { capture: true, passive: false });
  host.addEventListener("touchcancel", end, { capture: true, passive: false });
  host.addEventListener("blur", blur);
  return () => {
    finish(true);
    container.removeEventListener("touchstart", start, true);
    host.removeEventListener("touchmove", move, true);
    host.removeEventListener("touchend", end, true);
    host.removeEventListener("touchcancel", end, true);
    host.removeEventListener("blur", blur);
  };
}
