import test from "node:test";
import assert from "node:assert/strict";
import { createPortableFixture } from "./helpers/portable-database.mjs";
import { flowModules } from "./helpers/workspace-identity-flow.mjs";
async function fixture({mode="import",empty=false,foreign=false,storedSession=false}={}){
  const f=await createPortableFixture(),v2=f.load("services/storage-v2.ts"),camera=f.load("services/chart-camera.ts"),journal=f.load("services/restore-recovery-journal.ts");
  const viewKey="SBER:1h:tradingview:1",imported={camera:{barSpace:19,rightOffsetBars:7}},old={camera:{barSpace:3,rightOffsetBars:40}};
  const row={symbol:"SBER",ticker:"SBER",uid:"sber",figi:null,name:"SBER",currency:"RUB",color:"#ffffff",mark:"S",step:.01,price:null,previousClose:null,availability:"pending"};
  await v2.importBackup("device",{application:"personal-terminal",schemaVersion:2,drawings:[],images:[],watchlist:empty?[]:[row],views:[{key:viewKey,value:imported}],layout:{symbol:"SBER",instrumentUid:"sber",timeframe:"1h",engine:"tradingview",rangeDays:1,indicators:{ma:false,ema:false,volume:false,mtp160:false,mtp440:false,mtp640:false,mtpAll:false}}});
  if(mode==="shared-runtime"||foreign){await journal.completeRestoreRecovery(await journal.readRestoreRecovery("device"));await journal.beginRestoreRecovery(foreign?"foreign":"device",true);}
  const cameraKey="chart-camera:profile-v2:device:tradingview";
  await f.storageDB.put("preferences",{id:cameraKey,owner:"profile-v2:device",value:{symbol:"GAZP",timeframe:"1d",camera:old.camera}});
  await f.storageDB.put("coverage",{id:"device:sber:1h",owner:"device",ranges:[{from:0,to:Date.now()+86400000}]});
  const reads=[],events=[],controls={};
  class MarketBoundary extends EventTarget{
    constructor(token,_name,_storage,options){super();this.token=token;this.owner=options.owner;this.rows=[];this.cachePaused=false;}
    snapshot(){return {rows:this.rows,authenticated:!!this.token,marketReady:true,status:"connected",error:null,transport:"cache",updatedAt:null};}
    async start(){events.push("client-start");if(controls.clientFailure||this.token&&controls.authFailure)throw new Error("client startup failed");this.rows=await v2.loadWatchlist(this.owner)??[];return this.snapshot();}
    async close(){}async flush(){}
    async candles(){events.push(this.token?"auth-candles":"public-candles");if(controls.historyFailure||storedSession&&!this.token)throw new Error("history unavailable before bank restoration");const now=Math.floor(Date.now()/3600000)*3600000;return {candles:Array.from({length:500},(_,i)=>({timestamp:now-(499-i)*3600000,open:10,high:11,low:9,close:10,volume:0})),cached:true,requests:0,source:"cache",requestedRangeCovered:true};}
  }
  const load=flowModules({"services/storage-v2.ts":{...v2,savePreferences:async(...args)=>{events.push("prefs-write");return v2.savePreferences(...args);},...(storedSession?{restoreSession:async()=>({token:"fixture-bank-token",name:"Fixture",owner:"device"})}:{})},"services/storage-db.ts":f.storageDB,"services/workspace-identity.ts":{DEVICE_OWNER:"device",prepareDeviceWorkspace:async()=>({owner:"device",primaryOwner:"public",cloudOwner:"device",legacyOwners:[],conflicts:[]})},"services/market-client.ts":{MarketClient:MarketBoundary},"services/restore-recovery-journal.ts":{...journal,readRestoreRecovery:async owner=>{events.push("receipt-read");if(controls.readFailure)throw new Error("receipt read failed");return journal.readRestoreRecovery(owner);}},"services/chart-camera.ts":{...camera,resetSharedChartCamera:async(...args)=>{events.push("camera-reset");if(controls.resetFailure)throw new Error("camera reset failed");return camera.resetSharedChartCamera(...args);},loadChartView:async(...args)=>{events.push("view-read");const view=await camera.loadChartView(...args);reads.push(view);return view;}}});
  const {TerminalController}=load("screens/terminal/controller.ts"),controller=new TerminalController();
  controller.chart={getView:()=>{events.push("old-view-capture");return old;},plotSize:()=>({width:800,height:500})};
  return {f,controller,reads,events,controls,imported,old,cameraKey,journal};
}
for(const mode of ["import","shared-runtime"]){
  test(`actual new controller.start respects pending ${mode} camera semantics before first chart read`,async()=>{
    const f=await fixture({mode});try{await f.controller.start();const state=f.controller.getSnapshot();
      assert.equal(state.preferences.symbol,"SBER");assert.equal(state.preferences.timeframe,"1h");assert.ok(f.reads.length>0,"cold start must actually load a chart view");assert.deepEqual(f.reads[0].camera,mode==="import"?f.imported.camera:f.old.camera);
      assert.ok(f.events.indexOf("camera-reset")<f.events.indexOf("client-start"));assert.ok(f.events.indexOf("camera-reset")<f.events.indexOf("view-read"));assert.equal(f.events.includes("old-view-capture"),false,"cold pending startup must not persist a stale adapter");assert.equal(f.events.includes("prefs-write"),false,"unbound cold flush must not write visible default preferences");
      assert.equal(f.f.database.stores.preferences.has(f.cameraKey),mode==="shared-runtime");assert.equal(await f.journal.readRestoreRecovery("device"),undefined);assert.equal(state.importRecoveryRequired,false);assert.equal(state.ready,true);
    }finally{f.controller.dispose();}
  });
}
for(const failAuth of [false,true]){
  test(`pending import waits for stored bank session before loading uncached chart (${failAuth?"retry auth":"success"})`,async()=>{
    const f=await fixture({storedSession:true});try{
      f.controls.authFailure=failAuth;await f.controller.start();
      assert.equal(f.events.includes("public-candles"),false);
      if(failAuth){
        assert.equal(f.controller.getSnapshot().importRecoveryRequired,true);
        assert.ok(await f.journal.readRestoreRecovery("device"));
        f.controls.authFailure=false;await f.controller.recoverBackup();
      }
      assert.equal(f.controller.getSnapshot().authenticated,true);
      assert.equal(f.controller.getSnapshot().importRecoveryRequired,false);
      assert.equal(await f.journal.readRestoreRecovery("device"),undefined);
      assert.deepEqual(f.reads.at(-1).camera,f.imported.camera);
    }finally{f.controller.dispose();}
  });
}
for(const failure of ["readFailure","resetFailure","clientFailure","historyFailure"]){
  test(`cold startup ${failure} retains receipt and the actual public recovery action retries safely`,async()=>{
    const f=await fixture();try{const receipt=await f.journal.readRestoreRecovery("device");f.controls[failure]=true;await assert.rejects(f.controller.start());assert.equal(f.controller.getSnapshot().importRecoveryRequired,true);assert.equal((await f.journal.readRestoreRecovery("device")).operationId,receipt.operationId);if(failure!=="historyFailure")assert.equal(f.reads.length,0);
      f.controls[failure]=false;await f.controller.recoverBackup();assert.equal(f.controller.getSnapshot().importRecoveryRequired,false);assert.equal(f.controller.getSnapshot().workspaceMigrationIncomplete,false);assert.equal(f.controller.getSnapshot().ready,true);assert.equal(await f.journal.readRestoreRecovery("device"),undefined);assert.deepEqual(f.reads.at(-1).camera,f.imported.camera);
    }finally{f.controller.dispose();}
  });
}
test("cold startup finishes a valid empty-watchlist import without a permanent view-recovery loop",async()=>{const f=await fixture({empty:true});try{await f.controller.start();assert.equal(f.controller.getSnapshot().ready,true);assert.equal(f.controller.getSnapshot().importRecoveryRequired,false);assert.equal(await f.journal.readRestoreRecovery("device"),undefined);assert.equal(f.reads.length,0);}finally{f.controller.dispose();}});
test("cold startup does not consume another owner's pending restore receipt",async()=>{const f=await fixture({foreign:true});try{const foreign=await f.journal.readRestoreRecovery("foreign");await f.controller.start();assert.deepEqual(await f.journal.readRestoreRecovery("foreign"),foreign);assert.equal(f.events.includes("camera-reset"),false);assert.equal(f.f.database.stores.preferences.has(f.cameraKey),true);}finally{f.controller.dispose();}});
