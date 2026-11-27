import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("../src/", import.meta.url));
function modules(overrides = {}, globals = {}) {
  const cache = new Map();
  const context = vm.createContext({ console, Math, Number, Object, ...globals });
  function load(name) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    const candidate = path.resolve(root, name).replace(/\.js$/, ".ts"),
      file = existsSync(candidate) ? candidate : candidate + "x";
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const output = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX }
    }).outputText;
    new vm.Script(`(function(require,module,exports){${output}\n})`).runInContext(context)(
      (specifier) => Object.hasOwn(overrides, specifier) ? overrides[specifier] :
        load(path.relative(root, path.resolve(path.dirname(file), specifier))),
      module, module.exports
    );
    return module.exports;
  }
  return load;
}

const { lightweightNavigation } = modules()("charts/lightweight-navigation.js");
function lightweight({ length = 1000, space = 8, width = 800, ready = true } = {}) {
  // The public LW coordinate equation, also used by the camera restoration code.
  let offset = 8, autoScale = true;
  const candles = Object.freeze(Array.from({ length }, (_, timestamp) =>
    Object.freeze({ timestamp, close: timestamp + 10 })));
  const writes = [], priceWrites = [], range = { from: 10, to: 200 };
  const scale = {
    width: () => width,
    options: () => ({ barSpacing: space, minBarSpacing: 0.5, maxBarSpacing: 0 }),
    logicalToCoordinate: (index) => width - 1 - (length - 1 + offset - index + 0.5) * space,
    coordinateToLogical: (x) => length - 1 + offset + 0.5 - (width - x - 1) / space,
    applyOptions(value) { writes.push(value); space = value.barSpacing; offset = value.rightOffset; },
    scrollPosition: () => offset,
    scrollToPosition(value, animate) { assert.equal(animate, false); offset = value; },
    resetTimeScale() { writes.push("reset"); space = 6; offset = 8; },
    scrollToRealTime() { writes.push("realtime"); offset = 8; }
  };
  const price = {
    getVisibleRange: () => range,
    applyOptions(value) { autoScale = value.autoScale; priceWrites.push(value); },
    setVisibleRange(value) { assert.equal(value, range); }
  };
  return {
    api: lightweightNavigation({ timeScale: () => scale }, { priceScale: () => price },
      () => candles.length, () => ready),
    scale, candles, writes, priceWrites, spacing: () => space, autoScale: () => autoScale
  };
}

test("LW zoom keeps the center candle fixed and pan reveals older/newer by a quarter viewport", () => {
  const chart = lightweight(), anchor = chart.scale.coordinateToLogical(400),
    candlesBefore = JSON.stringify(chart.candles);
  chart.api.zoom(1);
  assert.equal(chart.spacing(), 10);
  assert.ok(Math.abs(chart.scale.logicalToCoordinate(anchor) - 400) < 1e-9);
  assert.equal(chart.autoScale(), true);
  const beforePan = chart.scale.logicalToCoordinate(950);
  chart.api.scroll(-1);
  assert.equal(chart.spacing(), 10);
  assert.equal(chart.scale.logicalToCoordinate(950), beforePan + 200);
  assert.equal(chart.autoScale(), false);
  chart.api.scroll(1);
  assert.equal(chart.scale.logicalToCoordinate(950), beforePan);
  assert.equal(JSON.stringify(chart.candles), candlesBefore);
});

