import test from "node:test";
import assert from "node:assert/strict";
import { sourceModules } from "./helpers/watchlist-sections.mjs";

const candle = { timestamp: 1000, open: 100, high: 110, low: 90, close: 105.125, volume: 1 };
function canvas() {
  const rectangles = [], texts = [];
  return {
    rectangles, texts,
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    measureText: (text) => ({ width: text.length * 6 }),
    fillRect(x, y, width, height) { rectangles.push({ x, y, width, height, color: this.fillStyle }); },
    fillText(text, x, y) { texts.push({ text, x, y, color: this.fillStyle }); }
  };
}
const target = (context, width = 80, height = 500) => ({
  useMediaCoordinateSpace: (draw) => draw({ context, mediaSize: { width, height } })
});

test("composite price and countdown have one background with the price row at the exact anchor", () => {
  const { paintLastPriceLabel, matchingCountdown } = sourceModules()("charts/last-price-label.ts");
  const context = canvas();
  const label = { y: 100.5, width: 80, height: 500, price: "105.125", countdown: "01:23:45", fill: "#123456", text: "#fff", fontSize: 11 };
  paintLastPriceLabel(context, label);
  assert.equal(context.rectangles.length, 1);
  assert.deepEqual(context.rectangles[0], { x: 0, y: 92, width: 56, height: 34, color: "#123456" });
  assert.deepEqual(context.texts.map(({text, y}) => ({text, y})), [{text:"105.125", y:100.5},{text:"01:23:45", y:117.5}]);
  assert.equal(matchingCountdown({ timestamp: candle.timestamp, text: "00:30" }, candle), "00:30");
  assert.equal(matchingCountdown({ timestamp: candle.timestamp - 1, text: "00:30" }, candle), null);
  for (const y of [-1, 501, NaN]) paintLastPriceLabel(context, {...label, y});
  assert.equal(context.rectangles.length, 1, "offscreen labels cannot pin a stale price to the visible axis");
});

test("fractional native price coordinates remain exact while the shared background clips at the pane edge", () => {
  const { paintLastPriceLabel } = sourceModules()("charts/last-price-label.ts");
  for (const y of [100.2, 0.2]) {
    const context = canvas();
    paintLastPriceLabel(context, { y, width: 80, height: 500, price: "105.125", countdown: "00:30", fill: "#123456", text: "#fff", fontSize: 11 });
    assert.equal(context.texts[0].y, y);
    assert.equal(context.texts[1].y, y + 17);
    assert.equal(context.rectangles.length, 1);
    assert.equal(context.rectangles[0].y, Math.round(y - 8.5));
    if (y < 8.5) assert.ok(context.rectangles[0].y < 0, "the background is clipped instead of shifting the price anchor");
  }
  const outside = canvas();
  paintLastPriceLabel(outside, { y: -0.2, width: 80, height: 500, price: "105.125", countdown: "00:30", fill: "#123456", text: "#fff", fontSize: 11 });
  assert.equal(outside.rectangles.length, 0);
  assert.equal(outside.texts.length, 0);
});

