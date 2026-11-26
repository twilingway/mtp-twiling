import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fixture, plot, fill, graph, canvas } from "./ta-render-lightweight-fixture.mjs";

const cross = { kind: "cross", size: { unit: "pine-relative", value: 1 } },
  line = { kind: "line", gaps: "break" };
const commands = (paint, name) => paint.filter((command) => command[0] === name);

test("cross native carrier includes only finite prices; primitive draws separate pluses with DPR and clipping", () => {
  const output = plot(cross, [10, null, 15]),
    f = fixture(graph([output]));
  f.render();
  const s = f.series()[0];
  assert.equal(s.kind, "Line");
  assert.equal(s.options.lineVisible, false);
  assert.equal(s.options.pointMarkersVisible, false);
  assert.equal(s.options.crosshairMarkerVisible, false);
  assert.equal(s.options.priceLineVisible, false);
  assert.equal(s.options.lastValueVisible, false);
  assert.deepEqual(s.data, [{ time: 1, value: 10 }, { time: 2 }, { time: 3, value: 15 }]);
  assert.deepEqual(s.range(), { priceRange: { minValue: 10, maxValue: 15 } });
  const paint = f.paint(false, 2, 3);
  assert.equal(commands(paint, "stroke").length, 2);
  assert.equal(commands(paint, "arc").length, 0);
  assert.equal(commands(paint, "lineTo").length, 4);
  assert.deepEqual(commands(paint, "moveTo")[0], ["moveTo", 14, 270]);
  assert.deepEqual(commands(paint, "rect")[0], ["rect", 0, 0, 600, 600]);
  assert.equal(commands(paint, "clip").length, 1);
  assert.equal(commands(paint, "save").length, commands(paint, "restore").length);
  f.adapter.dispose();
});
test("linebr uses original indexed runs without bridges and gives a singleton a square horizontal cap", () => {
  const f = fixture(graph([plot(line, [10, 11, null, 25, null, 30, 31])]));
  f.render();
  const paint = f.paint(),
    moves = commands(paint, "moveTo"),
    ends = commands(paint, "lineTo");
  assert.equal(commands(paint, "stroke").length, 3);
  assert.ok(moves.some((c) => c[1] === 39.5 && c[2] === 75));
  assert.ok(ends.some((c) => c[1] === 40.5 && c[2] === 75));
  assert.ok(!ends.some((c) => c[1] === 40 && c[2] === 75));
  assert.equal(commands(paint, "arc").length, 0);
  f.adapter.dispose();
});
test("paired fills draw only adjacent known pairs in normal background; firstbar/null/singletons never bridge", () => {
  const output = plot(line, [null, 10, 11, null, 15, null, 20, 21]),
    area = fill(output, [null, 5, 6, 7, 8, null, 9, 10], output.values),
    f = fixture(graph([output], [area]));
  f.render();
  assert.equal(f.series().length, 1);
  assert.equal(f.series()[0].primitives.size, 2);
  const foreground = f.paint(),
    background = f.paint(true, 2);
  assert.equal(commands(foreground, "fill").length, 0);
  assert.equal(commands(background, "stroke").length, 0);
  assert.equal(commands(background, "fill").length, 2);
  assert.ok(commands(background, "fillStyle").some((c) => c[1] === "rgba(76,175,80,0.1)"));
  const primitives = [...f.series()[0].primitives];
  assert.ok(primitives.every((p) => p.autoscaleInfo() === null));
  f.adapter.dispose();
});
test("hidden stroke with visible fill retains a finite existing coordinate carrier but contributes no autoscale", () => {
  const output = plot(line, [10, 11], {
      style: { color: "#2962ff", width: 1, visible: false, opacity: 1, lineStyle: "solid" }
    }),
    area = fill(output, [1000, 1100], [10, 11]),
    f = fixture(graph([output], [area]));
  f.render();
  const s = f.series()[0];
  assert.equal(s.options.visible, true);
  assert.equal(s.options.lineVisible, false);
  assert.equal(s.range(), null);
  assert.deepEqual(s.data, [
    { time: 1, value: 10 },
    { time: 2, value: 11 }
  ]);
  assert.equal(commands(f.paint(), "stroke").length, 0);
  assert.equal(commands(f.paint(true), "fill").length, 1);
  f.render(graph([output], [{ ...area, visible: false }]));
  assert.equal(s.options.visible, false);
  assert.equal(s.range(), null);
  assert.equal(commands(f.paint(true), "fill").length, 0);
  f.adapter.dispose();
});
test("down-only fill projects through another existing plot when preferred owner has no firstValue", () => {
  const up = plot(line, [null, null], { key: "owner/up", outputId: "up" }),
    down = plot(line, [20, 21], { key: "owner/down", outputId: "down" }),
    area = fill(up, [10, 11], down.values),
    f = fixture(graph([up, down], [area]));
  f.render();
  assert.equal(f.series().length, 2);
  assert.equal(f.series()[0].range(), null);
  assert.equal(commands(f.paint(true), "fill").length, 1);
  assert.ok(f.nativeCalls.every((call) => Number.isFinite(call[1])));
  f.render(graph([up, { ...down, values: [null, null] }], [area]));
  assert.equal(commands(f.paint(true), "fill").length, 0);
  assert.equal(f.series().length, 2);
  f.adapter.dispose();
});
test("fill addition/removal cannot change carrier numeric range; hidden anchors never get series", () => {
  const output = plot(cross, [0.000001, 0.000002]),
    area = fill(output, [1e100, 1e100], output.values),
    f = fixture(graph([output]));
  f.render();
  const s = f.series()[0],
    range = structuredClone(s.range());
  f.render(graph([output], [area]));
  assert.equal(f.series()[0], s);
  assert.deepEqual(s.range(), range);
  assert.equal(f.series().length, 1);
  f.render(graph([output]));
  assert.deepEqual(s.range(), range);
  assert.equal(s.primitives.size, 1);
  f.adapter.dispose();
});
test("columns use shared immediate-previous palettes and opacity; explicit old default color stays solid", () => {
  const output = plot({ kind: "columns", base: 0 }, [0, 2, 2, null, -2, -1]);
  output.presentation = {
    ...output.presentation,
    color: { kind: "palette", id: "macd-sign-change-v1" }
  };
  output.style.opacity = 0.5;
  const f = fixture(graph([output]));
  f.render();
  const s = f.series()[0];
  assert.equal(s.kind, "Histogram");
  assert.deepEqual(
    s.data.map((row) => row.color),
    [
      "rgba(178,223,219,0.5)",
      "rgba(38,166,154,0.5)",
      "rgba(178,223,219,0.5)",
      undefined,
      "rgba(255,82,82,0.5)",
      "rgba(255,205,210,0.5)"
    ]
  );
  const solid = {
    ...output,
    presentation: { ...output.presentation, color: { kind: "solid", color: "#2962ff" } }
  };
  f.render(graph([solid]));
  assert.ok(
    s.data
      .filter((row) => row.value !== undefined)
      .every((row) => row.color === "rgba(41,98,255,0.5)")
  );
  assert.equal(s.primitives.size, 0);
  f.adapter.dispose();
});
test("hidden columns used by a fill keep coordinate data transparent and outside native range", () => {
  const output = plot({ kind: "columns", base: 0 }, [10, 11]);
  output.style.visible = false;
  const f = fixture(graph([output], [fill(output, [5, 6], output.values)]));
  f.render();
  const s = f.series()[0];
  assert.equal(s.options.visible, true);
  assert.equal(s.range(), null);
  assert.ok(s.data.every((row) => row.color === "transparent"));
  assert.equal(commands(f.paint(true), "fill").length, 1);
  f.adapter.dispose();
});
test("resource count is per plot/fill through repeated reconciliation, gaps, pane moves and geometry changes", () => {
  const output = plot(
      line,
      Array.from({ length: 1000 }, (_, i) => (i % 2 ? null : i))
    ),
    area = fill(output, output.values, output.values),
    f = fixture(graph([output], [area]));
  f.render();
  const first = f.series()[0];
  for (let i = 0; i < 20; i++) f.render();
  assert.equal(f.allSeries.length, 1);
  assert.equal(first.primitives.size, 2);
  const keys = [...first.primitives];
  f.render(graph([{ ...output, paneKey: "pane:lower" }], [{ ...area, paneKey: "pane:lower" }]));
  assert.equal(f.series()[0], first);
  assert.equal(first.getPane().paneIndex(), 1);
  assert.deepEqual([...first.primitives], keys);
  assert.ok(f.panes[0].series.includes(f.foreign));
  f.render(
    graph([{ ...output, presentation: { ...output.presentation, geometry: cross } }], [area])
  );
  assert.equal(f.allSeries.length, 1);
  f.render(graph([]));
  assert.equal(f.series().length, 0);
  assert.equal(first.primitives.size, 0);
  assert.equal(f.panes.length, 1);
  f.adapter.dispose();
});
test("dispose/detach and stale owner stop drawing, projection, updates and resource resurrection", () => {
  const output = plot(cross, [10, 11]),
    f = fixture(graph([output], [fill(output, [5, 6], output.values)]));
  f.render();
  const p = [...f.series()[0].primitives][0],
    renderer = p.paneViews()[0].renderer();
  f.dead();
  assert.deepEqual(f.paint(), []);
  const before = f.nativeCalls.length;
  f.adapter.dispose();
  const c = canvas();
  renderer.draw(c.target);
  p.updatePlot(output);
  renderer.draw(c.target);
  assert.deepEqual(c.commands, []);
  assert.equal(f.nativeCalls.length, before);
  f.adapter.update([], []);
  assert.equal(f.series().length, 0);
});
test("paint clips source traversal to visible indexed window and handles coordinate holes without bridges", () => {
  const output = plot(cross, Array(100000).fill(10)),
    f = fixture(graph([output]));
  f.render();
  f.visible({ from: 50000, to: 50003 });
  f.nativeCalls.length = 0;
  f.paint();
  assert.ok(f.nativeCalls.length <= 6);
  assert.ok(f.nativeCalls.length >= 4);
  f.adapter.dispose();
});
test("missing native coordinates break strokes and paired polygons without a connector", () => {
  const output = plot(line, [10, 11, 12, 13]),
    f = fixture(graph([output], [fill(output, [5, 6, 7, 8], output.values)]));
  f.render();
  f.hole(2);
  const strokes = f.paint(),
    area = f.paint(true);
  assert.deepEqual(commands(strokes, "lineTo"), [["lineTo", 40, 87]]);
  assert.equal(commands(area, "fill").length, 1);
  assert.ok(!commands(area, "lineTo").some((c) => c[1] === 20));
  f.adapter.dispose();
});
test("metadata removal restores genuine legacy native line options without stale carrier policy", () => {
  const output = plot(cross, [10, 11]),
    f = fixture(graph([output]));
  f.render();
  const old = f.series()[0],
    legacy = { ...output };
  delete legacy.presentation;
  f.render(graph([legacy]));
  const s = f.series()[0];
  assert.notEqual(s, old);
  assert.equal(s.options.lineVisible, undefined);
  assert.equal(s.options.autoscaleInfoProvider, undefined);
  assert.equal(s.primitives.size, 0);
  assert.deepEqual(s.data, [
    { time: 1, value: 10 },
    { time: 2, value: 11 }
  ]);
  f.adapter.dispose();
});

