import test from "node:test";
import assert from "node:assert/strict";
import { flowModules } from "./helpers/workspace-identity-flow.mjs";

test("restore mode is owner-scoped, survives cold creation and only its own operation can clear it",async()=>{
  const records=new Map(),backend={
    get:async(_store,id)=>structuredClone(records.get(id)),
    put:async(_store,value)=>records.set(value.id,structuredClone(value)),
    transaction:async(_stores,action)=>{action({objectStore:()=>({
      get:id=>{const request={};queueMicrotask(()=>{request.result=structuredClone(records.get(id));request.onsuccess?.();});return request;},
      delete:id=>records.delete(id)
    })});await Promise.resolve();}
  };
  const load=()=>flowModules({"services/storage-db.ts":backend})("services/restore-recovery-journal.ts");
  const journal=load(), shared=await journal.beginRestoreRecovery("A",true);
  assert.equal(shared.mode,"shared-runtime");
  const cold=load();assert.deepEqual(await cold.beginRestoreRecovery("A"),shared);
  const other=await cold.beginRestoreRecovery("B");assert.equal(other.mode,"import");
  await cold.completeRestoreRecovery(other);
  assert.equal((await journal.beginRestoreRecovery("A")).operationId,shared.operationId);
  const newer=await cold.beginRestoreRecovery("A",false);
  await journal.completeRestoreRecovery(shared);
  assert.equal((await cold.beginRestoreRecovery("A")).operationId,newer.operationId);
  await cold.completeRestoreRecovery(newer);
  assert.equal(records.has("workspace-restore-recovery:A"),false);
  assert.equal((await cold.beginRestoreRecovery("A")).mode,"import");
});
