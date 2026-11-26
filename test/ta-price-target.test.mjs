import assert from "node:assert/strict";
import test from "node:test";
import { sourceLoader } from "./helpers/market-source-loader.mjs";

const load = sourceLoader();
const { priceTargetDecorations, priceTargetStudies } = load(
  "model/technical-indicators/catalog-expansion/price-target.ts"
);
const { compileTechnicalPriceRegions, priceDecorationLayers } = load(
  "charts/technical-calendar-paint.ts"
);
const { observePriceTarget } = load("screens/terminal/price-target-request.ts");

const instrumentKey = "bank-instrument";
const asOf = Date.parse("2024-03-04T14:00:00Z");
const referenceTime = Date.parse("2024-02-29T00:00:00Z");
const horizonTimestamp = Date.parse("2025-02-28T00:00:00Z");
const day = 86_400_000;
const bar = (timestamp) => ({ timestamp, open: 100, high: 130, low: 90, close: 110, volume: 1 });
const forecast = {
  instrumentKey,
  low: 100,
  mean: 120.5,
  high: 150,
  publicationTimestamp: referenceTime + day,
  horizonTimestamp,
  currency: "RUB",
  analystCount: 4
};
const referenceClose = { instrumentKey, currency: "RUB", timestamp: referenceTime, close: 110 };
const priceTarget = { forecast, referenceClose, asOf };

test("registers a dated overlay with exact target prices and a confirmed close marker", () => {
  const bars = [bar(referenceTime - day), bar(referenceTime), bar(referenceTime + day)];
  const study = priceTargetStudies[0];
  const context = { chartInterval: "1d", historicalVolatilityPeriodsPerYear: 365, priceTarget };
  assert.equal(study.catalogId, "STD;Price%1Target");
  assert.equal(study.definition.defaultPane, "overlay");
  assert.equal(study.history({}).historyRequirement.kind, "external-forecast");
  assert.deepEqual(study.calculate(bars, {}, context), {});
  assert.equal(study.unavailableReason(bars.length, {}, context), undefined);
  const raw = study.priceRegions(bars, {}, context);
  const compiled = compileTechnicalPriceRegions(raw, study.definition.priceRegionStyles, {
    negative: { color: "#9a3455", width: 2, visible: true, lineStyle: "dotted" }
  });
  const { regions, moon, sloped } = priceDecorationLayers(compiled);
  assert.deepEqual(sloped, []);
  assert.deepEqual(
    regions.map(({ low, high }) => [low, high]),
    [
      [100, 100],
      [120.5, 120.5],
      [150, 150]
    ]
  );
  assert.deepEqual(
    regions.map(({ startTimestamp, endTimestamp }) => [startTimestamp, endTimestamp]),
    [
      [referenceTime, horizonTimestamp],
      [referenceTime, horizonTimestamp],
      [referenceTime, horizonTimestamp]
    ]
  );
  assert.equal(regions[0].styleId, "negative");
  assert.equal(regions[0].lineStyle, "dotted");
  assert.equal(regions[1].label.name, "Target · +9.55% · 2025-02-28");
  assert.deepEqual(
    moon.map(({ kind, timestamp, price }) => [kind, timestamp, price]),
    [["price-circle", referenceTime, 110]]
  );
});

test("uses a real candle anchor at daily and weekly scales; older closes have no invented candle", () => {
  const weeklyAnchor = referenceTime - 3 * day;
  const weekly = priceTargetDecorations(
    [bar(weeklyAnchor), bar(weeklyAnchor + 7 * day)],
    priceTarget,
    "1w"
  );
  assert.equal(weekly.find(({ kind }) => kind === "price-circle").timestamp, weeklyAnchor);
  const morning = referenceTime + 7 * 3_600_000;
  const evening = referenceTime + 18 * 3_600_000;
  const intraday = priceTargetDecorations(
    [bar(morning), bar(evening), bar(morning + day)],
    priceTarget,
    "1h"
  );
  assert.equal(intraday.find(({ kind }) => kind === "price-circle").timestamp, evening);
  const later = referenceTime + 3 * day;
  const after = priceTargetDecorations([bar(later)], priceTarget, "1d");
  assert.equal(after.length, 3);
  assert.ok(after.every((region) => region.extendLeft && region.startTimestamp === later));
  assert.deepEqual(priceTargetDecorations([bar(weeklyAnchor)], priceTarget, "1d"), []);
});

