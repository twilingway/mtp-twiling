import test from "node:test";
import assert from "node:assert/strict";
import { createSourceLoader } from "./technical-volume-registration-fixture.mjs";
import { bars } from "./keltner-fixture.mjs";
import { settings, walk, text } from "./technical-state-oscillator-settings-fixture.mjs";
import { klineFixture, output, compiled } from "./ta-render-kline-fixture.mjs";
import { fixture as lwFixture } from "./ta-render-lightweight-fixture.mjs";

const load=createSourceLoader(),core=load("model/technical-indicators/index.js"),
  math=load("model/technical-indicators/relative-oscillators/index.js"),
  {compilePresentation}=load("model/technical-indicators/presentation.js"),
  {referenceRelativeValue,lightweightReferenceContext}=load("charts/lightweight-reference-context.js");
const ids=["stochastic-rsi","coppock-curve"];
const make=(id,options={})=>core.createTechnicalIndicatorInstance(id,id,options);
test("only two append after old51; exact defaults, strict v1 styles, source/gap/causal/raw-series contract",()=>{
  assert.equal(core.technicalIndicatorDefinitions.length,53);
  assert.deepEqual(core.technicalIndicatorDefinitions.slice(51).map(d=>d.id),ids);
  assert.deepEqual(make(ids[0]).params,{rsiLength:14,stochasticLength:14,smoothK:3,smoothD:3,source:"close"});
  assert.deepEqual(make(ids[1]).params,{wmaLength:10,longRocLength:14,shortRocLength:11});
  const input=bars(90).map((bar,index)=>index===30?{...bar,close:null}:bar),before=JSON.stringify(input);
  for(const id of ids){
    const instance=make(id),result=core.calculateTechnicalIndicator(instance,input),expected=id===ids[0]?math.stochasticRsi(input,instance.params):{value:math.coppockCurve(input,instance.params)};
    assert.deepEqual(result.series,expected);
    assert.deepEqual(Object.keys(result.series),id===ids[0]?["k","d"]:["value"]);
    const prefix=core.calculateTechnicalIndicator(instance,input.slice(0,40));
    for(const key of Object.keys(result.series))assert.deepEqual(prefix.series[key],result.series[key].slice(0,40));
    assert.deepEqual(JSON.parse(JSON.stringify(instance)),instance);
    for(const value of [null,[],{...instance.params,unknown:1}])assert.equal(core.isTechnicalIndicatorInstance({...instance,params:value}),false);
    assert.throws(()=>make(id,{params:{...instance.params,[Object.keys(instance.params)[0]]:0}}));
  }
  assert.equal(JSON.stringify(input),before);
  const instance=make(ids[0],{styles:{upperBand:{color:"#123456",width:2,visible:false,opacity:0.3,lineStyle:"dotted"},background:{color:"#abcdef",width:1,visible:true,opacity:0}}});
  assert.equal(core.isTechnicalIndicatorInstance(instance),true);
  assert.equal(core.isTechnicalIndicatorInstance({...instance,styles:{hidden:{color:"#123456",width:1,visible:true}}}),false);
});
test("fullN cost preflight returns no allocated result rows/constants and no persisted limit marker",()=>{
  const expensive=make(ids[0],{params:{smoothK:10000,smoothD:10000}}),
    hostile=new Proxy({length:1_000_000},{get(target,key){if(key==="length")return target.length;throw Error("input consumed before preflight");}});
  const result=core.calculateTechnicalIndicator(expensive,hostile);
  assert.equal(result.unavailableReason,"calculation-limit");assert.deepEqual(result.timestamps,[]);assert.deepEqual(result.series,{k:[],d:[]});
  assert.equal("unavailableReason" in expensive,false);
});
test("compiler creates constants only in render graph; references and fill v1 styles independent of disabled K/D",()=>{
  const definition=core.getTechnicalIndicatorDefinition(ids[0]),series={k:[null,40,60],d:[null,null,50]},before=JSON.stringify(series);
  const graph=compilePresentation(definition.presentation,{timestamps:[1,2,3],series,visible:true,collapsed:false,styles:{k:{color:"#2962FF",width:1,visible:false},upperBand:{color:"#123456",width:2,visible:false}}});
  assert.equal(graph.plots.length,2);assert.equal(graph.plots[0].visible,false);assert.equal(graph.referenceLevels[0].visible,false);
  assert.deepEqual(graph.referenceLevels.map(r=>r.scale),Array(3).fill("include-when-visible"));
  assert.deepEqual(graph.fills[0].from,[80,80,80]);assert.equal(graph.fills[0].scale,"none");assert.equal(graph.fills[0].extent,"pane");
  assert.equal(JSON.stringify(series),before);assert.equal(graph.plots[0].geometry.gaps,"legacy");
  assert.throws(()=>compilePresentation(definition.presentation,{timestamps:[1],series:{k:[1],d:[1],"$stoch:upper80":[0]},visible:true,collapsed:false}),/collision/);
});
test("RU/EN actual form submits new params and sparse ref styles in both panes without style field pollution",async()=>{
  for(const locale of ["ru","en"])for(const id of ids)for(const price of [true,false]){
    const f=settings(id,locale),definition=core.getTechnicalIndicatorDefinition(id);let tree=f.render();
    const p=definition.parameters[0],label=locale==="en"?(id===ids[0]?"RSI Length":"WMA Length"):(id===ids[0]?"Период RSI":"Период WMA");
    f.control(tree,label).props.onChange({target:{value:"7"}});
    f.control(f.render(),locale==="en"?"Location":"Расположение").props.onChange({target:{value:price?"price":`pane:${id}`}});
    await f.submit(f.render());
    const saved=f.controller.getSnapshot().preferences.technicalIndicators[0];assert.equal(saved.params[p.key],7);assert.equal(saved.styles,undefined);assert.equal(saved.pane.kind,price?"overlay":"pane");
  }
  const f=settings(ids[0],"en");let tree=f.render();const group=walk(tree,n=>n.type==="div"&&n.props.className==="technical-output-style").find(n=>text(n).includes("Upper Band"));
  walk(group,n=>n.type==="input"&&n.props.type==="color")[0].props.onChange({target:{value:"#123456"}});
  await f.submit(f.render());const saved=f.controller.getSnapshot().preferences.technicalIndicators[0];assert.equal(core.isTechnicalIndicatorInstance(saved),true);assert.deepEqual(Object.keys(saved.styles),["upperBand"]);
});

