import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
function sources(overrides = {}) {
  const modules = new Map();
  function load(relative) {
    const filename = path.resolve(sourceRoot, relative).replace(/\.js$/, ".ts");
    const key = path.relative(sourceRoot, filename).replaceAll(path.sep, "/");
    if (key === "services/storage-v2.ts" && Object.hasOwn(overrides, "services/storage.ts")) return overrides["services/storage.ts"];
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const output = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    vm.runInThisContext(`(function(require,module,exports){${output}\n})`, { filename })(
      (specifier) => load(path.relative(sourceRoot, path.resolve(path.dirname(filename), specifier))),
      module,
      module.exports
    );
    return module.exports;
  }
  return { load };
}
const { priorDayBase, quoteDay } = sources().load("services/quote-day-base.ts");
const q = (number) => {
  const units = Math.trunc(number);
  return { units: String(units), nano: Math.round((number - units) * 1e9) };
};
const now = Date.parse("2026-11-25T22:00:00Z");
const tick = "2026-11-25T17:06:31Z";
const close = {
  price: q(57.3),
  time: "2026-11-25T15:59:31Z",
  eveningSessionPrice: q(55),
  eveningSessionPriceTime: "2026-11-24T20:49:55Z"
};
const bar = (day, price, extra = {}) => ({
  time: `2026-11-${day}T00:00:00Z`,
  close: q(price),
  isComplete: true,
  candleSource: "CANDLE_SOURCE_EXCHANGE",
  ...extra
});
const row = (symbol = "VTBR") => ({
  symbol,
  ticker: symbol,
  uid: symbol,
  name: symbol,
  figi: null,
  currency: "rub",
  color: "#000000",
  mark: symbol[0],
  step: .005,
  price: 57.085,
  time: tick,
  previousClose: null,
  availability: "available"
});
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("VTBR day change uses 55 before and after today's main session close", () => {
  for (const time of ["2026-11-25T07:00:00Z", tick]) {
    const base = priorDayBase(time, close, [], now);
    assert.equal(base.price, 55);
    assert.equal(base.source, "evening");
    assert.equal(base.day, "2026-11-25");
    assert.ok(Math.abs(57.085 - base.price - 2.085) < 1e-9);
    assert.equal(((57.085 / base.price - 1) * 100).toFixed(2), "3.79");
  }
});

test("after evening close, today's evening and today's complete DAY cannot replace yesterday", () => {
  const updated = { ...close, eveningSessionPrice: q(57.3), eveningSessionPriceTime: "2026-11-25T20:49:55Z" };
  assert.equal(priorDayBase("2026-11-25T20:49:59Z", updated, [bar(24,55),bar(25,57.3)], now).price,55);
  assert.equal(priorDayBase(tick, { price:q(57.3),time:close.time }, [bar(24,55)],now).price,55);
});

test("stale last quote uses its own day, not current now or cached close day", () => {
  const stale="2026-11-24T17:00:00Z";
  const result=priorDayBase(stale,close,[bar(23,56.5),bar(24,55)],now);
  assert.equal(result.price,56.5);
  assert.equal(result.day,"2026-11-24");
});

test("weekends do not assume Friday: history chooses the latest actual exchange day", () => {
  const monday="2026-11-30T07:00:00Z";
  const older={eveningSessionPrice:q(55),eveningSessionPriceTime:"2026-11-27T20:49:55Z"};
  assert.equal(priorDayBase(monday,older,[],Date.parse(monday)),null);
  const result=priorDayBase(monday,older,[bar(27,55),bar(28,56),bar(29,99,{candleSource:"CANDLE_SOURCE_DEALER_WEEKEND"})],Date.parse(monday));
  assert.equal(result.price,56);
});

test("invalid/future timestamps, zero/nonfinite bases and incomplete/current DAY stay unknown", () => {
  assert.equal(quoteDay("2026-02-30T10:00:00Z",now),null);
  assert.equal(priorDayBase("2026-11-26T00:00:00Z",close,[bar(24,55)],now),null);
  for(const value of [0,-5,NaN,Infinity])
    assert.equal(priorDayBase(tick,{...close,eveningSessionPrice:q(value)},[],now),null);
  assert.equal(priorDayBase(tick,{...close,eveningSessionPriceTime:"invalid"},[bar(24,55,{isComplete:false}),bar(25,57),bar(26,100)],now),null);
  assert.equal(priorDayBase(undefined,close,[bar(24,55)],now),null);
});

