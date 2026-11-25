import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync}from'node:fs';
import {spawn}from'node:child_process';
import {encodeCandles,decodeCandles,subtractRanges,mergeCandles,updateCandleList}from'../public/history-codec.js';
import {validateBackup,toBase64,fromBase64}from'../public/backup-format.js';
import {MtpModel,MTP_DEFINITIONS}from'../public/mtp.js';
import vm from'node:vm';

test('history binary blocks round-trip exactly, replace current bars and keep gaps',()=>{
  const bars=[{timestamp:1700000000000,open:110.25,high:112,low:109,close:111.5,volume:34567},{timestamp:1700000060000,open:111.5,high:113,low:110,close:112,volume:34}];
  assert.equal(encodeCandles(bars).byteLength,96);assert.deepEqual(decodeCandles(encodeCandles(bars)),bars);
  assert.throws(()=>decodeCandles(new ArrayBuffer(3)));
  assert.deepEqual(subtractRanges(0,100,[{from:10,to:30},{from:25,to:50},{from:80,to:120}]),[{from:0,to:10},{from:50,to:80}]);
  const replacement={...bars[1],close:112.5};assert.equal(mergeCandles(bars,[replacement]).length,2);assert.equal(updateCandleList([...bars],replacement).at(-1).close,112.5);
});
test('MTP exact source periods and SMA warmup agree with independent slice mean',()=>{
  const data=Array.from({length:800},(_,i)=>({timestamp:i*60000,close:100+Math.sin(i/9)*20+i/100}));
  for(const definition of Object.values(MTP_DEFINITIONS)){
    const original=readFileSync(new URL('../reference/mtp/'+definition.name+'.pine',import.meta.url),'utf8');
    assert.deepEqual(definition.periods,[...original.matchAll(/sma\(src,\s*(\d+)\)/g)].map(m=>Number(m[1])));
    const model=new MtpModel();model.reset(data,definition.periods);
    for(const period of definition.periods){assert.equal(model.sma(period-2,period),null);const expected=data.slice(800-period).reduce((sum,bar)=>sum+bar.close,0)/period;assert.ok(Math.abs(model.sma(799,period)-expected)<1e-8);}
    const updated=[...data.slice(0,-1),{...data.at(-1),close:240}];model.update(updated);
    const period=definition.periods.at(-1);const expected=updated.slice(-period).reduce((sum,bar)=>sum+bar.close,0)/period;assert.ok(Math.abs(model.sma(799,period)-expected)<1e-8);
  }
});
test('backup validation rejects credentials, executable/prototype data and invalid coordinates',()=>{
  const valid={application:'personal-terminal',schemaVersion:1,layout:{engine:'kline',indicators:{mtp160:true}},drawings:[{symbol:'GAZP',items:[{name:'segment',points:[{timestamp:1,value:20},{timestamp:2,value:21}]}]}],images:[],history:[]};
  assert.equal(validateBackup(valid),valid);
  assert.throws(()=>validateBackup({...valid,token:'secret'}));
  assert.throws(()=>validateBackup(JSON.parse('{"application":"personal-terminal","schemaVersion":1,"drawings":[],"images":[],"layout":{"__proto__":{}}}')));
  assert.throws(()=>validateBackup({...valid,drawings:[{symbol:'GAZP',items:[{name:'segment',points:[{timestamp:1,value:NaN}]}]}]}));
  const buffer=new Uint8Array([0,255,10,64]).buffer;assert.deepEqual(new Uint8Array(fromBase64(toBase64(buffer))),new Uint8Array(buffer));
});
test('service worker leaves bank requests alone and activates updates only on request',async()=>{
  const handlers={};let activated=0,responded=0;const deleted=[];
  const scope='https://example.test/quotes/';
  const context={URL,self:{registration:{scope},addEventListener:(type,handler)=>handlers[type]=handler,skipWaiting:()=>activated++,clients:{claim:async()=>{}}},caches:{open:async()=>({match:async()=>({offline:true}),addAll:async()=>{}}),keys:async()=>['unrelated','personal-terminal:/another/:old','personal-terminal:/quotes/:old'],delete:async key=>deleted.push(key)},fetch:async()=>{throw new Error('offline');}};
  vm.runInNewContext(readFileSync(new URL('../public/service-worker.js',import.meta.url),'utf8'),context);
  handlers.fetch({request:{url:'https://invest-public-api.tbank.ru/rest/test',method:'POST'},respondWith:()=>responded++});assert.equal(responded,0);
  handlers.fetch({request:{url:scope+'version.json',method:'GET'},respondWith:()=>responded++});assert.equal(responded,0);
  assert.equal(activated,0);handlers.message({data:{type:'ACTIVATE_UPDATE'}});assert.equal(activated,1);
  let navigation;handlers.fetch({request:{url:scope,method:'GET',mode:'navigate'},respondWith:promise=>navigation=promise});assert.deepEqual(await navigation,{offline:true});
  let activation;handlers.activate({waitUntil:promise=>activation=promise});await activation;assert.deepEqual(deleted,['personal-terminal:/quotes/:old']);
});
test('delivery server accepts no credentials or market-data proxy requests',async(t)=>{
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  t.after(()=>child.kill());
  const origin=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server timeout')),10000);child.stdout.on('data',chunk=>{const match=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});child.once('error',reject);});
  assert.equal((await fetch(origin+'/')).status,200);
  assert.equal((await fetch(origin+'/api/session',{method:'POST',body:'not-a-real-secret'})).status,405);
  for(const path of ['/api/state','/api/candles','/.secrets/example','/server.mjs'])assert.equal((await fetch(origin+path)).status,404);
  const version=await(await fetch(origin+'/version.json')).json();assert.ok(version.buildId);
});
