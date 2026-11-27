import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";
import { settings, text, walk } from "./technical-state-oscillator-settings-fixture.mjs";

const load = sourceLoader();
const { technicalParameterLabel, technicalChoiceLabel } = load(
  "i18n/messages-technical-settings.ts"
);
const { technicalIndicatorDefinitions } = load("model/technical-indicators/definitions.ts");
const optionLabel = (select, value) =>
  text(walk(select, (node) => node.type === "option" && node.props.value === value)[0]);

test("every registered indicator parameter has a Russian settings label", () => {
  for (const { id, parameters } of technicalIndicatorDefinitions)
    for (const { key } of parameters)
      assert.match(technicalParameterLabel(key, "ru"), /\p{Script=Cyrillic}/u, `${id}/${key}`);
});

test("moving average and session settings localize their numbered fields", () => {
  const ribbon = settings("moving-average-ribbon");
  const ribbonTree = ribbon.render();
  const average = ribbon.control(ribbonTree, "Тип средней 2");
  assert.equal(average.props.value, "sma");
  assert.equal(optionLabel(average, "ema"), "EMA");
  const fourthSource = ribbon.control(ribbonTree, "Источник средней 4");
  assert.equal(optionLabel(fourthSource, "close"), "Закрытие");

  const sessions = settings("trading-sessions", "en");
  const sessionTree = sessions.render();
  assert.equal(sessions.control(sessionTree, "Session start 2").props.type, "time");
  assert.equal(sessions.control(sessionTree, "Session time zone 3").props.type, "text");
});

test("translated choice labels preserve the canonical values saved by the form", async () => {
  const fixture = settings("vwap");
  const anchors = fixture.control(fixture.render(), "Период привязки");
  assert.equal(optionLabel(anchors, "calendar-day"), "Календарный день");
  anchors.props.onChange({ target: { value: "calendar-day" } });
  await fixture.submit(fixture.render());
  assert.equal(fixture.writes[0].technicalIndicators[0].params.anchor, "calendar-day");
  assert.equal(technicalChoiceLabel("1M", "ru"), "Месяц");
  assert.equal(technicalChoiceLabel("1M", "en"), "Month");
  assert.equal(technicalChoiceLabel("1m", "ru"), "1 минута");
});