test("combines coincident labels and suppresses expired, unavailable or mismatched inputs", () => {
  const bars = [bar(referenceTime), bar(referenceTime + day)];
  const equal = priceTargetDecorations(
    bars,
    {
      ...priceTarget,
      forecast: { ...forecast, low: 100, mean: 100, high: 100 }
    },
    "1d"
  );
  assert.equal(equal.length, 2);
  assert.equal(equal[0].label.name, "Min / Target / Max · -9.09% · 2025-02-28");
  for (const input of [
    undefined,
    { ...priceTarget, asOf: horizonTimestamp },
    { ...priceTarget, asOf: forecast.publicationTimestamp - 1 },
    { ...priceTarget, referenceClose: { ...referenceClose, currency: "USD" } },
    { ...priceTarget, referenceClose: { ...referenceClose, instrumentKey: "wrong-uid" } }
  ]) {
    assert.deepEqual(priceTargetDecorations(bars, input, "1d"), []);
    assert.equal(
      priceTargetStudies[0].unavailableReason(
        bars.length,
        {},
        {
          historicalVolatilityPeriodsPerYear: 365,
          priceTarget: input
        }
      ),
      "external-data-unavailable"
    );
  }
});

const session = () => ({ owner: "profile-a", authenticated: true, closed: false });
const settled = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test("observes a visible bank forecast with the original as-of time and a bounded refresh schedule", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = session();
  const updates = [];
  const calls = [];
  let time = asOf;
  const stop = observePriceTarget({
    client,
    uid: instrumentKey,
    load: async (targetClient, uid, instant, signal) => {
      assert.equal(targetClient, client);
      assert.equal(uid, instrumentKey);
      assert.equal(signal.aborted, false);
      calls.push(instant);
      return calls.length === 1 ? null : { forecast, referenceClose };
    },
    now: () => time,
    active: () => true,
    publish: (value) => updates.push(value)
  });
  try {
    await settled();
    assert.deepEqual(updates, [{ status: "empty" }]);
    t.mock.timers.tick(15 * 60_000 - 1);
    assert.deepEqual(calls, [asOf]);
    time += 15 * 60_000;
    t.mock.timers.tick(1);
    await settled();
    assert.deepEqual(calls, [asOf, time]);
    assert.deepEqual(updates.at(-1), {
      status: "ready",
      currency: "RUB",
      priceTarget: { forecast, referenceClose, asOf: time }
    });
  } finally {
    stop();
  }
  t.mock.timers.tick(15 * 60_000);
  assert.equal(calls.length, 2);
});

test("suppresses late responses after a source change, auth loss or cleanup", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const switchSource of ["active", "owner", "authenticated", "closed", "stop"]) {
    const client = session();
    let live = true,
      release,
      request;
    const updates = [];
    const delayed = new Promise((resolve) => {
      release = resolve;
    });
    const stop = observePriceTarget({
      client,
      uid: instrumentKey,
      load: (_client, _uid, _asOf, signal) => {
        request = signal;
        return delayed;
      },
      now: () => asOf,
      active: () => live,
      publish: (value) => updates.push(value)
    });
    try {
      if (switchSource === "active") live = false;
      if (switchSource === "owner") client.owner = "profile-b";
      if (switchSource === "closed") client.closed = true;
      if (switchSource === "authenticated") client.authenticated = false;
      if (switchSource === "stop") {
        stop();
        assert.equal(request.aborted, true);
      }
      release({ forecast, referenceClose });
      await settled();
      assert.deepEqual(updates, []);
    } finally {
      stop();
    }
  }
});

test("an inconsistent provider response cannot publish levels and retries at the error interval", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const updates = [];
  let calls = 0;
  const stop = observePriceTarget({
    client: session(),
    uid: instrumentKey,
    load: async () => {
      calls++;
      return { forecast: { ...forecast, instrumentKey: "wrong-uid" }, referenceClose };
    },
    now: () => asOf,
    active: () => true,
    publish: (value) => updates.push(value)
  });
  try {
    await settled();
    assert.deepEqual(updates, [{ status: "error" }]);
    t.mock.timers.tick(60_000 - 1);
    assert.equal(calls, 1);
    t.mock.timers.tick(1);
    await settled();
    assert.equal(calls, 2);
  } finally {
    stop();
  }
});
