import test from "node:test";
import assert from "node:assert/strict";
import { flowModules } from "./helpers/workspace-identity-flow.mjs";

test("opening association snapshot reads only association values, without auth values or writes", async()=>{
  const clientId="a".repeat(32), association={version:1,accountId:"123",heads:[],digest:"a".repeat(64),syncedAt:"2026-11-28T10:00:00Z"};
  const records=new Map([
    [`mtp:yandex:device:${clientId}:123:association`,{value:association}],
    ["mtp:yandex:device:settings",{value:{enabled:true}}],
    ["mtp:yandex:device:authorization",{value:"must-not-read"}],
    [`mtp:yandex:device:${"b".repeat(32)}:456:association`,{value:"other-application"}]
  ]), reads=[];
  const database={transaction(name,mode){
    assert.equal(name,"vault");assert.equal(mode,"readonly");
    const tx={objectStore(){return {
      openKeyCursor(){const request={};let index=0;const keys=[...records.keys()];
        const next=()=>queueMicrotask(()=>{request.result=index<keys.length?{key:keys[index++],continue:next}:null;request.onsuccess?.();if(!request.result)queueMicrotask(()=>tx.oncomplete?.());});next();return request;},
      get(key){reads.push(key);const request={};queueMicrotask(()=>{request.result=records.get(key);request.onsuccess?.();});return request;}
    };}};return tx;
  }};
  const load=flowModules({"services/storage-db.ts":{db:database},"services/storage.ts":{deviceKey:async()=>{throw new Error("key not requested");}}});
  const backend=await load("services/yandex/local.ts").yandexLocalStore();
  const snapshot=await backend.readAssociations(clientId);
  assert.deepEqual(snapshot,[{accountId:"123",value:association}]);
  assert.deepEqual(reads,[`mtp:yandex:device:${clientId}:123:association`]);
});
