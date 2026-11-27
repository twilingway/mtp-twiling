import test from "node:test";
import assert from "node:assert/strict";
import { flowModules } from "./helpers/workspace-identity-flow.mjs";

test("opening settings mid-transfer retains the original registry start time and confirmed duration", () => {
  const { recordCloudOperation, cloudOperationTiming } = flowModules()(
    "screens/terminal/cloud-operation-clock.ts"
  );
  const state = { phase: "syncing" },
    provider = { getSnapshot: () => state };
  recordCloudOperation(provider, 1000);
  recordCloudOperation(provider, 2500);
  assert.deepEqual(cloudOperationTiming(provider), { startedAt: 1000 });
  state.phase = "idle";
  recordCloudOperation(provider, 4000);
  assert.deepEqual(cloudOperationTiming(provider), { elapsedMs: 3000 });
  recordCloudOperation(provider, 9000);
  assert.deepEqual(cloudOperationTiming(provider), { elapsedMs: 3000 });
});

test("a retry gets its own clock and failure ends the attempt without claiming success", () => {
  const { recordCloudOperation, cloudOperationTiming } = flowModules()(
    "screens/terminal/cloud-operation-clock.ts"
  );
  const state = { phase: "connecting" },
    provider = { getSnapshot: () => state };
  recordCloudOperation(provider, 1000);
  state.phase = "error";
  recordCloudOperation(provider, 1600);
  assert.deepEqual(cloudOperationTiming(provider), { elapsedMs: 600 });
  state.phase = "syncing";
  recordCloudOperation(provider, 2000);
  assert.deepEqual(cloudOperationTiming(provider), { startedAt: 2000 });
  state.phase = "disabled";
  recordCloudOperation(provider, 2400);
  assert.deepEqual(cloudOperationTiming(provider), { elapsedMs: 400 });
});