function controlled(values=[40,45,50,55,60,50,45,40],styles={}){
  const definition=core.getTechnicalIndicatorDefinition(ids[0]),graph=compilePresentation(definition.presentation,{timestamps:values.map((_,i)=>(i+1)*1000),series:{k:values,d:values.map(v=>v===null?null:v+1)},styles,visible:true,collapsed:false});
  const outputs=graph.plots.map((plot,index)=>output("stoch",plot.values,plot.geometry,{...plot}));
  // Native adapter receives its actual bridge output shape, not raw constants or fake quotes.
  outputs.forEach((o,i)=>{o.timestamps=graph.timestamps;o.paneKey="pane:stoch";o.outputId=graph.plots[i].id;o.key=`stoch/${o.outputId}`;o.presentation=graph.plots[i];o.style={color:graph.plots[i].color.color,width:1,visible:graph.plots[i].visible,opacity:graph.plots[i].opacity,lineStyle:"solid"};});
  const result=compiled(outputs);result.references=graph.referenceLevels.map((r,i)=>({...r,key:`stoch/ref/${r.id}`,instanceId:"stoch",paneKey:"pane:stoch",order:3+i,timestamps:outputs[0].timestamps}));
  result.fills=graph.fills.map(f=>({...f,key:"stoch/background",instanceId:"stoch",paneKey:"pane:stoch",order:2,timestamps:outputs[0].timestamps,scalePlotKey:outputs[0].key}));return result;
}
test("actual registered K fixed2 hlines own domain at KD40..60/0..100/allNA; toggles/remove and precision8 peer",async(t)=>{
  const f=klineFixture(8);t.after(()=>f.dispose());
  for(const values of [[40,45,50,55,60,50,45,40],[0,20,40,60,80,100,50,40],Array(8).fill(null)]){
    f.set(controlled(values));await f.ready();const owner=f.entries("technical:stoch").find(i=>!i.name.includes("FILL"));
    assert.equal(owner.precision,2);assert.ok(owner.figures.some(fig=>fig.type==="mtp-ta-reference-level"));
    const range=f.range("technical:stoch");assert.ok(range.from<=20&&range.to>=80);
    const params=f.params(owner);owner.draw(params);assert.ok(params.ctx.calls.some(c=>c[0]==="lineTo"&&c[1]===params.bounding.width));
    assert.deepEqual(Object.keys(owner.result[0]),["k","d"]);
    assert.equal(JSON.stringify(f.tooltip(owner)).includes("upperBand"),false);
    f.precision(6);f.precision(8);assert.equal(owner.precision,2);
  }
  f.set(controlled([40,45,50,55,60,50,45,40],Object.fromEntries(["upperBand","middleBand","lowerBand"].map(id=>[id,{color:"#787B86",width:1,visible:false}]))));await f.ready();assert.ok(f.range("technical:stoch").from>20&&f.range("technical:stoch").to<80);
  f.set({groups:[],outputs:[],fills:[],references:[]});await f.ready();assert.equal(f.entries("technical:stoch").length,0);
});
test("LW reference lifecycle/full-pane paint and scale semantic avoid output/tooltips pollution",()=>{
  const graph=controlled(),f=lwFixture(graph),add=f.chart.addSeries;
  f.chart.addSeries=(...args)=>{const series=add(...args),scale=series.priceScale;series.priceScale=()=>({...scale(),options:()=>({mode:0})});return series;};
  f.render();assert.equal(f.series().length,5);assert.equal(f.paint(true).filter(c=>c[0]==="fillRect").length,1);
  assert.ok(f.paint().some(c=>c[0]==="lineTo"&&c[1]===300));
  const refs=f.series().slice(2);assert.deepEqual(refs.map(s=>s.data[0].value),[80,50,20]);
  f.render({groups:[],outputs:[],fills:[],references:[]});assert.equal(f.series().length,0);f.adapter.dispose();
});
test("relative commonbase transforms match raw native percentage/indexed math; current viewport rejects future-only D19",()=>{
  for(const own of [20,40,60,80,-40])for(const common of [40,100,-20])for(const value of [20,50,80]){
    const converted=referenceRelativeValue(value,own,common,2);assert.ok(Math.abs((converted-own)/Math.abs(own)-(value-common)/Math.abs(common))<1e-12);
    assert.equal(referenceRelativeValue(value,own,common,3),converted);
  }
  const outputs=[{instanceId:"s",paneKey:"pane:s",key:"s/k",style:{visible:true},timestamps:Array.from({length:21},(_,i)=>i*1000),values:Array.from({length:21},(_,i)=>i===17?40:null)},
    {instanceId:"s",paneKey:"pane:s",key:"s/d",style:{visible:true},timestamps:Array.from({length:21},(_,i)=>i*1000),values:Array.from({length:21},(_,i)=>i===19?60:null)}];
  const k={priceToCoordinate:()=>17},d={priceToCoordinate:()=>19},primary={priceToCoordinate:()=>100,dataByIndex:()=>({time:0,close:100})};
  const context=lightweightReferenceContext({timeScale:()=>({getVisibleRange:()=>({from:0,to:18}),getVisibleLogicalRange:()=>({from:0,to:18})})},()=>primary);
  context.update(outputs,new Map([["s/k",k],["s/d",d]]));assert.equal(context.project("s","pane:s",80),17);assert.equal(context.project("s","price",80),100);
});