test("LW zoom clamps native bounds, sparse data anchors a real candle, repeated pan retains data", () => {
  const chart = lightweight({ length: 3 });
  const firstX = chart.scale.logicalToCoordinate(0);
  chart.api.zoom(1);
  assert.ok(Math.abs(chart.scale.logicalToCoordinate(0) - firstX) < 1e-9);
  for (let i = 0; i < 100; i++) chart.api.zoom(1);
  assert.equal(chart.spacing(), 400);
  for (let i = 0; i < 100; i++) chart.api.zoom(-1);
  assert.equal(chart.spacing(), 0.5);
  for (let i = 0; i < 100; i++) chart.api.scroll(1);
  assert.ok(chart.scale.logicalToCoordinate(2) >= 1 - 1e-9);
  for (let i = 0; i < 100; i++) chart.api.scroll(-1);
  assert.ok(chart.scale.logicalToCoordinate(0) <= 799 + 1e-9);
  assert.ok(chart.writes.filter((value) => typeof value === "object").every((value) =>
    Number.isFinite(value.barSpacing) && Number.isFinite(value.rightOffset)));
});

test("LW repeat uses fractional nonanimated scroll and never re-freezes the manual price range",()=>{
  const chart=lightweight();chart.api.scroll(-1);const before=chart.scale.scrollPosition();
  for(let step=0;step<10;step++)chart.api.scroll(-1,.0123);
  assert.ok(Math.abs(chart.scale.scrollPosition()-(before-10*200*.0123/8))<1e-9);
  assert.equal(chart.priceWrites.length,1);assert.equal(chart.autoScale(),false);
  const stable=chart.scale.scrollPosition();chart.api.scroll(-1,NaN);chart.api.scroll(-1,0);
  assert.equal(chart.scale.scrollPosition(),stable);
});

test("LW reset enables price autoscale and returns the time scale to realtime; pending and empty charts do nothing", () => {
  const chart = lightweight();
  chart.api.scroll(-1);
  chart.api.zoom(1);
  chart.api.resetView();
  assert.equal(chart.autoScale(), true);
  assert.equal(chart.spacing(), 6);
  assert.deepEqual(JSON.parse(JSON.stringify(chart.writes.at(-1))), { barSpacing: 6, rightOffset: 8 });
  assert.equal(chart.scale.scrollPosition(), 8);
  for (const dormant of [lightweight({ ready: false }), lightweight({ length: 0 })]) {
    dormant.api.zoom(1); dormant.api.scroll(-1); dormant.api.resetView();
    assert.deepEqual(dormant.writes, []);
    assert.equal(dormant.autoScale(), true);
  }
});

