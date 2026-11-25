import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import vm from "node:vm";
import ts from "typescript";
const root=fileURLToPath(new URL("../src/",import.meta.url));
function loadSources(overrides={},globals={}){
 const cache=new Map(),context=vm.createContext({console,Math,Number,Object,...globals});
 function load(relative){
  const key=relative.replaceAll("\\","/");if(Object.hasOwn(overrides,key))return overrides[key];
  let file=path.resolve(root,relative).replace(/\.js$/,".ts");
  if(relative.endsWith("ChartNavigation.js"))file+="x";
  if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const code=ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInContext(`(function(require,module,exports){${code}\n})`,context,{filename:file})(s=>Object.hasOwn(overrides,s)?overrides[s]:load(path.relative(root,path.resolve(path.dirname(file),s))),module,module.exports);
  return module.exports;
 }return load;
}
function clock(){
 let now=0,sequence=0;const frames=new Map();
 const scheduler={now:()=>now,frame:fn=>{frames.set(++sequence,fn);return sequence;},cancel:id=>frames.delete(id)};
 return{scheduler,step(time){now=time;for(const id of [...frames.keys()]){const fn=frames.get(id);frames.delete(id);fn?.(time);}},pending:()=>frames.size};
}
function fixture(){
 const timing=clock(),calls=[],session={},listeners=new Set();
 const state={authenticated:true,candles:[{timestamp:1}],owner:"A",rows:[{uid:"uid",symbol:"TEST"}],chartRevision:0,
  preferences:{symbol:"TEST",timeframe:"1d",engine:"kline",rangeDays:30}};
 const chart={source:{owner:"A",uid:"uid",viewKey:"TEST:1d:kline:30"},getView:()=>({camera:{barSpace:6,rightOffsetBars:8}}),plotSize:()=>({width:800,height:400}),
  beginViewInteraction:(...args)=>calls.push(["intent",...args]),endViewInteraction:()=>calls.push(["end"]),
  beginPan:()=>calls.push(["freeze"]),endPan:()=>calls.push(["pan-end"]),scroll:(...args)=>calls.push(["scroll",...args])};
 const controller={chart,getSnapshot:()=>state,sessionKey:()=>session,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
 const {ChartScrollHold}=loadSources()("screens/terminal/chart-scroll-hold.js");
 return{timing,calls,state,chart,controller,listeners,hold:new ChartScrollHold(controller,timing.scheduler)};
}
test("hold begins once after delay, fractional dt is clamped, release stops RAF and suppresses one click",()=>{
 const f=fixture();let releases=0;
 assert.equal(f.hold.start(-1,"pointer:1",()=>releases++),true);
 f.timing.step(100);f.timing.step(180);assert.deepEqual(f.calls,[]);
 f.timing.step(196);f.timing.step(212);f.timing.step(1000);
 assert.deepEqual(f.calls.slice(0,2),[["intent",true,true],["freeze"]]);
 const steps=f.calls.filter(x=>x[0]==="scroll");assert.equal(steps.length,3);
 assert.equal(steps[0][2],16/300);assert.equal(steps[2][2],50/300);
 assert.equal(f.calls.filter(x=>x[0]==="intent").length,1);
 assert.equal(f.hold.finish("pointer:1"),"held");assert.equal(releases,1);assert.equal(f.timing.pending(),0);
 const size=f.calls.length;f.timing.step(5000);assert.equal(f.calls.length,size);
 assert.equal(f.hold.click(-1),false);assert.equal(f.hold.click(-1),true);
 f.hold.start(1,"key:Enter");f.timing.step(5050);assert.equal(f.hold.finish("key:Enter"),"short");assert.equal(f.hold.click(1),false);
 const changed=fixture();changed.hold.start(-1,"pointer:1");assert.equal(changed.hold.finish("pointer:1"),"short");
 changed.state.owner="B";assert.equal(changed.hold.click(-1),false,"a click after pointerup cannot target a replacement owner");
});
test("each frame and subscription validation reject changed owner/source/session/import/loading and release capture",()=>{
 const changes=[f=>f.state.owner="B",f=>f.controller.chart={...f.chart},f=>f.chart.source={...f.chart.source,uid:"other"},
  f=>f.controller.sessionKey=()=>({}),f=>f.state.importingBackup=true,f=>f.state.loading=true,
  f=>f.state.candles=[],f=>f.chart.retired=true,f=>f.chart.persistView=false,f=>f.state.chartRevision++];
 for(const change of changes){const f=fixture();let releases=0;f.hold.start(-1,"pointer:1",()=>releases++);f.timing.step(200);
  change(f);f.hold.validate();f.timing.step(216);
  assert.equal(f.calls.filter(x=>x[0]==="scroll").length,1);assert.equal(releases,1);assert.equal(f.timing.pending(),0);
  assert.equal(f.calls.filter(x=>x[0]==="end").length,1);assert.equal(f.hold.click(-1),false);
 }
 const f=fixture();f.state.loading=true;assert.equal(f.hold.start(1,"key: "),false);assert.equal(f.timing.pending(),0);
 const pending=fixture();pending.hold.start(-1,"pointer:1");pending.state.importingBackup=true;pending.timing.step(200);
 assert.deepEqual(pending.calls,[]);assert.equal(pending.timing.pending(),0);
});
function componentFixture(){
 const f=fixture(),cleanups=[],window=new EventTarget(),document=new EventTarget();document.visibilityState="visible";
 const load=loadSources({react:{useRef:()=>({current:null}),useMemo:fn=>fn(),useEffect:fn=>cleanups.push(fn()),
  useState:()=>[{chart:f.chart,left:400,top:500},()=>{}]},"react/jsx-runtime":{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
  "./context.js":{useTerminal:()=>({controller:f.controller,state:f.state})}},
  {window,document,performance:{now:f.timing.scheduler.now},requestAnimationFrame:f.timing.scheduler.frame,cancelAnimationFrame:f.timing.scheduler.cancel});
 const panel=load("screens/terminal/ChartNavigation.js").ChartNavigation(),button=panel.props.children[2],captures=new Set();
 const target={hasPointerCapture:id=>captures.has(id),setPointerCapture:id=>captures.add(id),releasePointerCapture:id=>{captures.delete(id);button.props.onLostPointerCapture({pointerId:id});}};
 const event=(extra={})=>({button:0,isPrimary:true,pointerId:7,currentTarget:target,repeat:false,preventDefault(){},stopPropagation(){},...extra});
 return{...f,button,captures,event,window,document,dispose:()=>cleanups.forEach(fn=>fn?.())};
}
test("real button handlers capture touch/pointer, preserve short click, stop cancel/blur/hidden/unmount and prevent held click",()=>{
 for(const reason of ["up","cancel","lost","blur","button-blur","hidden","unmount"]){
  const f=componentFixture();f.button.props.onPointerDown(f.event({pointerType:"touch"}));assert.equal(f.captures.has(7),true);
  f.timing.step(200);const count=f.calls.filter(x=>x[0]==="scroll").length;assert.equal(count,1);
  if(reason==="up")f.button.props.onPointerUp(f.event());
  if(reason==="cancel")f.button.props.onPointerCancel(f.event());
  if(reason==="lost")f.button.props.onLostPointerCapture(f.event());
  if(reason==="blur")f.window.dispatchEvent(new Event("blur"));
  if(reason==="button-blur")f.button.props.onBlur();
  if(reason==="hidden"){f.document.visibilityState="hidden";f.document.dispatchEvent(new Event("visibilitychange"));}
  if(reason==="unmount")f.dispose();
  f.timing.step(500);f.button.props.onClick();
  assert.equal(f.calls.filter(x=>x[0]==="scroll").length,count,reason);assert.equal(f.captures.size,0,reason);f.dispose();
 }
 const f=componentFixture();f.button.props.onPointerDown(f.event());f.timing.step(50);f.button.props.onPointerUp(f.event());f.button.props.onClick();
 assert.deepEqual(f.calls.filter(x=>x[0]==="scroll"),[["scroll",-1]]);f.dispose();
});
test("Enter/Space keyboard hold ignores auto-repeat and settles once; short keyboard press is one action",()=>{
 for(const key of ["Enter"," "]){
  const f=componentFixture();f.button.props.onKeyDown(f.event({key}));f.button.props.onKeyDown(f.event({key,repeat:true}));f.timing.step(200);
  f.button.props.onKeyUp(f.event({key}));f.button.props.onClick();f.timing.step(500);
  assert.equal(f.calls.filter(x=>x[0]==="scroll").length,1);assert.equal(f.calls.filter(x=>x[0]==="end").length,1);f.dispose();
 }
 const f=componentFixture();f.button.props.onKeyDown(f.event({key:"Enter"}));f.timing.step(50);f.button.props.onKeyUp(f.event({key:"Enter"}));f.button.props.onClick();
 assert.deepEqual(f.calls.filter(x=>x[0]==="scroll"),[["scroll",-1]]);f.dispose();
});
