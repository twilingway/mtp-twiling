import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader, config } from "./helpers/yandex-source.mjs";

const load = sourceLoader();
const { YandexScheduler } = load("services/yandex/coordinator-scheduler.ts");
const { YandexCoordinator } = load("services/yandex/coordinator.ts");

function fixture(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const scheduler = new YandexScheduler();
  const calls = [];
  let busy = false;
  const run = async () => { calls.push("run"); };
  const schedule = (dirty = true) => scheduler.schedule(run, () => busy, dirty);
  t.after(() => scheduler.clear());
  return { scheduler, calls, schedule, setBusy: value => { busy = value; } };
}

test("continuous dirty edits every 100ms flush at the original five-second deadline", t => {
  const f = fixture(t);
  f.schedule();
  for (let elapsed = 100; elapsed < 5000; elapsed += 100) {
    t.mock.timers.tick(100);
    f.schedule();
    assert.equal(f.calls.length, 0);
  }
  t.mock.timers.tick(99);
  assert.equal(f.calls.length, 0);
  t.mock.timers.tick(1);
  assert.equal(f.calls.length, 1);
  t.mock.timers.tick(5000);
  assert.equal(f.calls.length, 1, "the trailing timer must be cancelled after maximum flush");
});

test("a short edit burst waits 750ms after its final edit and cancels the maximum timer", t => {
  const f = fixture(t);
  f.schedule();
  t.mock.timers.tick(300);
  f.schedule();
  t.mock.timers.tick(749);
  assert.equal(f.calls.length, 0);
  t.mock.timers.tick(1);
  assert.equal(f.calls.length, 1);
  t.mock.timers.tick(5000);
  assert.equal(f.calls.length, 1);
});

test("a busy five-second deadline flushes immediately when the operation completes", t => {
  const f = fixture(t);
  f.setBusy(true);
  f.schedule();
  for (let elapsed = 100; elapsed < 5000; elapsed += 100) {
    t.mock.timers.tick(100);
    f.schedule();
  }
  t.mock.timers.tick(100);
  assert.equal(f.calls.length, 0);
  f.setBusy(false);
  f.scheduler.complete(f.schedule);
  assert.equal(f.calls.length, 1, "completion must not add another 750ms after the maximum wait");
  t.mock.timers.tick(5000);
  assert.equal(f.calls.length, 1);
});

test("a busy trailing debounce preserves the original maximum deadline", t => {
  const f = fixture(t);
  f.setBusy(true);
  f.schedule();
  t.mock.timers.tick(750);
  assert.equal(f.calls.length, 0);
  t.mock.timers.tick(4250);
  f.setBusy(false);
  f.scheduler.complete(f.schedule);
  assert.equal(f.calls.length, 1);
});

for (const elapsed of [300, 750, 5000]) {
  test(`clearing an authorization/scope cancels timers and deferred work at ${elapsed}ms`, t => {
    const f = fixture(t);
    f.setBusy(true);
    f.schedule();
    t.mock.timers.tick(elapsed);
    f.scheduler.clear();
    f.setBusy(false);
    let resumes = 0;
    f.scheduler.complete(() => { resumes++; f.schedule(); });
    t.mock.timers.tick(10000);
    assert.equal(resumes, 0);
    assert.equal(f.calls.length, 0);
    f.schedule();
    t.mock.timers.tick(750);
    assert.equal(f.calls.length, 1, "the next authorization can schedule normally");
  });
}

test("successive dirty bursts receive independent five-second budgets", t => {
  const f = fixture(t);
  f.schedule();
  t.mock.timers.tick(750);
  assert.equal(f.calls.length, 1);
  t.mock.timers.tick(1250);
  f.schedule();
  for (let elapsed = 100; elapsed < 5000; elapsed += 100) {
    t.mock.timers.tick(100);
    f.schedule();
    assert.equal(f.calls.length, 1);
  }
  t.mock.timers.tick(100);
  assert.equal(f.calls.length, 2);
  t.mock.timers.tick(5000);
  assert.equal(f.calls.length, 2);
});

test("coincident maximum and trailing deadlines run only once", t => {
  const f = fixture(t);
  f.schedule();
  for (let elapsed = 500; elapsed <= 4000; elapsed += 500) {
    t.mock.timers.tick(500);
    f.schedule();
  }
  t.mock.timers.tick(250);
  f.schedule();
  t.mock.timers.tick(750);
  assert.equal(f.calls.length, 1);
  t.mock.timers.tick(5000);
  assert.equal(f.calls.length, 1);
});

function coordinatorFixture(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  let revision = 0;
  const coordinator = new YandexCoordinator(
    { scope: () => ({ ready: true, blocked: false, revision }) },
    config,
    { journal: { snapshotAssociations: async () => new Map() } }
  );
  coordinator.status = { ...coordinator.status, prepared: true, enabled: true, automatic: true };
  coordinator.authorization = {};
  coordinator.run = async (selection, readOnly, automatic) => {
    calls.push({ selection, readOnly, automatic });
  };
  t.after(() => coordinator.scheduler.clear());
  return { coordinator, calls, edit: () => { revision++; coordinator.localChanged(); } };
}

test("coordinator resume preserves the five-second maximum across every user edit", t => {
  const f = coordinatorFixture(t);
  f.edit();
  for (let elapsed = 100; elapsed < 5000; elapsed += 100) {
    t.mock.timers.tick(100);
    f.edit();
  }
  assert.equal(f.calls.length, 0);
  t.mock.timers.tick(100);
  assert.deepEqual(f.calls, [{ selection: undefined, readOnly: false, automatic: true }]);
});

test("a clean coordinator inspection stays read-only and does not mark changes pending", t => {
  const f = coordinatorFixture(t);
  f.coordinator.resume();
  t.mock.timers.tick(749);
  assert.equal(f.calls.length, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(f.calls, [{ selection: undefined, readOnly: true, automatic: true }]);
  assert.notEqual(f.coordinator.getSnapshot().pendingChanges, true);
  t.mock.timers.tick(5000);
  assert.equal(f.calls.length, 1);
});
