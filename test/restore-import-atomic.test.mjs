import test from "node:test";
import assert from "node:assert/strict";
import { createPortableFixture } from "./helpers/portable-database.mjs";

const backup = () => ({application:"personal-terminal",schemaVersion:2,drawings:[],images:[],views:[],watchlist:[],layout:{timeframe:"1h"}});
test("a committed ordinary import replaces a pending shared-refresh receipt inside the native commit",async()=>{
  const f=await createPortableFixture(),journal=f.load("services/restore-recovery-journal.ts"),v2=f.load("services/storage-v2.ts");
  const shared=await journal.beginRestoreRecovery("A",true);
  await v2.importBackup("A",backup());
  const pending=await journal.beginRestoreRecovery("A");
  assert.equal(pending.mode,"import");
  assert.notEqual(pending.operationId,shared.operationId);
  assert.equal(pending.owner,"A");
  const raw=f.database.stores.preferences.get("workspace-restore-recovery:A").value;
  assert.equal(raw.nativeImportId,pending.operationId);assert.equal(raw.storageOwner,"profile-v2:A");
  assert.equal((await v2.loadPreferences("A")).timeframe,"1h");
});

function controllerBridge(f, hooks={}){
  const state={owner:"A",name:"A",chartRevision:0},chart={getView:()=>undefined};
  const bridge={getState:()=>state,getClient:()=>null,getChart:()=>chart,saveView:async()=>{},
    editing:{flush:async()=>{},reset(){}},session:{matches:()=>true,prepareProfile:async()=>{await hooks.prepare?.();},applyBankState(){}},
    resetHistory(){},update:patch=>Object.assign(state,patch),loadHistory:async()=>{await hooks.history?.();},notify(){},
    flush:async()=>{},isAlive:()=>true};
  const {TerminalBackups}=f.load("screens/terminal/controller-backups.ts");
  return {bridge,state,queue:()=>new TerminalBackups(bridge)};
}
async function failedShared(f){
  const hooks={history:async()=>{throw new Error("shared refresh failed");}},runtime=controllerBridge(f,hooks);
  const cameraKey="chart-camera:profile-v2:A:kline",camera={id:cameraKey,owner:"profile-v2:A",value:{symbol:"SBER",camera:{barSpace:21,rightOffsetBars:4}}};
  await f.storageDB.put("preferences",camera);
  await assert.rejects(runtime.queue().recover(true));
  hooks.history=async()=>{};
  assert.equal(f.database.stores.preferences.get("workspace-restore-recovery:A").value.mode,"shared-runtime");
  return {...runtime,hooks,cameraKey,camera};
}

for(const failure of ["onCommitted-throw","postcommit-guard","postcommit-receipt-quota"]){
  test(`committed file import supersedes failed shared refresh before ${failure}, including cold default retry`,async()=>{
    const f=await createPortableFixture(),runtime=await failedShared(f);
    let valid=true,committed=0,standalonePuts=0,afterCommit=false;
    const put=f.storageDB.put;
    f.storageDB.put=async(store,value)=>{
      if(afterCommit&&value.id?.startsWith("workspace-restore-recovery:")){standalonePuts++;throw new Error("receipt quota");}
      return put(store,value);
    };
    if(failure==="postcommit-receipt-quota")runtime.hooks.prepare=async()=>{if(afterCommit)throw new Error("restore failed after commit");};
    const {importTerminalBackup}=f.load("screens/terminal/controller-import.ts");
    await assert.rejects(importTerminalBackup(backup(),runtime.bridge,{valid:()=>valid,onCommitted:()=>{
      committed++;afterCommit=true;if(failure==="onCommitted-throw")throw new Error("commit callback failed");
      if(failure==="postcommit-guard")valid=false;
    }}));
    assert.equal(committed,1);assert.equal(standalonePuts,0,"native commit leaves no separate receipt PUT to fail");
    const raw=f.database.stores.preferences.get("workspace-restore-recovery:A").value;
    assert.equal(raw.mode,"import");assert.equal(raw.nativeImportId,raw.operationId);
    assert.equal(raw.storageOwner,"profile-v2:A");
    assert.equal((await f.load("services/storage-v2.ts").loadPreferences("A")).timeframe,"1h");
    valid=true;runtime.hooks.prepare=async()=>{};
    const cold=controllerBridge(f);await cold.queue().recover();
    assert.equal(f.database.stores.preferences.has(runtime.cameraKey),false);
    assert.equal(f.database.stores.preferences.has("workspace-restore-recovery:A"),false);
    assert.equal(cold.state.importRecoveryRequired,false);assert.equal(standalonePuts,0);
  });
}
for(const writeFailure of [1,2]){
  test(`failed native import rolls back content and recovery mode together (write ${writeFailure})`,async()=>{
    const f=await createPortableFixture(),runtime=await failedShared(f),v2=f.load("services/storage-v2.ts");
    await v2.prepareProfileV2("A");await v2.savePreferences("A",{timeframe:"1d"});
    const before=structuredClone(f.database.stores.preferences.get("workspace-restore-recovery:A"));
    let puts=0;
    f.database.hooks.beforeWriteComplete=async(_tx,name,kind)=>{if(name==="preferences"&&kind==="put"&&++puts===writeFailure)throw new Error("native write failed");};
    const {importTerminalBackup}=f.load("screens/terminal/controller-import.ts");
    await assert.rejects(importTerminalBackup(backup(),runtime.bridge));
    f.database.hooks.beforeWriteComplete=undefined;
    assert.deepEqual(f.database.stores.preferences.get("workspace-restore-recovery:A"),before);
    assert.equal((await v2.loadPreferences("A")).timeframe,"1d");
    await controllerBridge(f).queue().recover();
    assert.deepEqual(f.database.stores.preferences.get(runtime.cameraKey),runtime.camera);
  });
}