const lwSource = readFileSync(new URL("../node_modules/lightweight-charts/dist/lightweight-charts.development.mjs",import.meta.url),"utf8");
function nativeBlock(className, method) {
  const classStart=lwSource.indexOf(`class ${className} {`);
  assert.ok(classStart>=0,`installed native class ${className}`);
  const start=method?lwSource.indexOf(`\n    ${method}(`,classStart)+5:classStart;
  assert.ok(start>=classStart);
  const open=lwSource.indexOf("{",start);let depth=1,end=open+1;
  for(;depth&&end<lwSource.length;end++){
    if(lwSource[end]==="{")depth++;else if(lwSource[end]==="}")depth--;
  }
  assert.equal(depth,0);
  return lwSource.slice(start,end);
}
function nativeLightweight({missingGeometry=false}={}) {
  let clock=0,autoScale=false,animation=null;
  const globals={Number,Math,isFinite,RangeError,performance:{now:()=>clock},
    merge:Object.assign,clone:structuredClone};
  const method=(className,name)=>vm.runInNewContext(`({${nativeBlock(className,name)}})[${JSON.stringify(name)}]`,globals);
  const Mask=vm.runInNewContext(`(${nativeBlock("InvalidateMask")})`,globals);
  globals.InvalidateMask=Mask;
  let pending=Mask._internal_light();
  const native={_private__options:{barSpacing:6,rightOffset:8,minBarSpacing:.5,maxBarSpacing:0},
    _private__barSpacing:6,_private__rightOffset:8,
    _private__checkRightOffsetPixels(){},_private__invalidateTickMarks(){},_private__updateDateTimeFormatter(){},
    _private__optionsApplied:{_internal_fire(){}},
    _internal_setBarSpacing(value){this._private__barSpacing=value;},
    _internal_setRightOffset(value){this._private__rightOffset=value;}}
  const model={_private__invalidate(mask){pending._internal_merge(mask);}};
  for(const name of ["_internal_setBarSpacing","_internal_setRightOffset","_internal_resetTimeScale","_internal_setTimeScaleAnimation"])
    model[name]=method("ChartModel",name);
  native._private__model=model;
  for(const name of ["_internal_options","_internal_applyOptions","_internal_restoreDefault","_internal_scrollToRealTime","_internal_scrollToOffsetAnimated","_internal_barSpacing","_internal_rightOffset"])
    native[name]=method("TimeScale",name);
  const scale={_private__timeScale:native,_private__model:model,width:()=>800,
    logicalToCoordinate:index=>missingGeometry?null:799-(999+native._private__rightOffset-index+.5)*native._private__barSpacing,
    coordinateToLogical:x=>999+native._private__rightOffset+.5-(799-x)/native._private__barSpacing};
  for(const name of ["options","applyOptions","scrollPosition","scrollToPosition","resetTimeScale","scrollToRealTime"])
    scale[name]=method("TimeScaleApi",name);
  const api=lightweightNavigation({timeScale:()=>scale},{priceScale:()=>({
    applyOptions:value=>{autoScale=value.autoScale;},getVisibleRange:()=>({from:1,to:10}),setVisibleRange(){}
  })},()=>1000,()=>true);
  const camera=()=>({spacing:native._private__barSpacing,offset:native._private__rightOffset});
  return {api,scale,camera,autoScale:()=>autoScale,frame(time){
    clock=time;const commands=pending._internal_timeScaleInvalidations();pending=Mask._internal_light();
    for(const command of commands){
      switch(command._internal_type){
        case 2:native._internal_setBarSpacing(command._internal_value);break;
        case 3:native._internal_setRightOffset(command._internal_value);break;
        case 4:native._internal_restoreDefault();break;
        case 5:animation=command._internal_value;break;
        case 6:animation=null;break;
        default:assert.fail("reset must not fit the data range");
      }
    }
    if(animation){native._internal_setRightOffset(animation._internal_getPosition(time));
      if(animation._internal_finished(time))animation=null;}
  }};
}

test("installed LW 5.0.9 restoreDefault restores changed options, proving resetTimeScale is not an initial-camera reset",()=>{
  const chart=nativeLightweight();
  chart.scale.applyOptions({barSpacing:17,rightOffset:-240});chart.frame(0);
  chart.scale.resetTimeScale();chart.scale.scrollToRealTime();chart.frame(16);chart.frame(600);
  assert.deepEqual(chart.camera(),{spacing:17,offset:-240});
});

test("LW public reset overrides saved/zoomed mutable options and stops native animation without outgoing drift",()=>{
  const chart=nativeLightweight();
  chart.scale.applyOptions({barSpacing:13,rightOffset:-240});chart.frame(0);
  chart.api.zoom(1);chart.frame(16);chart.api.scroll(-1);chart.frame(32);
  assert.equal(chart.autoScale(),false);
  // Queue old native animated scrolling, then reset before its next frame.
  chart.scale.scrollToPosition(-400,true);chart.api.resetView();
  assert.equal(chart.autoScale(),true);
  for(const time of [48,64,80,600,1600]){
    chart.frame(time);assert.deepEqual(chart.camera(),{spacing:6,offset:8});
  }
  chart.api.zoom(-1);chart.frame(1700);assert.notEqual(chart.camera().spacing,6);
  chart.api.resetView();chart.frame(1716);assert.deepEqual(chart.camera(),{spacing:6,offset:8});
});

test("LW ready nonempty reset works with null/offscreen geometry while zoom and pan keep their geometry guard",()=>{
  const chart=nativeLightweight({missingGeometry:true});
  chart.scale.applyOptions({barSpacing:20,rightOffset:-900});chart.frame(0);
  chart.api.zoom(1);chart.api.scroll(-1);chart.frame(16);
  assert.deepEqual(chart.camera(),{spacing:20,offset:-900});
  chart.api.resetView();chart.frame(32);assert.deepEqual(chart.camera(),{spacing:6,offset:8});
  assert.equal(chart.autoScale(),true);
});

