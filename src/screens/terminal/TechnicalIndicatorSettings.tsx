import { useRef, useState } from "react";
import { useTerminal } from "./context.js";
import { Modal } from "./Modal.js";
import { useIndicatorMenuAction } from "./useIndicatorMenuAction.js";
import { updateTechnicalIndicator } from "./technical-indicator-actions.js";
import {
  getTechnicalIndicatorDefinition,
  PRICE_SOURCES,
  technicalIndicatorDefinitions
} from "../../model/technical-indicators/definitions.js";
import { isTechnicalIndicatorInstance } from "../../model/technical-indicators/instances.js";
import type {
  OutputStyle,
  TechnicalIndicatorInstance
} from "../../model/technical-indicators/types.js";
import {
  technicalIndicatorGroups,
  technicalPaneKey
} from "../../model/technical-indicator-layout.js";

const labels: Readonly<Record<string, readonly [string, string]>> = {
  length: ["Период", "Length"],
  source: ["Источник", "Source"],
  multiplier: ["Множитель", "Multiplier"],
  fastLength: ["Быстрый период", "Fast length"],
  slowLength: ["Медленный период", "Slow length"],
  middleLength: ["Средний период", "Middle length"],
  signalLength: ["Сигнальный период", "Signal length"],
  smoothK: ["Сглаживание K", "K smoothing"],
  smoothD: ["Сглаживание D", "D smoothing"],
  expansionLength: ["Период максимального расширения", "Highest expansion length"],
  contractionLength: ["Период минимального сжатия", "Lowest contraction length"]
};