test("Lightweight uses the current native transform without timer updates and restores native labels on rollover/off", () => {
  const { lightweightAxisLabels } = sourceModules()("charts/lightweight-axis-labels.ts");
  let bars = [candle], scale = 1, offset = 0, requests = 0;
  const lines = new Set();
  const series = {
    priceToCoordinate: (value) => value * scale + offset,
    createPriceLine(options) {
      const line = { options, applyOptions(patch) { Object.assign(this.options, patch); } };
      lines.add(line); return line;
    },
    removePriceLine: (line) => lines.delete(line)
  };
  const axes = lightweightAxisLabels(series, {theme:"dark"}, () => bars,
    () => ({precision:3,minMove:0.005}), (point) => ({x:100,y:series.priceToCoordinate(point.value)}),
    () => 100, () => ({width:800,height:500}));
  axes.primitive.attached({requestUpdate:()=>requests++});
  axes.refresh();
  const [line] = lines;
  assert.equal(line.options.axisLabelVisible,true);
  axes.setCountdown({timestamp:candle.timestamp,text:"00:30"});
  assert.equal(line.options.axisLabelVisible,false);
  assert.equal(line.options.price,candle.close);
  assert.equal(line.options.lineVisible,true);
  const draw = () => {
    const context=canvas();
    axes.primitive.priceAxisPaneViews()[0].renderer().draw(target(context));
    return context;
  };
  const first = draw();
  scale=1.5;offset=30;
  const second = draw();
  assert.equal(first.rectangles.length,1);
  assert.equal(second.rectangles.length,1);
  assert.ok(Math.abs(second.texts[0].y-series.priceToCoordinate(candle.close))<=0.5);
  assert.notEqual(first.texts[0].y,second.texts[0].y);
  assert.deepEqual(second.texts.map(x=>x.text),["105.125","00:30"]);
  const previousRequests=requests;
  axes.setCountdown({timestamp:candle.timestamp,text:"00:30"});
  assert.equal(requests,previousRequests,"native paint cannot trigger a timer invalidation loop");
  axes.setColors({fill:"#304050",text:"#ffdd00"});
  assert.equal(draw().rectangles[0].color,"#304050");
  assert.equal(draw().texts[0].color,"#ffdd00");
  bars=[{...candle,timestamp:candle.timestamp+60000,close:100}];
  axes.refresh();
  assert.equal(line.options.axisLabelVisible,true);
  assert.equal(draw().rectangles.length,0);
  axes.setCountdown({timestamp:bars[0].timestamp,text:"00:59"});
  assert.equal(line.options.axisLabelVisible,false);
  axes.setCountdown(null);
  assert.equal(line.options.axisLabelVisible,true);
  assert.equal(draw().rectangles.length,0);
  bars=[];axes.refresh();assert.equal(lines.size,0);
  axes.primitive.detached();
  axes.setCountdown({timestamp:1000,text:"00:10"});
  assert.equal(requests,previousRequests+2,"detached labels never schedule another native draw");
});

function klineHarness() {
  const templates = new Map(), figures = new Map(), overlays = new Map(), styles = [];
  let overrides=0;
  const load = sourceModules({ klinecharts: {
    LineType:{Dashed:"dashed"},
    registerOverlay:(template)=>templates.set(template.name,template),
    registerFigure:(figure)=>figures.set(figure.name,figure)
  }});
  const chart={
    setStyles:(patch)=>styles.push(patch),
    createOverlay(options) { const id=`overlay-${overlays.size+1}`;overlays.set(id,{...options,id});return id; },
    overrideOverlay(patch) { overrides++;Object.assign(overlays.get(patch.id),patch); },
    removeOverlay:(id)=>overlays.delete(id)
  };
  return {load,chart,templates,figures,overlays,styles,overrides:()=>overrides};
}

test("KLine draws both price rows and line at the same native coordinate; timer ticks update only overlays", () => {
  const f=klineHarness();
  const {klineLastPrice}=f.load("charts/kline-last-price.ts");
  const {klineAxisLabels}=f.load("charts/kline-axis-labels.ts");
  let bars=[candle],digits=3;
  const native=klineLastPrice({theme:"dark"});
  const axes=klineAxisLabels(f.chart,native,{theme:"dark"},()=>bars,()=>({precision:digits,minMove:.005}),
    (point)=>({x:100,y:point.value}),()=>100,()=>({width:800,height:500}),()=>{});
  axes.refresh();
  axes.setCountdown({timestamp:candle.timestamp,text:"00:30"});
  assert.equal(f.styles.at(-1).candle.priceMark.last.text.show,false);
  assert.equal(f.styles.at(-1).candle.priceMark.last.line.show,false);
  const [overlay]=f.overlays.values();
  const template=f.templates.get(overlay.name);
  for (const y of [100.5,211.5,40.5]) {
    const params={overlay,coordinates:[{x:100,y}],bounding:{width:80,height:500}};
    const [line]=template.createPointFigures(params);
    const [label]=template.createYAxisFigures(params);
    const context=canvas();
    f.figures.get(label.type).draw(context,label.attrs);
    assert.equal(context.rectangles.length,1);
    assert.equal(context.texts[0].y,y);
    assert.equal(context.texts[1].y,y+17);
    assert.equal(line.attrs.coordinates[0].y,y);
    assert.equal(line.attrs.coordinates[1].y,y);
  }
  const writes=f.styles.length, updates=f.overrides();
  axes.setCountdown({timestamp:candle.timestamp,text:"00:30"});
  assert.equal(f.overrides(),updates);
  axes.setCountdown({timestamp:candle.timestamp,text:"00:29"});
  assert.equal(f.styles.length,writes,"a second tick does not redraw the base candle/MTP canvas through setStyles");
  assert.equal(f.overrides(),updates+1);
  axes.setColors({fill:"#331122",text:"#ffff00"});
  assert.equal(overlay.extendData.fill,"#331122");
  assert.equal(overlay.extendData.text,"#ffff00");
  digits=5;axes.refresh();assert.equal(overlay.extendData.price,"105.12500");
  bars=[{...candle,timestamp:2000}];axes.refresh();
  assert.equal(f.overlays.size,0);
  assert.equal(f.styles.at(-1).candle.priceMark.last.text.show,true);
  axes.setCountdown({timestamp:2000,text:"00:59"});assert.equal(f.overlays.size,1);
  axes.setCountdown(null);assert.equal(f.overlays.size,0);
  axes.dispose();
});

