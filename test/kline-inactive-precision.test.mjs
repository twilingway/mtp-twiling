import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";
import { recordingContext } from "./ta-render-kline-fixture.mjs";
import { inactiveFixture } from "./kline-inactive-native-fixture.mjs";

const baseline = process.argv.includes("--baseline-88d");
const load = createSourceLoader(),
  model = load("model/technical-indicators/index.js");
const { TechnicalRenderData } = load("charts/technical-render-data.js");
const bars = Array.from({ length: 8 }, (_, i) => ({
  timestamp: (i + 1) * 1000,
  open: 1,
  high: 1,
  low: 1,
  close: 1,
  volume: 1
}));
const data = new TechnicalRenderData();
data.setData(bars);
const kc = model.createTechnicalIndicatorInstance("keltner-channels", "kc", {
  pane: { kind: "pane", id: "mixed" },
  params: { length: 2, atrLength: 2 }
});
const style = (visible, opacity = 1) =>
  Object.fromEntries(
    ["upper", "basis", "lower"].map((id) => [
      id,
      { color: "#2962FF", width: 1, visible, opacity, lineStyle: "solid" }
    ])
  );
const graphs = {
  hidden: data.compile([{ ...kc, visible: false }]),
  disabled: data.compile([{ ...kc, styles: style(false) }]),
  collapsed: data.compile([kc], [{ paneId: "mixed", heightRatio: 0.18, collapsed: true }]),
  active: data.compile([kc]),
  transparent: data.compile([{ ...kc, styles: style(true, 0) }]),
  removed: { groups: [], outputs: [], fills: [] }
};
const hash = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const own = (f) => f.entries().filter((e) => e.name.startsWith("PERSONAL_TA_"));
const refresh = (f) => f.adapter.refreshNativeMetadata?.();
const same = (actual, expected) => {
  assert.deepEqual(actual.range, expected.range);
  assert.deepEqual(actual.ticks, expected.ticks);
  assert.equal(actual.height, expected.height);
  assert.equal(actual.dom, expected.dom);
};

for (const p of [8, 6])
  for (const q of [2, 6, 8])
    test(`P2 matrix fixed${p}/quote${q}: inactive/remove exact peer domain, axis text, dimensions and identity`, async (t) => {
      const f = inactiveFixture(q, { baseline });
      t.after(() => f.dispose());
      const name = await f.peer(p),
        originalHeight = f.sample().height,
        peer = f.entries().find((e) => e.name === name),
        original = hash(peer.result);
      for (const state of ["hidden", "disabled", "collapsed"]) {
        f.chart.setPaneOptions({
          id: "technical:mixed",
          height: state === "collapsed" ? 30 : originalHeight
        });
        const before = f.sample();
        f.set(graphs[state]);
        await f.ready();
        f.flush();
        same(f.sample(), before);
        assert.equal(hash(peer.result), original);
        assert.equal(peer.precision, p);
        f.set(graphs.removed);
        await f.ready();
        f.flush();
        same(f.sample(), before);
        assert.equal(f.entries().length, 1);
      }
    });
test("P2 sync2→8→2: same peer remains baseline; inactive members use only neutral Normal metadata", async (t) => {
  const f = inactiveFixture(2, { baseline });
  t.after(() => f.dispose());
  await f.peer(8);
  const before = f.sample();
  f.set(graphs.hidden);
  await f.ready();
  for (const q of [2, 8, 2]) {
    f.chart.setPriceVolumePrecision(q, 0);
    refresh(f);
    await f.ready();
    f.flush();
    same(f.sample(), before);
  }
  assert.ok(
    own(f).every(
      (e) =>
        e.series === f.sdk.IndicatorSeries.Normal &&
        e.figures.length === 0 &&
        e.result.length === 0 &&
        e.precision === 8
    )
  );
});
test("P2 both roles are data-free neutral; hidden fill and visible decorative fill preserve original z ownership", async (t) => {
  const f = inactiveFixture(2, { baseline });
  t.after(() => f.dispose());
  await f.peer(6);
  const before = f.sample();
  f.set(graphs.hidden);
  await f.ready();
  f.flush();
  same(f.sample(), before);
  assert.equal(own(f).length, 2);
  assert.ok(
    own(f).every(
      (e) =>
        e.series === f.sdk.IndicatorSeries.Normal &&
        e.precision === 6 &&
        e.result.length === 0 &&
        e.figures.length === 0
    )
  );
  assert.ok(own(f).every((e) => !e.visible));
  f.set(graphs.disabled);
  await f.ready();
  assert.equal(own(f).find((e) => e.name.includes("FILL_")).visible, true);
  assert.ok(own(f).find((e) => !e.name.includes("FILL_")).zLevel > 0);
  assert.ok(own(f).find((e) => e.name.includes("FILL_")).zLevel < 0);
  same(f.sample(), before);
});

