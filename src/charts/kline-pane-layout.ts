import { ActionType, DomPosition } from "klinecharts";
import type { Chart } from "klinecharts";
import {
  capturedVolumeRatio,
  volumeHeightRatio,
  volumePaneHeight
} from "../model/indicator-layout.js";
import type { IndicatorPaneLayout } from "../model/types.js";

export function attachVolumePaneLayout(
  chart: Chart,
  options: {
    enabled: boolean;
    layout?: IndicatorPaneLayout | undefined;
    onChange?: ((layout: IndicatorPaneLayout) => void) | undefined;
  }
) {
  let ratio = volumeHeightRatio(options.layout),
    pending = false,
    disposed = false;
  const sizes = () => ({
    price: chart.getSize("candle_pane", DomPosition.Main)?.height ?? 0,
    volume: chart.getSize("volume_pane", DomPosition.Main)?.height ?? 0
  });
  const height = () => {
    const { price, volume } = sizes();
    return volumePaneHeight(ratio, price + volume);
  };
  const apply = () => {
    if (disposed || !options.enabled || ratio === null) return;
    const { volume } = sizes();
    if (volume <= 0) return;
    const target = height();
    if (Math.abs(target - volume) >= 1) chart.setPaneOptions({ id: "volume_pane", height: target });
  };
  const capture = () => {
    pending = false;
    if (disposed || !options.enabled) return;
    const { price, volume } = sizes(),
      next = capturedVolumeRatio(volume, price);
    if (next === null || next === ratio) return;
    ratio = next;
    options.onChange?.({ volume: { heightRatio: next } });
  };
  const onDrag = (value: unknown) => {
    if (
      disposed ||
      !options.enabled ||
      pending ||
      !value ||
      typeof value !== "object" ||
      !("paneId" in value) ||
      (value.paneId !== "" && value.paneId !== "volume_pane")
    )
      return;
    pending = true;
    // v9.8.12 emits before updating MAIN widget bounds; a microtask observes the completed viewport.
    queueMicrotask(capture);
  };
  chart.subscribeAction(ActionType.OnPaneDrag, onDrag);
  return {
    height,
    apply,
    dispose: () => {
      disposed = true;
      chart.unsubscribeAction(ActionType.OnPaneDrag, onDrag);
    }
  };
}