test("drawing price and date labels use current native geometry, preserve collision rules and custom colors", () => {
  const load=sourceModules();
  const {lightweightLastPriceLabel}=load("charts/lightweight-last-price-label.ts");
  const {drawingPriceLabels}=load("charts/drawing-axis-labels.ts");
  let y=100,x=200;
  const price={point:{timestamp:1000,value:10},anchor:"always",text:"10.00",color:"#ffee00",fill:"#aabb00",textColor:"#001100"};
  const frame=()=>({labels:{prices:[price,{...price,anchor:"visible",text:"hidden",point:{timestamp:-1,value:10}}],times:[{timestamp:1000,text:"01 Jan"}],timeStyle:{fill:"#2962ff",textColor:"#fff"}},
    project:(point)=>({x:point.timestamp===-1?-10:x,y}),projectTime:()=>x,plotWidth:800,plotHeight:500,occupied:[100],fontSize:11});
  const axes=lightweightLastPriceLabel(()=>null,frame);
  assert.equal(drawingPriceLabels(frame()).length,1);
  assert.equal(drawingPriceLabels(frame())[0].y,84,"price labels avoid the current last-price row");
  const draw=()=>{
    const prices=canvas(),times=canvas(),ticks=canvas();
    axes.primitive.priceAxisPaneViews()[0].renderer().draw(target(prices));
    axes.primitive.timeAxisPaneViews()[0].renderer().draw(target(times,800,26));
    axes.primitive.paneViews()[0].renderer().draw(target(ticks,800,500));
    return {prices,times,ticks};
  };
  let result=draw();
  assert.equal(result.prices.rectangles[0].color,"#aabb00");
  assert.equal(result.prices.texts[0].color,"#001100");
  assert.equal(result.ticks.rectangles[0].y,100);
  y=180;x=350;result=draw();
  assert.equal(result.prices.texts[0].y,180);
  assert.equal(result.ticks.rectangles[0].y,180);
  assert.equal(result.times.texts[0].x,350);
  y=800;assert.equal(draw().prices.rectangles.length,0);
});

test("KLine drawing overlay resolves the latest frame at draw time with unchanged logical inputs", () => {
  const f=klineHarness();
  const {klineDrawingAxisLabels}=f.load("charts/kline-drawing-axis-labels.ts");
  let y=100;
  const labels={prices:[{point:{timestamp:1000,value:10},anchor:"always",text:"10.00",color:"yellow",fill:"#223300",textColor:"#fff"}],times:[],timeStyle:{fill:"blue",textColor:"white"}};
  const frame=()=>({labels,project:()=>({x:100,y}),projectTime:()=>100,plotWidth:800,plotHeight:500,occupied:[],fontSize:11});
  const axis=klineDrawingAxisLabels(f.chart,frame);
  axis.update();
  const [overlay]=f.overlays.values();
  const draw=()=>{
    const [figure]=f.templates.get(overlay.name).createYAxisFigures({overlay,bounding:{width:80,height:500}});
    const context=canvas();f.figures.get(figure.type).draw(context,figure.attrs);return context;
  };
  assert.equal(draw().texts[0].y,100);
  y=220;assert.equal(draw().texts[0].y,220);
  axis.dispose();assert.equal(f.overlays.size,0);
});