test("NG keeps proved bank UTC-calendar close and does not substitute TV settlement", () => {
  const result=priorDayBase("2026-11-25T10:55:03Z",undefined,[bar(23,3.185),bar(24,3.322),bar(25,3.322)],now);
  assert.equal(result.price,3.322);
  const stale=priorDayBase("2026-11-24T10:55:03Z",undefined,[bar(23,3.185),bar(24,3.322)],now);
  assert.equal(stale.price,3.185);
});

test("UTC DAY boundary is independent of Moscow midnight and client date", () => {
  assert.equal(quoteDay("2026-11-25T22:30:00Z",Date.parse("2026-11-26T10:00:00Z")),"2026-11-25");
  assert.equal(priorDayBase("2026-11-25T22:30:00Z",undefined,[bar(24,55),bar(25,57)],Date.parse("2026-11-26T10:00:00Z")).price,55);
});

test("stream ticks coalesce history and day rollover drops old base without applying a late response", async () => {
  const {QuoteDayBases}=sources().load("services/quote-day-bases.ts");
  const first=deferred(),second=deferred();
  const calls=[];let clock=now;
  const bases=new QuoteDayBases({request:async(_service,_method,body)=>{calls.push(body);return calls.length===1?first.promise:second.promise;}},()=>clock,()=>true,()=>{},()=>{});
  const current=row();
  for(let i=0;i<20;i++)bases.update(current);
  assert.equal(calls.length,1);
  assert.equal(calls[0].interval,"CANDLE_INTERVAL_DAY");
  assert.equal(calls[0].candleSourceType,"CANDLE_SOURCE_EXCHANGE");
  assert.equal(calls[0].to,"2026-11-25T00:00:00.000Z");
  clock=Date.parse("2026-11-26T08:00:00Z");current.time="2026-11-26T07:00:00Z";
  for(let i=0;i<20;i++)bases.update(current);
  assert.equal(calls.length,2);
  first.resolve({candles:[bar(24,55)]});
  await Promise.resolve();await Promise.resolve();
  assert.equal(current.previousClose,null);
  second.resolve({candles:[bar(25,57.3)]});
  await bases.settled();
  assert.equal(current.previousClose,57.3);
  assert.equal(current.previousCloseDay,"2026-11-26");
  bases.update(current);assert.equal(calls.length,2);
});

test("missing history is cached, not zero, and emits one notice per snapshot day", async () => {
  const {QuoteDayBases}=sources().load("services/quote-day-bases.ts");
  let calls=0,notices=0;
  const bases=new QuoteDayBases({request:async()=>{calls++;throw new Error("offline");}},()=>now,()=>true,()=>{},()=>notices++);
  const current=row();bases.update(current);await bases.settled();
  for(let i=0;i<10;i++)bases.update(current);
  assert.equal(calls,1);assert.equal(notices,1);assert.equal(current.change,null);assert.equal(current.changePercent,null);
  assert.equal(current.price,57.085);
});

test("removed rows and responses from a prior snapshot cannot receive a late base", async () => {
  const {QuoteDayBases}=sources().load("services/quote-day-bases.ts");
  const old=deferred();let active=true,calls=0;
  const bases=new QuoteDayBases({request:async()=>++calls===1?old.promise:{candles:[bar(24,55)]}},()=>now,()=>active,()=>{},()=>{});
  const current=row();bases.update(current);
  bases.clear();bases.update(current);await bases.settled();
  assert.equal(current.previousClose,55);
  old.resolve({candles:[bar(24,999)]});await Promise.resolve();await Promise.resolve();
  assert.equal(current.previousClose,55);
  const removed=row("REMOVED");active=false;bases.update(removed);await bases.settled();
  assert.equal(removed.previousClose,null);
});