test("KLine navigation uses multiplier, explicit plot center, native bounds and signed pixel pan without changing data", () => {
  const calls = [], candles = Object.freeze(Array.from({ length: 1000 }, (_, timestamp) =>
    Object.freeze({ timestamp, close: timestamp + 10 })));
  let space = 8, ready = true;
  const load = modules({
    klinecharts: { DomPosition: { Main: "main" } },
    "./kline-price-scale.js": {
      freezeKlinePriceScale: () => calls.push("freeze"),
      resetKlinePriceScale: () => calls.push("reset-price")
    }
  });
  const chart = {
    getSize: () => ({ width: 800, height: 400 }),
    convertToPixel: () => [{ x: -7000 }, { x: 750 }],
    getBarSpace: () => space,
    zoomAtCoordinate(multiplier, point, duration) {
      calls.push(["zoom", multiplier, point.x, point.y, duration]); space *= multiplier;
    },
    scrollByDistance: (pixels, duration) => calls.push(["pan", pixels, duration]),
    setBarSpace(value) { calls.push(["spacing", value]); space = value; },
    scrollToRealTime: (duration) => calls.push(["realtime", duration])
  };
  const api = load("charts/kline-navigation.js").klineNavigation(chart, () => candles.length, () => ready);
  const before = JSON.stringify(candles);
  api.zoom(1);
  assert.deepEqual(calls.shift(), ["zoom", 1.25, 400, 200, 0]);
  api.scroll(-1); api.scroll(1);
  assert.deepEqual(calls.splice(0), ["freeze", ["pan", 200, 0], "freeze", ["pan", -200, 0]]);
  api.scroll(-1,.0123);api.scroll(1,.0123);
  assert.deepEqual(calls.splice(0),[["pan",2.46,0],["pan",-2.46,0]]);
  space = 49; api.zoom(1); assert.equal(space, 50);
  space = 1.1; api.zoom(-1); assert.equal(space, 1);
  calls.length = 0;
  api.resetView();
  assert.deepEqual(calls.splice(0), ["reset-price", ["spacing", 6], ["realtime", 0]]);
  assert.equal(JSON.stringify(candles), before);
  ready = false;
  api.zoom(1); api.scroll(-1); api.resetView();
  assert.deepEqual(calls, []);
});

test("UI readiness rejects loading, import, pending camera, retired instance and mismatched owner/UID/view", () => {
  const load = modules({
    "./controller-bridge.js": { viewKey: (p) => `${p.symbol}:${p.timeframe}:${p.engine}:${p.rangeDays}` },
    "../../model/selected-instrument.js": { selectedMarketRow: (rows) => rows[0] }
  }), { chartNavigationReady } = load("screens/terminal/chart-navigation-state.js");
  const state = {
    authenticated: true, candles: [{ timestamp: 1 }], owner: "owner", rows: [{ uid: "uid" }],
    preferences: { symbol: "TEST", timeframe: "1d", engine: "kline", rangeDays: 30 }
  };
  const chart = {
    source: { owner: "owner", uid: "uid", viewKey: "TEST:1d:kline:30" }, getView: () => ({})
  };
  assert.equal(chartNavigationReady(state, chart), true);
  for (const change of [{ loading: true }, { importingBackup: true }, { importRecoveryRequired: true },
    { historyViewReady: false }, { authenticated: false }, { candles: [] }, { owner: "other" },
    { rows: [{ uid: "another" }] }, { preferences: { ...state.preferences, timeframe: "1h" } }])
    assert.equal(chartNavigationReady({ ...state, ...change }, chart), false);
  for (const change of [{ retired: true }, { persistView: false }, { getView: () => null },
    { source: undefined }])
    assert.equal(chartNavigationReady(state, { ...chart, ...change }), false);
  assert.equal(chartNavigationReady(state, null), false);
});

