import {
  isNativeChartType,
  resolveNativeChartType,
  retainNativeChartType
} from "../../model/native-chart-type.js";
import type { ChartSettings } from "../../model/types.js";
import { preferenceRoutingScope } from "./controller-preference-routing.js";
import { importWritable } from "./controller-transfer-guard.js";
import type { TerminalPreferences, TerminalState } from "./state.js";

interface Bridge {
  editing: { flush(): Promise<void> };
  getSnapshot(): TerminalState;
  sessionKey(): unknown;
  subscribe(listener: () => void): () => void;
  saveView(): Promise<void>;
}

type Apply = (settings: ChartSettings) => Promise<void>;

export function mergeChartPreferences(
  current: TerminalPreferences,
  patch: Partial<TerminalPreferences>
): TerminalPreferences {
  return {
    ...current,
    ...patch,
    ...(patch.chartSettings && {
      chartSettings: retainNativeChartType(current.chartSettings, patch.chartSettings)
    })
  };
}

export class ChartSettingsCommands {
  private typeEpoch = 0;

  constructor(
    private readonly bridge: Bridge,
    private readonly alive: () => boolean
  ) {}

  async setType(value: unknown, apply: Apply): Promise<void> {
    if (!isNativeChartType(value)) throw new RangeError("Тип графика не поддерживается.");
    const epoch = ++this.typeEpoch;
    const initial = this.bridge.getSnapshot();
    if (
      !importWritable(initial) ||
      !this.alive() ||
      resolveNativeChartType(initial.preferences.chartSettings) === value
    )
      return;
    const scope = preferenceRoutingScope(this.bridge, this.alive, () => epoch === this.typeEpoch);
    try {
      await this.bridge.saveView();
      if (!scope.current()) return;
      await this.bridge.editing.flush();
      if (!scope.current()) return;
      const { chartSettings } = this.bridge.getSnapshot().preferences;
      await apply({ ...chartSettings, chartType: value });
    } finally {
      scope.dispose();
    }
  }

  async setOrdinary(patch: ChartSettings, apply: Apply): Promise<void> {
    const initial = this.bridge.getSnapshot();
    const session = this.bridge.sessionKey();
    const initialSettings = initial.preferences.chartSettings;
    retainNativeChartType(initialSettings, { ...initialSettings, ...patch });
    await this.bridge.saveView();
    const current = this.bridge.getSnapshot();
    if (
      !this.alive() ||
      this.bridge.sessionKey() !== session ||
      !importWritable(current, initial.owner)
    )
      return;
    const { chartSettings } = current.preferences;
    await apply(retainNativeChartType(chartSettings, { ...chartSettings, ...patch }));
  }
}
