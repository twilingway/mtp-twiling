import test from "node:test";
import assert from "node:assert/strict";
import { sourceModules } from "./helpers/watchlist-sections.mjs";

function harness() {
  let template;
  const registrations = [], created = [], removed = [];
  const load = sourceModules({ klinecharts: {
    IndicatorSeries: { Price: "price" },
    registerIndicator(value) { template = value; registrations.push(value); }
  }});
  const { attachKlineFrontProjection } = load("charts/kline-front-projection.ts");
  const chart = {
    createIndicator(value, stack, pane) { created.push({ value, stack, pane }); return pane.id; },
    removeIndicator(pane, name) { removed.push({pane, name}); }
  };
  const draw = (index = 0) => template.draw({ indicator: created[index].value });
  return { attachKlineFrontProjection, chart, created, removed, registrations, draw,
    template: () => template };
}

test("held Y-axis native draw immediately projects the front layer without zoom, scroll, timers or another frame", () => {
  const f = harness();
  let scale = 1, offset = 0;
  const front = [];
  const dispose = f.attachKlineFrontProjection(f.chart, () => {
    front.push({top:67387.615*scale+offset, bottom:59350.56*scale+offset});
  }, () => true);
  assert.equal(front.length,0,"installing the sentinel does not independently paint or schedule a loop");
  f.draw();
  scale=0.85;offset=12.5;
  const axisY=67387.615*scale+offset;
  f.draw();
  assert.equal(front.length,2);
  assert.equal(front.at(-1).top,axisY,"the rectangle and native labels consume the same held-drag transform");
  assert.notEqual(front[0].top,front[1].top);
  assert.equal(f.created[0].value.name,"FRONT_PROJECTION_PERSONAL");
  assert.equal(f.created[0].stack,true);
  assert.deepEqual(f.created[0].pane,{id:"candle_pane"});
  assert.equal(f.template().shortName,"");
  assert.deepEqual(f.template().figures,[]);
  assert.deepEqual(f.template().calc(),[],"the callback contributes no values to autoscale or TA math");
  dispose();f.draw();assert.equal(front.length,2);
  dispose();assert.deepEqual(f.removed,[{pane:"candle_pane",name:"FRONT_PROJECTION_PERSONAL"}]);
});

test("native front projection is reentrancy safe, isolated per chart and stops on retirement", () => {
  const f=harness();
  let active=true,calls=0,otherCalls=0;
  const dispose=f.attachKlineFrontProjection(f.chart,()=>{
    calls++;
    f.draw();
  },()=>active);
  const otherDispose=f.attachKlineFrontProjection(f.chart,()=>otherCalls++,()=>true);
  assert.equal(f.registrations.length,1);
  f.draw();assert.equal(calls,1,"a synchronous projection event cannot recurse into another paint");
  f.draw(1);assert.equal(otherCalls,1);
  active=false;f.draw();assert.equal(calls,1);
  dispose();f.draw();assert.equal(calls,1);
  f.draw(1);assert.equal(otherCalls,2);
  otherDispose();f.draw(1);assert.equal(otherCalls,2);
});

test("a failed front paint clears its reentrancy guard for the next native frame", () => {
  const f=harness();
  let attempts=0;
  f.attachKlineFrontProjection(f.chart,()=>{
    if (++attempts===1) throw new Error("paint failed");
  },()=>true);
  assert.throws(()=>f.draw(),/paint failed/);
  f.draw();assert.equal(attempts,2);
});
