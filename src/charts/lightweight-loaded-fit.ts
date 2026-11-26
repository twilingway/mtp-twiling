import type { ITimeScaleApi, Time } from "lightweight-charts";

type Scale = Pick<
  ITimeScaleApi<Time>,
  | "width"
  | "options"
  | "applyOptions"
  | "setVisibleLogicalRange"
  | "subscribeVisibleLogicalRangeChange"
  | "subscribeSizeChange"
>;

export function lightweightLoadedFit(
  scale: Scale,
  count: () => number,
  nearStart: () => void,
  nativeChanged: () => void
) {
  const normalMinimum = scale.options().minBarSpacing || 0.5;
  let minimum = normalMinimum;
  let fitting = false;
  let fitFrame: number | null = null;
  const updateMinimum = () => {
    const width = scale.width();
    const bars = count();
    const next = width > 0 && bars > 0 ? Math.min(normalMinimum, width / bars) : normalMinimum;
    if (next !== minimum) {
      minimum = next;
      scale.applyOptions({ minBarSpacing: next });
    }
  };
  scale.subscribeSizeChange(() => {
    updateMinimum();
    const bars = count();
    if (fitting && bars && scale.width() > 0)
      scale.setVisibleLogicalRange({ from: 0, to: bars - 1 });
  });
  scale.subscribeVisibleLogicalRangeChange((range) => {
    if (!fitting && range && range.from < 80) nearStart();
    nativeChanged();
  });
  const dispose = () => {
    if (fitFrame !== null) cancelAnimationFrame(fitFrame);
    fitFrame = null;
    fitting = false;
  };
  return {
    updateMinimum,
    fit() {
      const bars = count();
      if (!bars || scale.width() <= 0) return;
      dispose();
      fitting = true;
      updateMinimum();
      scale.setVisibleLogicalRange({ from: 0, to: bars - 1 });
      // The SDK commits its public range on RAF and may then reflow the price-axis width.
      fitFrame = requestAnimationFrame(() => {
        fitFrame = requestAnimationFrame(() => {
          fitFrame = null;
          fitting = false;
        });
      });
    },
    dispose
  };
}
