import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("../src/", import.meta.url));
function modules(overrides = {}) {
  const cache = new Map();
  function load(name) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    const candidate = path.resolve(root, name).replace(/\.js$/, ".ts"), file = existsSync(candidate) ? candidate : candidate + "x";
    const relative = path.relative(root, file).replaceAll(path.sep, "/");
    if (Object.hasOwn(overrides, relative)) return overrides[relative];
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const output = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    new vm.Script(`(function(require,module,exports){${output}\n})`, { filename: file }).runInThisContext()(
      (specifier) => Object.hasOwn(overrides, specifier) ? overrides[specifier] : load(path.relative(root, path.resolve(path.dirname(file), specifier))), module, module.exports);
    return module.exports;
  }
  return load;
}
const load = modules(), model = load("model/instrument-details/data.js"), history = load("model/instrument-details/history.js");
const { InstrumentDetailsRepository } = load("services/instrument-details/repository.js");
const DAY = 86400000, now = Date.UTC(2026,10,25,12);
const bar = (timestamp, close = 100, volume = 100) => ({ timestamp, open: close, close, high: close, low: close, volume });
function bars(from, to) {
  const result = [];
  for (let time = from; time <= to; time += DAY) if (![0,6].includes(new Date(time).getUTCDay())) result.push(bar(time, 100 + result.length / 10));
  return result;
}
const rawCandle = (candle) => ({ time: new Date(candle.timestamp).toISOString(), isComplete: true, volume: String(candle.volume), ...Object.fromEntries(["open","close","high","low"].map((key) => [key,{ units: String(Math.trunc(candle[key])), nano: Math.round(candle[key] % 1 * 1e9) }])) });
function client(request) { return { owner: "owner-a", authenticated: true, closed: false, request }; }
const noLocal = async () => [];
const signal = () => new AbortController().signal;
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("fundamentals preserve missing values, negative results, currency and fiscal period; scalar zero remains ambiguous", () => {
  const result = model.fundamentals({ fundamentals: [{assetUid:"asset-a",currency:"rub",marketCapitalization:0,netIncomeTtm:-200,fiscalPeriodEndDate:"2026-09-30T00:00:00Z"}] }, "asset-a");
  assert.equal(result.values[0],null);
  assert.equal(result.values[1],null);
  assert.equal(result.values[3],-200);
  assert.equal(result.currency,"rub");
  assert.equal(result.end,"2026-09-30T00:00:00Z");
  assert.equal(model.fundamentals({fundamentals:[]},"asset-a"),null);
  assert.equal(model.quote({ units:"0" }),0);
  assert.equal(model.quote({}),null);
  assert.equal(model.numeric(""),null);
});

test("calendar contains dates and periods only, forecast UIDs cannot bleed between instruments", () => {
  assert.deepEqual(model.reports({events:[{instrumentId:"uid",reportDate:"2026-12-01T00:00:00Z",periodYear:2026,periodNum:3,periodType:"PERIOD_TYPE_QUARTER",revenue:999},{instrumentId:"foreign"}]},"uid"),[{ date:"2026-12-01T00:00:00Z",year:2026,period:3,type:"PERIOD_TYPE_QUARTER"}]);
  assert.equal(model.forecasts({targets:[{uid:"foreign",targetPrice:{units:"900"}}],consensus:{uid:"foreign"}},"uid").length,0);
  const forecasts = model.forecasts({targets:[{uid:"uid",company:"House",targetPrice:{units:"125"},currency:"usd",recommendationDate:"2026-11-20T00:00:00Z"}],consensus:{uid:"uid",consensus:{units:"120"},currency:"usd"}},"uid");
  assert.equal(forecasts[0].date,null);
  assert.equal(forecasts[0].target,120);
  assert.equal(forecasts[1].company,"House");
  assert.equal(forecasts[0].kind,"consensus");
  assert.equal(model.forecasts({targets:[{uid:"uid",company:""}]},"uid")[0].kind,"target");
});

test("incomplete/malformed candles are excluded without inventing zero prices or volume", () => {
  const raw = rawCandle(bar(now - DAY));
  assert.equal(history.dailyCandles({candles:[raw,{...raw,isComplete:false},{...raw,volume:undefined},{...raw,close:{units:"0"}},{...raw,high:{units:"1"}}]}).length,1);
  assert.equal(history.priceStats([],now).average30,null);
  assert.ok(history.priceStats([],now).returns.every((item) => item.value === null));
});