test("transient failure retries after 60s or reconnect without per-tick requests",async()=>{
  const {QuoteDayBases}=sources().load("services/quote-day-bases.ts");
  for(const reconnect of [false,true]){
    let calls=0,clock=now;
    const bases=new QuoteDayBases({request:async()=>{if(++calls===1)throw new Error("offline");return {candles:[bar(24,55)]};}},()=>clock,()=>true,()=>{},()=>{});
    const current=row();bases.update(current);await bases.settled();
    for(let i=0;i<100;i++){clock=now+i*500;bases.update(current);}
    assert.equal(calls,1);assert.equal(current.change,null);
    if(reconnect)bases.retryMissing();else clock=now+60_001;
    bases.update(current);await bases.settled();
    assert.equal(calls,2);assert.equal(current.previousClose,55);
    clock=now+1_000_000;for(let i=0;i<100;i++)bases.update(current);
    assert.equal(calls,2);
  }
});

function fixture(initialRows, { closeError=false, prices, closes=[] }={}) {
  const requests=[];
  class Transport {
    closed=false;
    serverNow(){return now;}
    connect(){}
    send(){}
    close(){this.closed=true;}
    async request(service,method,body){
      requests.push({service,method,body});
      if(method==="GetLastPrices")return {lastPrices:prices??[{instrumentUid:"VTBR",price:q(57.085),time:tick}]};
      if(method==="GetClosePrices"){
        if(closeError)throw new Error("close unavailable");
        return {closePrices:closes};
      }
      if(method==="GetCandles")return {candles:[bar(24,55)]};
      assert.fail(`unexpected request ${service}/${method}`);
    }
  }
  const cache={
    loadMarket:async()=>undefined,
    loadCatalog:async()=>({at:Date.now(),shares:[],futures:[],indicatives:[]}),
    loadWatchlist:async()=>initialRows,
    saveWatchlist:async()=>{},saveMarket:async()=>{},saveWatchlistSnapshot:async()=>{}
  };
  const {TBankClient}=sources({"services/tbank-transport.ts":{BankTransport:Transport,BankError:Error}}).load("services/tbank-client.ts");
  return {client:new TBankClient("safe-unit-test-value","Test",cache),requests};
}

test("initial snapshot and added instrument retain last when GetClosePrices fails",async()=>{
  for(const add of [false,true]){
    const {client,requests}=fixture(add?[]:[row()],{closeError:true});
    await client.start();
    if(add)await client.addInstrument({uid:"VTBR",ticker:"VTBR",name:"VTBR",minPriceIncrement:q(.005)});
    const current=client.rows[0];
    assert.equal(current.price,57.085);assert.equal(current.previousClose,55);
    assert.ok(Math.abs(current.change-2.085)<1e-9);
    assert.equal(requests.filter(r=>r.method==="GetCandles").length,1);
  }
});

test("all 14 snapshot instruments share one date-aware policy and map closes by UID",async()=>{
  const values=[["SBER",286.96,285.3],["GAZP",102.48,101.71],["NVTK",1017.4,999.5],["SIBN",479.25,472],["LKOH",5920,5810.5],["ROSN",327.45,323.2],["OZON",3507.5,3536.5],["VTBR",57.085,55],["RTSI",898.52,890.66],["IMOEX",2347.78,2323.08],["MOEX",161.18,157.95],["T",279.3,276.6],["NG",3.322,3.322],["YDEX",3260,3240]];
  const prices=values.map(([symbol,price])=>({instrumentUid:symbol,price:q(price),time:tick}));
  const closes=values.toReversed().map(([symbol,price,base])=>({...close,instrumentUid:symbol,price:q(price+1),eveningSessionPrice:q(base)}));
  const {client,requests}=fixture(values.map(([symbol])=>row(symbol)),{prices,closes});
  await client.start();
  for(const [symbol,price,base] of values){
    const current=client.rows.find(r=>r.uid===symbol);
    assert.equal(current.previousClose,base);assert.equal(current.price,price);
    assert.ok(Math.abs(current.change-(price-base))<1e-8);
    assert.equal(current.previousCloseDay,"2026-11-25");
  }
  assert.equal(requests.filter(r=>r.method==="GetCandles").length,0);
});