test("five localized buttons expose names, isolate events and revalidate loading/import before every action", () => {
  const calls = [], state = {
    authenticated: true, candles: [{ timestamp: 1 }], owner: "owner", rows: [{ uid: "uid" }],
    preferences: { symbol: "TEST", timeframe: "1d", engine: "kline", rangeDays: 30, locale: "en" }
  };
  const chart = {
    source: { owner: "owner", uid: "uid", viewKey: "TEST:1d:kline:30" }, getView: () => ({}),
    zoom: (direction) => calls.push(["zoom", direction]),
    scroll: (direction) => calls.push(["scroll", direction]),
    resetView: () => calls.push(["reset"])
  };
  const controller = { chart, getSnapshot: () => state }, load = modules({
    react: { useRef: () => ({ current: null }), useEffect() {}, useMemo: (factory) => factory(), useSyncExternalStore: () => false,
      useState: () => [{ chart, left: 400, top: 500 }, () => {}] },
    "react/jsx-runtime": jsxRuntime,
    "./context.js": { useTerminal: () => ({ state, controller }) },
    "./controller-bridge.js": { viewKey: (p) => `${p.symbol}:${p.timeframe}:${p.engine}:${p.rangeDays}` },
    "../../model/selected-instrument.js": { selectedMarketRow: (rows) => rows[0] }
  });
  const { ChartNavigation } = load("screens/terminal/ChartNavigation.js"), panel = ChartNavigation(),
    buttons = panel.props.children;
  assert.equal(panel.props.role, "group");
  assert.equal(panel.props["aria-label"], "Chart navigation");
  assert.equal(buttons.length, 5);
  assert.deepEqual(Array.from(buttons, (button) => button.props["aria-label"]), ["Zoom out", "Zoom in",
    "Scroll to older candles", "Scroll to newer candles", "Reset chart view"]);
  assert.ok(buttons.every((button) => button.props.type === "button" && !button.props.disabled));
  for (const button of buttons) button.props.onClick();
  assert.deepEqual(calls, [["zoom", -1], ["zoom", 1], ["scroll", -1], ["scroll", 1], ["reset"]]);
  let stopped = 0;
  for (const name of ["onPointerDown", "onPointerUp", "onPointerMove", "onClick", "onDoubleClick", "onWheel"])
    panel.props[name]({ stopPropagation() { stopped++; } });
  assert.equal(stopped, 6);
  calls.length = 0;
  state.importingBackup = true;
  for (const button of buttons) button.props.onClick();
  assert.deepEqual(calls, []);
  assert.equal(ChartNavigation().props.children.every((button) => button.props.disabled), true);
  delete state.importingBackup;
  state.loading = true;
  for (const button of buttons) button.props.onClick();
  assert.deepEqual(calls, []);
  state.preferences.locale = "ru";
  const html = renderToStaticMarkup(ChartNavigation());
  assert.match(html, /Навигация графика/);
  assert.match(html, /Увеличить масштаб/);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 5);
});

test("compact charts do not render the four-arrow navigation pad", () => {
  const chart = { resetView() {}, scroll() {}, zoom() {} };
  const state = { preferences: { locale: "ru" } };
  const load = modules({
    react: {
      useSyncExternalStore: () => true,
      useRef: () => ({ current: null }),
      useMemo: (factory) => factory(),
      useEffect() {},
      useState: () => [{ chart, left: 140, top: 200 }, () => {}]
    },
    "react/jsx-runtime": jsxRuntime,
    "./context.js": {
      useTerminal: () => ({ state, controller: { chart, getSnapshot: () => state } })
    },
    "./chart-navigation-state.js": { chartNavigationReady: () => true }
  });
  const { ChartNavigation } = load("screens/terminal/ChartNavigation.js");
  assert.equal(ChartNavigation(), null);
});