test("performance requires a real prior close and recent continuous history, average volume requires 30 sessions", () => {
  const full = bars(now - 400*DAY,now - DAY);
  const stats = history.priceStats(full,now);
  assert.equal(stats.average30,100);
  assert.ok(stats.returns.every((item) => item.value > 0));
  assert.equal(history.priceStats(full.slice(-29),now).average30,null);
  assert.equal(history.priceStats(full.slice(-40),now).returns.at(-1).value,null);
  const gap = full.filter((item) => item.timestamp < now - 100*DAY || item.timestamp > now - 60*DAY);
  assert.equal(history.priceStats(gap,now).returns.at(-1).value,null);
  assert.equal(history.priceStats(full,now+20*DAY).average30,null);
});

test("seasonality requires at least three complete month observations and excludes partial current month", () => {
  const full = bars(Date.UTC(2020,11,1),Date.UTC(2026,10,24));
  const stats = history.seasonality(full,now);
  assert.ok(stats.every((item) => item.count >= 5 && item.average !== null));
  const short = history.seasonality(bars(Date.UTC(2025,0,1),now),now);
  assert.ok(short.every((item) => item.average === null));
  const missing = full.filter((item) => new Date(item.timestamp).getUTCMonth() !== 6);
  assert.equal(history.seasonality(missing,now)[6].average,null);
});

test("loader uses only readonly UID methods and asset UID for fundamentals, deduplicates and caches per session", async () => {
  const requests = [];
  const bank = client(async (service,method,body) => {
    requests.push({service,method,body});
    if (method === "GetInstrumentBy") return {instrument:{uid:body.id,assetUid:"asset-a",instrumentType:"share",currency:"rub"}};
    if (method === "GetAssetFundamentals") return {fundamentals:[{assetUid:"asset-a",revenueTtm:123,currency:"rub"}]};
    if (method === "GetDividends") return {dividends:[]};
    throw new Error("Unexpected method");
  });
  const repo = new InstrumentDetailsRepository(bank,noLocal,()=>now);
  const [first,second] = await Promise.all([repo.load("uid","fundamentals",signal()),repo.load("uid","fundamentals",signal())]);
  assert.equal(first,second);
  assert.equal(requests.length,2);
  await repo.load("uid","fundamentals",signal());
  assert.equal(requests.length,2);
  assert.deepEqual(requests[1].body,{assets:["asset-a"]});
  await repo.load("uid","dividends",signal());
  assert.equal(requests.length,3);
  assert.equal(requests[2].body.instrumentId,"uid");
  assert.ok(requests.every((item) => item.service === "InstrumentsService"));
});

test("cancellation affects only its subscriber, last subscriber aborts the network and aborted result never caches", async () => {
  let finish, requestSignal, calls = 0;
  const bank = client(async (_service,_method,_body,signal) => { calls++; requestSignal=signal; return new Promise((resolve) => {finish=resolve;}); });
  const repo = new InstrumentDetailsRepository(bank,noLocal,()=>now);
  const a = new AbortController(), b = new AbortController();
  const first=repo.load("uid","fundamentals",a.signal), second=repo.load("uid","fundamentals",b.signal);
  await tick(); a.abort(); await assert.rejects(first,{name:"AbortError"});
  assert.equal(requestSignal.aborted,false);
  b.abort(); await assert.rejects(second,{name:"AbortError"});
  assert.equal(requestSignal.aborted,true);
  finish({instrument:{uid:"uid",instrumentType:"share"}}); await tick();
  const third=repo.load("uid","fundamentals",signal()); await tick();
  assert.equal(calls,2);
  finish({instrument:{uid:"uid",instrumentType:"share"}});
  assert.equal((await third).data.snapshot,null);
});

test("owner changes invalidate even a successful pending response and errors can be retried locally", async () => {
  let finish;
  const bank = client(async () => new Promise((resolve) => {finish=resolve;}));
  const repo = new InstrumentDetailsRepository(bank,noLocal,()=>now);
  const request=repo.load("uid","reports",signal()); await tick();
  bank.owner="owner-b"; finish({instrument:{uid:"uid",instrumentType:"share"}});
  await assert.rejects(request,{name:"AbortError"});
  let count=0;
  const retry = new InstrumentDetailsRepository(client(async () => { if (++count===1) throw Object.assign(new Error("denied"),{code:403}); return {instrument:{uid:"uid",instrumentType:"share"}}; }),noLocal,()=>now);
  await assert.rejects(retry.load("uid","fundamentals",signal()),{code:403});
  assert.equal((await retry.load("uid","fundamentals",signal())).data.snapshot,null);
  assert.equal(count,2);
});

