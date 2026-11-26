import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";
import ts from "typescript";
const root=fileURLToPath(new URL("../src/",import.meta.url));
function sources(){
 const modules=new Map();
 function load(relative){
  const file=path.resolve(root,relative).replace(/\.js$/,".ts");if(modules.has(file))return modules.get(file).exports;
  const module={exports:{}};modules.set(file,module);
  const code=ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`,{filename:file})(specifier=>load(path.relative(root,path.resolve(path.dirname(file),specifier))),module,module.exports);
  return module.exports;
 }return load;
}
const load=sources(),{chartPriceFormat,lightweightPriceFormat}=load("charts/price-format.ts"),{watchChartPriceMetadata}=load("screens/terminal/chart-price-metadata.ts");
test("price format honors decimal/scientific finite tick sizes and uses valid fallbacks",()=>{
 for(const [step,digits] of [[.005,3],[.000002,6],[1e-8,8],[5e-9,9],[2.5,1],[1,0]]){
  assert.equal(chartPriceFormat({symbol:"VTBR",step}).precision,digits);assert.equal(chartPriceFormat({symbol:"VTBR",step}).minMove,step);
 }
 for(const step of [null,0,-1,NaN,Infinity])assert.deepEqual(chartPriceFormat({symbol:"VTBR",step}),{precision:2,minMove:null});
 assert.deepEqual(chartPriceFormat({symbol:"NG",step:null}),{precision:3,minMove:null});
});
test("unknown step preserves observed quote digits monotonically without inventing an exchange tick",()=>{
 let format=chartPriceFormat({symbol:"EUR/USD",step:null,price:1.1});
 assert.deepEqual(format,{precision:2,minMove:null});
 assert.equal(lightweightPriceFormat(format).formatter(1.1),"1.10","API exact 1.1 cannot imply a different TradingView quote");
 format=chartPriceFormat({symbol:"EUR/USD",step:0,price:1.09856},format);
 assert.equal(format.precision,5);assert.equal(format.minMove,null);
 format=chartPriceFormat({symbol:"EUR/USD",step:null,price:1.1},format);assert.equal(format.precision,5);
 const tiny=chartPriceFormat({symbol:"TGKA",step:null,price:.004842});
 assert.equal(tiny.precision,6);assert.equal(lightweightPriceFormat(tiny).formatter(.004842),"0.004842");
 assert.equal(chartPriceFormat({symbol:"FX",step:null,price:.1+.2}).precision,2,"nanounit normalization excludes binary float noise");
 assert.equal(chartPriceFormat({symbol:"FX",step:null,price:.1234567894}).precision,9);
 format=chartPriceFormat({symbol:"EUR/USD",step:.005,price:1.09856},format);assert.deepEqual(format,{precision:3,minMove:.005});
 assert.equal(chartPriceFormat({symbol:"EUR/USD",step:null,price:1.09856789},format),format,"resolved exchange step remains authoritative");
});
function fixture(){
 let state={owner:"A",authenticated:true,chartRevision:0,rows:[{symbol:"VTBR",uid:"vtbr",step:null}],preferences:{symbol:"VTBR",instrumentUid:"vtbr",timeframe:"1d",engine:"tradingview",rangeDays:365}},session={};
 const calls=[],listeners=new Set();let alive=true;
 const adapter={source:{owner:"A",uid:"vtbr",viewKey:"VTBR:1d:tradingview:365"},updatePriceFormat:value=>calls.push(value),
  setData:()=>assert.fail("metadata cannot reload data"),setView:()=>assert.fail("metadata cannot restore camera"),fit:()=>assert.fail("metadata cannot fit")};
 const controller={chart:adapter,getSnapshot:()=>state,sessionKey:()=>session,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
 const stop=watchChartPriceMetadata(controller,adapter,()=>alive);
 return{calls,listeners,adapter,controller,state:()=>state,stop,update(patch){state={...state,...patch};listeners.forEach(fn=>fn());},
  step(value){state.rows=[{...state.rows[0],step:value}];listeners.forEach(fn=>fn());},price(value){state.rows=[{...state.rows[0],price:value}];listeners.forEach(fn=>fn());},setSession(value){session=value;},end(){alive=false;}};
}
test("price hints expand current unknown-step format until real metadata resolves it",()=>{
 const f=fixture();f.price(.004842);assert.equal(f.calls.length,1);assert.equal(f.calls[0].step,null);assert.equal(f.calls[0].priceHint,.004842);
 f.price(.0048);assert.equal(f.calls.length,1);f.price(.004842001);assert.equal(f.calls.length,2);
 f.step(.000002);assert.equal(f.calls.length,3);assert.equal(f.calls.at(-1).step,.000002);
 f.price(.004842002);assert.equal(f.calls.length,3);f.stop();
});
test("late metadata is incremental, deduplicated, import-delayed, and subscription cleanup stops updates",()=>{
 const f=fixture();assert.equal(f.calls.length,0);f.step(.005);f.step(.005);assert.equal(f.calls.length,1);
 f.update({importingBackup:true});f.step(.000002);assert.equal(f.calls.length,1);
 f.update({importingBackup:false});assert.equal(f.calls.length,2);
 f.stop();assert.equal(f.listeners.size,0);f.step(1e-8);assert.equal(f.calls.length,2);
});
test("retired/owner/UID/session/revision/source/view/import guards reject metadata for an outgoing adapter",()=>{
 const changes=[f=>f.update({owner:"B"}),f=>f.update({authenticated:false}),f=>f.update({importRecoveryRequired:true}),
  f=>f.update({chartRevision:1}),f=>{f.controller.chart=null;},f=>{f.adapter.retired=true;},f=>{f.adapter.source={...f.adapter.source,uid:"other"};},
  f=>{f.adapter.source={...f.adapter.source,owner:"B"};},f=>f.setSession({}),f=>f.end(),
  f=>f.update({rows:[{symbol:"VTBR",uid:"other",step:null}]}),f=>f.update({preferences:{...f.state().preferences,timeframe:"1h"}})];
 for(const change of changes){const f=fixture();change(f);f.step(.005);f.price(.004842);assert.equal(f.calls.length,0);f.stop();}
});