export function TechnicalIndicatorSettings({ instance }: { instance: TechnicalIndicatorInstance }) {
  const { controller, state } = useTerminal();
  const initial = useRef({ state, session: controller.sessionKey(), instance }).current;
  const english = state.preferences.locale === "en";
  const text = (ru: string, en: string) => (english ? en : ru);
  const definition = technicalIndicatorDefinitions.find(
    (item) => item.id === instance.definitionId
  )!;
  const [parameters, setParameters] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(instance.params).map(([key, value]) => [key, String(value)]))
  );
  const [pane, setPane] = useState(technicalPaneKey(instance.pane));
  const [styles, setStyles] = useState<Record<string, OutputStyle>>(() =>
    Object.fromEntries(
      definition.outputs.map((output) => [
        output.id,
        {
          color: output.color,
          width: 1,
          visible: true,
          opacity: 1,
          lineStyle: "solid",
          ...instance.styles?.[output.id]
        }
      ])
    )
  );
  const [error, setError] = useState("");
  const { pending, run } = useIndicatorMenuAction(controller);
  const groups = technicalIndicatorGroups(state.preferences.technicalIndicators ?? []);
  const ownPane = `pane:${instance.id}`;
  const availablePanes = [
    ...new Set([
      ownPane,
      ...groups.filter((group) => group.pane.kind === "pane").map((group) => group.key)
    ])
  ];
  const current =
    state.owner === initial.state.owner &&
    controller.sessionKey() === initial.session &&
    state.chartRevision === initial.state.chartRevision &&
    state.preferences.symbol === initial.state.preferences.symbol &&
    state.preferences.instrumentUid === initial.state.preferences.instrumentUid &&
    state.preferences.timeframe === initial.state.preferences.timeframe &&
    state.preferences.engine === initial.state.preferences.engine;
  const style = (id: string, patch: Partial<OutputStyle>) =>
    setStyles((previous) => ({ ...previous, [id]: { ...previous[id]!, ...patch } }));
  return (
    <Modal
      id="technical-indicator-settings"
      title={definition.title}
      onClose={() => controller.setDialog(null)}
    >
      <form
        className="technical-settings"
        onSubmit={(event) => {
          event.preventDefault();
          const candidate: unknown = {
            ...instance,
            params: Object.fromEntries(
              definition.parameters.map((parameter) => [
                parameter.key,
                parameter.type === "source"
                  ? parameters[parameter.key]
                  : Number(parameters[parameter.key])
              ])
            ),
            pane: pane === "price" ? { kind: "overlay" } : { kind: "pane", id: pane.slice(5) },
            styles
          };
          if (!current || !isTechnicalIndicatorInstance(candidate)) {
            setError(
              text(
                "Проверьте параметры. График или аккаунт мог измениться.",
                "Check parameters. The chart or account may have changed."
              )
            );
            return;
          }
          void run(async () => {
            await updateTechnicalIndicator(
              controller,
              instance.id,
              () => candidate,
              initial.instance
            );
            if (controller.getSnapshot().dialog === "technical-settings")
              controller.setDialog(null);
          });
        }}
      >
        <fieldset disabled={pending || !current}>
          <legend>{text("Параметры", "Inputs")}</legend>
          {definition.parameters.map((parameter) => (
            <label key={parameter.key}>
              <span>{labels[parameter.key]?.[english ? 1 : 0] ?? parameter.key}</span>
              {parameter.type === "source" ? (
                <select
                  value={parameters[parameter.key]}
                  onChange={(event) =>
                    setParameters({ ...parameters, [parameter.key]: event.target.value })
                  }
                >
                  {PRICE_SOURCES.map((source) => (
                    <option key={source}>{source}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  required
                  min={parameter.min}
                  max={parameter.max}
                  step={parameter.type === "integer" ? 1 : "any"}
                  value={parameters[parameter.key]}
                  onChange={(event) =>
                    setParameters({ ...parameters, [parameter.key]: event.target.value })
                  }
                />
              )}
            </label>
          ))}
          <label>
            <span>{text("Расположение", "Location")}</span>
            <select value={pane} onChange={(event) => setPane(event.target.value)}>
              <option value="price">{text("На графике цены", "On the price chart")}</option>
              {availablePanes.map((key, index) => (
                <option key={key} value={key}>
                  {key === ownPane
                    ? text("Своя отдельная панель", "Own separate pane")
                    : `${text("Панель", "Pane")} ${index + 1}: ${groups
                        .find((group) => group.key === key)
                        ?.instances.map((item) => {
                          const entry = getTechnicalIndicatorDefinition(item.definitionId);
                          return entry?.status === "computed"
                            ? entry.shortTitle
                            : item.definitionId;
                        })
                        .join(", ")}`}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <fieldset disabled={pending || !current}>
          <legend>{text("Стиль", "Style")}</legend>
          {definition.outputs.map((output) => {
            const value = styles[output.id]!;
            return (
              <div key={output.id} className="technical-output-style">
                <label>
                  <input
                    type="checkbox"
                    checked={value.visible}
                    onChange={(event) => style(output.id, { visible: event.target.checked })}
                  />
                  {output.title}
                </label>
                <label>
                  {text("Цвет", "Color")}
                  <input
                    type="color"
                    value={value.color}
                    onChange={(event) => style(output.id, { color: event.target.value })}
                  />
                </label>
                <label>
                  {text("Толщина", "Width")}
                  <input
                    type="number"
                    min="1"
                    max="4"
                    required
                    value={value.width}
                    onChange={(event) => style(output.id, { width: Number(event.target.value) })}
                  />
                </label>
                <label>
                  {text("Линия", "Line")}
                  <select
                    value={value.lineStyle}
                    onChange={(event) =>
                      style(output.id, {
                        lineStyle: event.target.value as NonNullable<OutputStyle["lineStyle"]>
                      })
                    }
                  >
                    <option value="solid">━━━━</option>
                    <option value="dashed">╍ ╍ ╍</option>
                    <option value="dotted">· · · · ·</option>
                  </select>
                </label>
                <label className="technical-opacity">
                  {text("Непрозрачность", "Opacity")}
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round((value.opacity ?? 1) * 100)}
                    onChange={(event) =>
                      style(output.id, { opacity: Number(event.target.value) / 100 })
                    }
                  />
                  <output>{Math.round((value.opacity ?? 1) * 100)}%</output>
                </label>
                <svg width="100%" height="12" aria-hidden="true">
                  <path
                    d="M2 6H220"
                    stroke={value.color}
                    strokeWidth={value.width}
                    opacity={value.opacity}
                    strokeDasharray={
                      value.lineStyle === "dashed"
                        ? "8 5"
                        : value.lineStyle === "dotted"
                          ? "2 4"
                          : undefined
                    }
                  />
                </svg>
              </div>
            );
          })}
        </fieldset>
        {error && <p role="alert">{error}</p>}
        {!current && (
          <p role="alert">
            {text(
              "График изменился. Откройте настройки заново.",
              "The chart changed. Reopen settings."
            )}
          </p>
        )}
        <footer>
          <button type="button" onClick={() => controller.setDialog(null)}>
            {text("Отмена", "Cancel")}
          </button>
          <button className="primary-button" disabled={pending || !current}>
            {text("Сохранить", "Save")}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