test("history reuses older DAY storage and seed, verifies recent completion; seasonal fetch is sequential, bounded and cancellable", async () => {
  let calls=0, reads=0;
  const full=bars(now-400*DAY,now-3*DAY);
  const recent = async (_service,_method,body) => { calls++;assert.equal(Date.parse(body.from),now-10*DAY);return {candles:bars(now-9*DAY,now-DAY).map(rawCandle)}; };
  const local = new InstrumentDetailsRepository(client(recent),async(owner,uid,timeframe)=>{reads++;assert.equal(owner,"owner-a");assert.equal(uid,"uid");assert.equal(timeframe,"1d");return full;},()=>now);
  const localResult = (await local.load("uid","history",signal())).data;
  assert.equal(localResult.source,"api");
  assert.ok(localResult.completion.confirmed>0);assert.ok(localResult.completion.unknown>0);
  assert.equal(calls,1); assert.equal(reads,1);
  const seeded = new InstrumentDetailsRepository(client(recent),noLocal,()=>now);
  assert.equal((await seeded.load("uid","history",signal(),full)).data.source,"api");
  assert.equal(calls,2);
  let active=0,maxActive=0;
  const requests=[], progress=[];
  const seasonal = new InstrumentDetailsRepository(client(async(service,method,body)=>{
    active++;maxActive=Math.max(maxActive,active);requests.push(body);
    assert.equal(service,"MarketDataService");assert.equal(method,"GetCandles");
    await tick();active--;
    return {candles:bars(Date.parse(body.from),Date.parse(body.to)-DAY).map(rawCandle)};
  }),noLocal,()=>now);
  const result=await seasonal.load("uid","seasonality",signal(),[],(done,total)=>progress.push([done,total]));
  assert.equal(requests.length,6);assert.equal(maxActive,1);assert.deepEqual(progress.at(-1),[6,6]);
  assert.ok(result.data.bars.length>1000);
  assert.ok(requests.every((request)=>request.interval==="CANDLE_INTERVAL_DAY"&&request.instrumentId==="uid"&&request.limit===2400));
  let cancelledCalls=0;
  const stop=new AbortController();
  const cancellable=new InstrumentDetailsRepository(client(async()=>{cancelledCalls++;stop.abort();return {candles:[]};}),noLocal,()=>now);
  await assert.rejects(cancellable.load("uid","seasonality",stop.signal),{name:"AbortError"});
  assert.equal(cancelledCalls,1);
});

test("RU/EN renders real units and missing states; calendar has no invented financial report and empty forecasts stay explicit", () => {
  let locale="en";
  const render = modules({"react/jsx-runtime":jsx,"i18n/preferences.ts":{currentDisplayPreferences:()=>({locale})}});
  const ui=render("screens/terminal/InstrumentDetailsData.js");
  const html=renderToStaticMarkup(jsx.jsx(ui.InstrumentDetailsFundamentals,{data:{info:{isin:null,exchange:null,country:null,lot:10},snapshot:null}}));
  assert.match(html,/T-Invest did not provide fundamentals/);
  const forecasts=renderToStaticMarkup(jsx.jsx(ui.InstrumentDetailsForecasts,{data:[]}));
  assert.match(forecasts,/No forecasts provided/);
  const unnamed=renderToStaticMarkup(jsx.jsx(ui.InstrumentDetailsForecasts,{data:model.forecasts({targets:[{uid:"uid",company:""}]},"uid")}));
  assert.match(unnamed,/Investment house unspecified/);assert.doesNotMatch(unnamed,/>Consensus</);
  locale="ru";
  const calendar=renderToStaticMarkup(jsx.jsx(ui.InstrumentDetailsReports,{data:[]}));
  assert.match(calendar,/даты публикации, не финансовые результаты/);
  assert.match(calendar,/Даты публикаций не предоставлены/);
});

test("closed company card renders without mounting sections or invoking the authenticated client", () => {
  let calls=0;
  const bank=client(async()=>{calls++;throw new Error("unexpected");});
  const row={uid:"uid",symbol:"SBER",ticker:"SBER"};
  const state={owner:bank.owner,authenticated:true,rows:[row],preferences:{symbol:"SBER",instrumentUid:"uid"}};
  const controller={sessionKey:()=>bank,getSnapshot:()=>state};
  const render=modules({react:React,"react/jsx-runtime":jsx,"screens/terminal/context.tsx":{useTerminal:()=>({state,controller})},"i18n/preferences.ts":{currentDisplayPreferences:()=>({locale:"en"})}});
  const {InstrumentDetails}=render("screens/terminal/InstrumentDetails.js");
  const html=renderToStaticMarkup(jsx.jsx(InstrumentDetails,{row}));
  assert.match(html,/Company and statistics/);
  assert.doesNotMatch(html,/Key fundamentals|GetCandles|Loading/);
  assert.equal(calls,0);
});
