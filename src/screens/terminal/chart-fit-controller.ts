import { cameraSignature } from "../../charts/camera-events.js";
import { resolveNativeChartType } from "../../model/native-chart-type.js";
import { t } from "../../i18n/messages.js";
import { chartAdapterReadySignal } from "./chart-adapter-ready.js";
import { cameraCurrent, userCameraAction } from "./controller-camera-sync.js";
import type { TerminalController } from "./controller.js";
import { ChartFitSession } from "./chart-fit-session.js";
import type { FitResult } from "./chart-fit-session.js";

interface FitHost {
  readonly isConnected: boolean;
}
class ControllerFitProgress extends ChartFitSession {
  private host: FitHost | undefined;
  attach = (host: FitHost): (() => void) => {
    this.cancel();
    this.host = host;
    return () => {
      if (this.host !== host) return;
      this.host = undefined;
      this.cancel();
    };
  };
  fit(controller: TerminalController): Promise<FitResult> {
    const chart = controller.chart,
      snapshot = controller.getSnapshot(),
      session = controller.sessionKey(),
      cloud = controller.cloudSessionKey(),
      host = this.host,
      type = resolveNativeChartType(snapshot.preferences.chartSettings);
    const current = () => {
      const state = controller.getSnapshot();
      return !!(
        host?.isConnected &&
        this.host === host &&
        cameraCurrent(controller, chart) &&
        !state.backupBusy &&
        state.owner === snapshot.owner &&
        state.chartRevision === snapshot.chartRevision &&
        controller.sessionKey() === session &&
        controller.cloudSessionKey() === cloud &&
        resolveNativeChartType(state.preferences.chartSettings) === type
      );
    };
    return this.request({
      current,
      apply: () => {
        if (chart) userCameraAction(controller, chart, () => chart.fit());
      },
      signature: () => cameraSignature(chart?.getView() ?? null),
      pending: () => chart?.renderPending?.() ?? false,
      watch: (cancel) => {
        const stopState = controller.subscribe(cancel),
          stopAdapter = chartAdapterReadySignal(controller).subscribe(cancel);
        return () => {
          stopState();
          stopAdapter();
        };
      }
    });
  }
}
const progress = new WeakMap<TerminalController, ControllerFitProgress>();
export function chartFitProgress(controller: TerminalController): ControllerFitProgress {
  let value = progress.get(controller);
  if (!value) {
    value = new ControllerFitProgress();
    progress.set(controller, value);
  }
  return value;
}
export function requestChartFit(controller: TerminalController): void {
  const progress = chartFitProgress(controller);
  if (progress.getSnapshot()) return;
  void progress
    .fit(controller)
    .catch((error: unknown) =>
      controller.notify(
        error instanceof Error ? error.message : t("Не удалось подобрать масштаб графика.")
      )
    );
}