if (!baseline) {
  test("locked and unlocked public Price peers: synchronous metadata refresh after2→8→6→2 preserves actual baseline", async (t) => {
    for (const locked of [false, true]) {
      const f = inactiveFixture(2);
      t.after(() => f.dispose());
      await f.peer(8, f.sdk.IndicatorSeries.Price, locked);
      for (const q of [2, 8, 6, 2]) {
        f.set(graphs.removed);
        await f.ready();
        f.chart.setPriceVolumePrecision(q, 0);
        const before = f.sample();
        f.set(graphs.hidden);
        await f.ready();
        refresh(f);
        same(f.sample(), before);
        f.chart.setPriceVolumePrecision(q === 8 ? 2 : 8, 0);
        refresh(f);
        const withHidden = f.sample();
        f.set(graphs.removed);
        await f.ready();
        same(f.sample(), withHidden);
      }
    }
  });
  test("active native-price owner/companion retain unlocked6→8→6; opacity0 remains real active contributor", async (t) => {
    const f = inactiveFixture(6);
    t.after(() => f.dispose());
    await f.peer(6);
    f.set(graphs.active);
    await f.ready();
    for (const q of [6, 8, 6]) {
      f.chart.setPriceVolumePrecision(q, 0);
      refresh(f);
      assert.ok(own(f).every((e) => e.precision === q && e.series === f.sdk.IndicatorSeries.Price));
    }
    f.set(graphs.hidden);
    await f.ready();
    f.set(graphs.transparent);
    await f.ready();
    const primary = own(f).find((e) => !e.name.includes("FILL_"));
    assert.equal(primary.figures.length, 3);
    assert.equal(primary.visible, true);
    assert.equal(primary.series, f.sdk.IndicatorSeries.Price);
    f.chart.setPriceVolumePrecision(8, 0);
    refresh(f);
    assert.ok(own(f).every((e) => e.precision === 8));
  });
  test("current native real-index clamps and coalesced offscreen/all-null→finite→offscreen metadata do not rebuild rows/formulas", async (t) => {
    const f = inactiveFixture(2);
    t.after(() => f.dispose());
    await f.peer(8);
    const before = f.sample();
    const g = {
      ...graphs.active,
      outputs: graphs.active.outputs.map((o) => ({
        ...o,
        values: o.values.map((v, i) => (i < 4 ? null : v)),
        presentation: { ...o.presentation, values: o.values.map((v, i) => (i < 4 ? null : v)) }
      })),
      fills: []
    };
    f.viewport(-10, 4);
    f.set(g);
    await f.ready();
    f.flush();
    assert.ok(own(f).every((e) => e.result.length === 0));
    const rows = g.outputs.map((o) => o.values),
      count = f.compiles();
    f.viewport(4, 100);
    f.viewport(4, 100);
    f.flush();
    await f.ready();
    assert.ok(own(f).some((e) => e.figures.length === 3));
    f.viewport(-5, 4);
    f.flush();
    await f.ready();
    assert.ok(own(f).every((e) => e.figures.length === 0 && e.result.length === 0));
    assert.equal(f.compiles(), count);
    assert.ok(g.outputs.every((o, i) => o.values === rows[i]));
    const noops = f.calls.length;
    refresh(f);
    refresh(f);
    assert.equal(f.calls.length, noops);
    f.viewport(0, 8);
    f.flush();
    f.set(graphs.removed);
    await f.ready();
    f.flush();
    same(f.sample(), before);
  });
  test("sole empty own pane holds data-free Normal0; active peer joining borrows from peer without decorator cycles", async (t) => {
    const f = inactiveFixture(2);
    t.after(() => f.dispose());
    f.set(graphs.hidden);
    await f.ready();
    f.flush();
    const pane = f.chart.getDom("technical:mixed"),
      h = f.sample().height;
    assert.ok(
      own(f).every(
        (e) =>
          e.precision === 0 &&
          e.series === f.sdk.IndicatorSeries.Normal &&
          e.figures.length === 0 &&
          e.result.length === 0
      )
    );
    await f.peer(6);
    refresh(f);
    assert.ok(own(f).every((e) => e.precision === 6));
    assert.equal(f.chart.getDom("technical:mixed"), pane);
    assert.equal(f.sample().height, h);
    for (const graph of [graphs.active, graphs.hidden, graphs.transparent, graphs.collapsed]) {
      f.set(graph);
      await f.ready();
      f.flush();
      assert.equal(f.chart.getDom("technical:mixed"), pane);
    }
    assert.equal(f.destroyed.length, 0);
  });
  test("all-null visible legacy levels still paint through legitimate peer domain; whole hide/collapse disables them", async (t) => {
    const f = inactiveFixture(2);
    t.after(() => f.dispose());
    await f.peer(6, f.sdk.IndicatorSeries.Normal, false, [0, 100, 10, 90, 20, 80, 30, 70]);
    const rsi = model.createTechnicalIndicatorInstance("rsi", "rsi", {
        pane: { kind: "pane", id: "mixed" }
      }),
      g = data.compile([rsi]);
    assert.ok(g.outputs[0].values.every((v) => v === null));
    f.set(g);
    await f.ready();
    const entry = own(f)[0];
    assert.equal(entry.result.length, 0);
    assert.equal(entry.visible, true);
    const pane = f.chart.getDrawPaneById("technical:mixed"),
      ctx = recordingContext();
    entry.draw({
      ctx,
      indicator: entry,
      bounding: { width: 300, height: pane.height },
      visibleRange: f.chart.getVisibleRange(),
      barSpace: { bar: 10, gapBar: 8 },
      xAxis: { convertToPixel: (i) => i * 10 },
      yAxis: { convertToPixel: (v) => f.sdk.YAxisImp.prototype.convertToPixel.call(pane.axis, v) }
    });
    assert.equal(ctx.calls.filter((c) => c[0] === "stroke").length, g.outputs[0].levels.length);
    f.set(data.compile([{ ...rsi, visible: false }]));
    await f.ready();
    assert.ok(own(f).every((e) => !e.visible));
  });
  test("rapid active/idle/remove and retired async calc never republish removed native members; dispose cancels queued work", async (t) => {
    const f = inactiveFixture(2);
    await f.peer(6);
    f.hold();
    for (const g of [
      graphs.active,
      graphs.hidden,
      graphs.transparent,
      graphs.disabled,
      graphs.hidden
    ])
      f.set(g);
    const queued = [...f.frames.values()];
    f.set(graphs.removed);
    f.dispose();
    f.release();
    await f.ready();
    for (const cb of queued) cb();
    assert.equal(own(f).length, 0);
    assert.ok([...f.actions.values()].every((set) => set.size === 0));
    assert.equal(f.frames.size, 0);
    const count = f.calls.length;
    refresh(f);
    f.emit("onVisibleRangeChange");
    f.flush();
    assert.equal(f.calls.length, count);
  });
  test("future fixed2 native peer remains exact without adding a production definition", async (t) => {
    const f = inactiveFixture(8);
    t.after(() => f.dispose());
    await f.peer(2);
    const before = f.sample();
    for (const g of [graphs.hidden, graphs.disabled]) {
      f.set(g);
      await f.ready();
      f.flush();
      same(f.sample(), before);
      assert.ok(own(f).every((e) => e.precision === 2));
    }
  });
  test("owned active ST Price peer plus fixed6 peer keeps exact baseline when inactive KC joins across2→8→6→2", async (t) => {
    const f = inactiveFixture(2);
    t.after(() => f.dispose());
    await f.peer(6);
    const st = model.createTechnicalIndicatorInstance("supertrend", "st", {
      pane: { kind: "pane", id: "mixed" },
      params: { atrLength: 2, factor: 3 }
    });
    for (const q of [2, 8, 6, 2]) {
      f.set(data.compile([st]));
      await f.ready();
      f.chart.setPriceVolumePrecision(q, 0);
      refresh(f);
      f.flush();
      const before = f.sample();
      f.set(data.compile([st, { ...kc, visible: false }]));
      await f.ready();
      f.flush();
      same(f.sample(), before);
      assert.ok(
        own(f)
          .filter((e) => e.name.includes("IDLE_"))
          .every((e) => e.precision === Math.min(6, q))
      );
    }
  });
  test("all plots disabled still draw a real independent KC fill through legitimate peer domain without changing range", async (t) => {
    const f = inactiveFixture(2);
    t.after(() => f.dispose());
    const wide = bars.map((b) => ({ ...b, high: 1.01, low: 0.99 }));
    f.bars.splice(0, 8, ...wide);
    const source = new TechnicalRenderData();
    source.setData(wide);
    const g = source.compile([{ ...kc, styles: style(false) }]);
    await f.peer(
      6,
      f.sdk.IndicatorSeries.Normal,
      false,
      [0.9, 1.1, 0.91, 1.09, 0.92, 1.08, 0.93, 1.07]
    );
    const before = f.sample();
    f.set(g);
    await f.ready();
    f.flush();
    same(f.sample(), before);
    const fill = own(f).find((e) => e.name.includes("FILL_")),
      pane = f.chart.getDrawPaneById("technical:mixed"),
      ctx = recordingContext();
    fill.draw({
      ctx,
      indicator: fill,
      bounding: { width: 300, height: pane.height },
      visibleRange: f.chart.getVisibleRange(),
      barSpace: { bar: 10, gapBar: 8 },
      xAxis: { convertToPixel: (i) => i * 10 },
      yAxis: { convertToPixel: (v) => f.sdk.YAxisImp.prototype.convertToPixel.call(pane.axis, v) }
    });
    assert.equal(fill.result.length, 0);
    assert.equal(fill.figures.length, 0);
    assert.equal(ctx.calls.filter((c) => c[0] === "fill").length, 1);
    const ys = ctx.calls.filter((c) => c[0] === "moveTo" || c[0] === "lineTo").map((c) => c[2]);
    assert.ok(ys.every((y) => y >= 0 && y <= pane.height));
    assert.ok(
      ctx.calls.some((c) => c[0] === "set" && c[1] === "fillStyle" && c[2].endsWith(",0.05)"))
    );
    source.dispose();
  });
  test("multiple idle studies never borrow from holders; peer remove restores empty Normal0 with same live pane", async (t) => {
    const f = inactiveFixture(8);
    t.after(() => f.dispose());
    const second = { ...kc, id: "kc2", visible: false, order: 1 };
    f.set(data.compile([{ ...kc, visible: false }, second]));
    await f.ready();
    f.flush();
    const pane = f.chart.getDom("technical:mixed");
    assert.ok(own(f).every((e) => e.precision === 0));
    const name = await f.peer(8);
    refresh(f);
    assert.ok(own(f).every((e) => e.precision === 8));
    f.chart.removeIndicator("technical:mixed", name);
    refresh(f);
    assert.ok(own(f).every((e) => e.precision === 0));
    assert.equal(f.chart.getDom("technical:mixed"), pane);
  });
  test("main candle domain stays exact on price precision changes; metadata refresh is reentry/noop safe", async (t) => {
    const f = inactiveFixture(2);
    t.after(() => f.dispose());
    const overlay = { ...kc, pane: { kind: "overlay" }, visible: false };
    for (const q of [2, 8, 6, 2]) {
      f.set(graphs.removed);
      await f.ready();
      f.chart.setPriceVolumePrecision(q, 0);
      const before = f.sample("candle_pane");
      f.set(data.compile([overlay]));
      await f.ready();
      refresh(f);
      same(f.sample("candle_pane"), before);
    }
    const original = f.chart.overrideIndicator;
    let reentries = 0;
    f.chart.overrideIndicator = (...args) => {
      const value = original(...args);
      reentries++;
      refresh(f);
      return value;
    };
    f.chart.setPriceVolumePrecision(8, 0);
    refresh(f);
    assert.equal(reentries, 2);
    const calls = f.calls.length;
    refresh(f);
    assert.equal(f.calls.length, calls);
  });
  test("reentrant data/style update during native creation drains only the latest plan and retires earlier contexts", async (t) => {
    const f = inactiveFixture(2);
    t.after(() => f.dispose());
    await f.peer(6);
    const create = f.chart.createIndicator;
    let redirected = false;
    f.chart.createIndicator = (...args) => {
      const result = create(...args);
      if (!redirected && args[0].name.startsWith("PERSONAL_TA_PRICE_")) {
        redirected = true;
        f.set(graphs.hidden);
        f.set(graphs.disabled);
      }
      return result;
    };
    f.set(graphs.active);
    await f.ready();
    f.flush();
    assert.equal(redirected, true);
    assert.equal(own(f).length, 2);
    assert.ok(own(f).every((e) => e.name.includes("IDLE_") && !e.extendData.context.disposed));
    assert.equal(own(f).find((e) => e.name.includes("FILL_")).visible, true);
    assert.equal(f.destroyed.length, 0);
  });
  test("dispose reentry during native create cannot orphan staged primary/fill members", async () => {
    const f = inactiveFixture(2);
    await f.peer(6);
    const create = f.chart.createIndicator;
    let disposed = false;
    f.chart.createIndicator = (...args) => {
      const result = create(...args);
      if (!disposed && args[0].name.startsWith("PERSONAL_TA_")) {
        disposed = true;
        f.dispose();
      }
      return result;
    };
    f.set(graphs.active);
    await f.ready();
    f.flush();
    assert.equal(disposed, true);
    assert.equal(own(f).length, 0);
    assert.equal(f.frames.size, 0);
    assert.ok([...f.actions.values()].every((set) => set.size === 0));
  });
  test("same viewport precision-only refresh reuses public eligibility without scanning numeric arrays again", async (t) => {
    const f = inactiveFixture(2);
    t.after(() => f.dispose());
    await f.peer(6);
    let reads = 0;
    const g = {
      ...graphs.active,
      outputs: graphs.active.outputs.map((o) => ({
        ...o,
        values: new Proxy(o.values, {
          get(target, key, receiver) {
            if (typeof key === "string" && /^\d+$/.test(key)) reads++;
            return Reflect.get(target, key, receiver);
          }
        })
      }))
    };
    f.set(g);
    await f.ready();
    f.flush();
    const afterUpdate = reads;
    refresh(f);
    refresh(f);
    assert.equal(reads, afterUpdate);
    f.viewport(2, 7);
    f.flush();
    assert.ok(reads > afterUpdate);
    const afterPan = reads;
    f.chart.setPriceVolumePrecision(8, 0);
    refresh(f);
    assert.equal(reads, afterPan);
  });
  test("same ID definition-policy replacement never duplicates the shared idle family and preserves later active precision policy", async (t) => {
    const f = inactiveFixture(8);
    t.after(() => f.dispose());
    await f.peer(6);
    f.set(graphs.hidden);
    await f.ready();
    const pane = f.chart.getDom("technical:mixed");
    const rsi = model.createTechnicalIndicatorInstance("rsi", "kc", {
      pane: { kind: "pane", id: "mixed" }
    });
    f.set(data.compile([rsi]));
    await f.ready();
    assert.equal(own(f).length, 1);
    assert.ok(own(f)[0].name.includes("IDLE_"));
    assert.equal(f.chart.getDom("technical:mixed"), pane);
    f.set(data.compile([{ ...rsi, params: { ...rsi.params, length: 2 } }]));
    await f.ready();
    assert.equal(own(f)[0].precision, 6);
    assert.equal(own(f)[0].series, f.sdk.IndicatorSeries.Normal);
    f.set(graphs.active);
    await f.ready();
    assert.ok(own(f).every((e) => e.series === f.sdk.IndicatorSeries.Price && e.precision === 8));
    assert.equal(f.chart.getDom("technical:mixed"), pane);
  });
}