function method(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, signature);
  const brace = source.indexOf("{", start);
  let depth = 1,
    end = brace + 1;
  for (; depth; end++) {
    if (source[end] === "{") depth++;
    if (source[end] === "}") depth--;
  }
  return source.slice(brace + 1, end - 1);
}
test("installed SDK executes all normal backgrounds before every normal foreground, after grid paint", () => {
  const sdk = readFileSync(
      new URL(
        "../node_modules/lightweight-charts/dist/lightweight-charts.development.mjs",
        import.meta.url
      ),
      "utf8"
    ),
    body = method(sdk, "_private__drawSources(target, paneViewsGetter) {"),
    events = [];
  const draw = new Function(
    "ensureNotNull",
    "drawBackground",
    "drawForeground",
    `return function(target,paneViewsGetter){${body}}`
  )((x) => x, "background", "foreground");
  draw.call(
    {
      _private__state: {
        _internal_orderedSources: () => ["candles", "owner"],
        _internal_primitives: () => []
      },
      _private__drawSourceImpl(_target, _getter, layer, source) {
        events.push(`${layer}:${source}`);
      }
    },
    {},
    null
  );
  assert.deepEqual(events, [
    "background:candles",
    "background:owner",
    "foreground:candles",
    "foreground:owner"
  ]);
  assert.ok(
    sdk.includes(
      "this._private__drawGrid(target);\n                    this._private__drawSources(target, sourcePaneViews$1);"
    )
  );
});
test("installed SDK autoscale provider path suppresses hidden owner range and preserves visible raw range exactly", () => {
  const sdk = readFileSync(
      new URL(
        "../node_modules/lightweight-charts/dist/lightweight-charts.development.mjs",
        import.meta.url
      ),
      "utf8"
    ),
    signature = "_internal_autoscaleInfo(startTimePoint, endTimePoint) {",
    start = sdk.indexOf(
      signature,
      sdk.indexOf("this._private__options.autoscaleInfoProvider") - 100
    ),
    body = method(sdk.slice(start), signature);
  const native = new Function(
    "AutoscaleInfoImpl",
    `return function(startTimePoint,endTimePoint){${body}}`
  )({ _internal_fromRaw: (value) => value });
  const output = plot(line, [1.000001, 1.000002]),
    f = fixture(graph([output]));
  f.render();
  const s = f.series()[0],
    raw = {
      priceRange: { minValue: 1.000001, maxValue: 1.000002 },
      margins: { above: 0, below: 0 }
    },
    receiver = {
      _private__options: s.options,
      _private__autoscaleInfoImpl: () => ({ _internal_toRaw: () => raw })
    };
  assert.equal(native.call(receiver, 0, 2), raw);
  f.render(
    graph(
      [{ ...output, style: { ...output.style, visible: false } }],
      [fill(output, [1000, 1000], output.values)]
    )
  );
  assert.equal(native.call(receiver, 0, 2), null);
  f.adapter.dispose();
});
test("installed native range calculation remains equal with decorative fill, hidden/show and removal", () => {
  const sdk = readFileSync(
    new URL(
      "../node_modules/lightweight-charts/dist/lightweight-charts.development.mjs",
      import.meta.url
    ),
    "utf8"
  );
  const PriceRange = new Function(
    `return class PriceRangeImpl {${method(sdk, "class PriceRangeImpl {")}}`
  )();
  const Autoscale = new Function(
    "PriceRangeImpl",
    `return class AutoscaleInfoImpl {${method(sdk, "class AutoscaleInfoImpl {")}}`
  )(PriceRange);
  const impl = new Function(
    "isInteger",
    "PriceRangeImpl",
    "AutoscaleInfoImpl",
    `return function(startTimePoint,endTimePoint){${method(sdk, "_private__autoscaleInfoImpl(startTimePoint, endTimePoint) {")}}`
  )(Number.isInteger, PriceRange, Autoscale);
  const providerBody = method(
    sdk.slice(
      sdk.indexOf(
        "_internal_autoscaleInfo(startTimePoint, endTimePoint) {",
        sdk.indexOf("this._private__options.autoscaleInfoProvider") - 100
      )
    ),
    "_internal_autoscaleInfo(startTimePoint, endTimePoint) {"
  );
  const scale = new Function(
    "AutoscaleInfoImpl",
    `return function(startTimePoint,endTimePoint){${providerBody}}`
  )(Autoscale);
  for (const values of [
    [1.000001, 1.000002],
    [5, 5]
  ]) {
    const output = plot(line, values),
      area = fill(output, [1e100, 1e100], values),
      f = fixture(graph([output]));
    f.render();
    const s = f.series()[0];
    const receiver = {
      _private__options: s.options,
      _private__seriesType: "Line",
      _internal_seriesType: () => "Line",
      _private__data: {
        _internal_isEmpty: () => false,
        _internal_minMaxOnRangeCached: () => ({
          _internal_min: Math.min(...values),
          _internal_max: Math.max(...values)
        })
      },
      _private__primitives: [],
      _private__autoscaleInfoImpl(...args) {
        return impl.apply(this, args);
      }
    };
    const baseline = scale.call(receiver, 0, 1)._internal_toRaw();
    f.render(graph([output], [area]));
    receiver._private__primitives = [...s.primitives].map((p) => ({
      _internal_autoscaleInfo: () => p.autoscaleInfo()
    }));
    assert.deepEqual(scale.call(receiver, 0, 1)._internal_toRaw(), baseline);
    f.render(graph([{ ...output, style: { ...output.style, visible: false } }], [area]));
    assert.equal(scale.call(receiver, 0, 1), null);
    f.render(graph([output]));
    receiver._private__primitives = [...s.primitives].map((p) => ({
      _internal_autoscaleInfo: () => p.autoscaleInfo()
    }));
    assert.deepEqual(scale.call(receiver, 0, 1)._internal_toRaw(), baseline);
    f.adapter.dispose();
  }
});
test("installed priceToCoordinate returns null for absent firstValue and never substitutes a fake zero", () => {
  const sdk = readFileSync(
      new URL(
        "../node_modules/lightweight-charts/dist/lightweight-charts.development.mjs",
        import.meta.url
      ),
      "utf8"
    ),
    native = new Function(`return function(price){${method(sdk, "priceToCoordinate(price) {")}}`)();
  let first = null,
    calls = [];
  const receiver = {
    _internal__series: {
      _internal_firstValue: () => first,
      _internal_priceScale: () => ({
        _internal_priceToCoordinate: (price, base) => {
          calls.push([price, base]);
          return 100 - price;
        }
      })
    }
  };
  assert.equal(native.call(receiver, 20), null);
  assert.deepEqual(calls, []);
  first = { _internal_value: 12 };
  assert.equal(native.call(receiver, 20), 80);
  assert.deepEqual(calls, [[20, 12]]);
});
