import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/yandex-source.mjs";
import { diskFixture } from "./helpers/yandex-disk.mjs";
const load = sourceLoader(),
  { runYandexRetentionProbe } = load("services/yandex/slot-proof.ts");

test("production retention probe proves move exclusion and conditional deletion and cleans only its files", async () => {
  const f = diskFixture(),
    foreign = `probe_${crypto.randomUUID()}.mtp`;
  f.files.set(foreign, new Blob(["untouched"]));
  const result = await runYandexRetentionProbe(f.auth, {
    fetch: f.fetcher,
    sleep: async () => {},
    timeoutMs: 100
  });
  assert.equal(result.completed, true);
  assert.equal(result.destinationExclusionVerified, true);
  assert.equal(result.conditionalDeleteVerified, true);
  assert.equal(result.cleanupVerified, true);
  assert.deepEqual([...f.files.keys()], [foreign]);
  const calls = f.calls.length;
  await runYandexRetentionProbe(f.auth, {
    fetch: f.fetcher,
    sleep: async () => {},
    timeoutMs: 100
  });
  assert.equal(f.calls.length, calls);
});

test("unsafe overwrite or unconditional delete never produces a capability receipt", async () => {
  for (const unsafe of ["move", "asyncMove", "delete"]) {
    const f = diskFixture(),
      fetcher = async (target, init) => {
        const url = new URL(target);
        if (unsafe === "delete" && init.method === "DELETE") {
          url.searchParams.delete("md5");
          return f.fetcher(url, init);
        }
        if (url.pathname.startsWith("/v1/disk/operations/"))
          return Response.json({ status: "success" });
        if (["move", "asyncMove"].includes(unsafe) && url.pathname.endsWith("/move")) {
          const from = url.searchParams.get("from").split("/").at(-1),
            to = url.searchParams.get("path").split("/").at(-1);
          f.files.set(to, f.files.get(from));
          f.files.delete(from);
          return unsafe === "asyncMove"
            ? Response.json(
                {
                  href: "https://cloud-api.yandex.net/v1/disk/operations/unsafe-probe",
                  method: "GET",
                  templated: false
                },
                { status: 202 }
              )
            : new Response(null, { status: 201 });
        }
        return f.fetcher(target, init);
      };
    await assert.rejects(
      runYandexRetentionProbe(f.auth, { fetch: fetcher, sleep: async () => {}, timeoutMs: 100 })
    );
  }
});

test("a transient 423 requires an exact loser retry that conclusively returns 409", async () => {
  const f = diskFixture();
  let moves = 0,
    firstDestination,
    firstLoser;
  const fetcher = async (target, init) => {
    const url = new URL(target);
    if (url.pathname.endsWith("/move")) {
      moves++;
      if (moves === 2) {
        firstDestination = url.searchParams.get("path");
        firstLoser = url.searchParams.get("from");
        return new Response(null, { status: 423 });
      }
      if (moves === 3) {
        assert.equal(url.searchParams.get("path"), firstDestination);
        assert.equal(url.searchParams.get("from"), firstLoser);
      }
    }
    return f.fetcher(target, init);
  };
  assert.equal(
    (
      await runYandexRetentionProbe(f.auth, {
        fetch: fetcher,
        sleep: async () => {},
        timeoutMs: 100
      })
    ).completed,
    true
  );
  assert.equal(moves, 3);
  assert.equal(f.files.size, 0);
});

test("a 202 winner is accepted only after successful operation polling and exact bytes", async () => {
  const f = diskFixture();
  let polls = 0;
  f.hooks.afterMove = () =>
    Response.json(
      {
        href: "https://cloud-api.yandex.net/v1/disk/operations/probe-202",
        method: "GET",
        templated: false
      },
      { status: 202 }
    );
  const fetcher = async (target, init) =>
    new URL(target).pathname.startsWith("/v1/disk/operations/")
      ? (polls++, Response.json({ status: "success" }))
      : f.fetcher(target, init);
  assert.equal(
    (
      await runYandexRetentionProbe(f.auth, {
        fetch: fetcher,
        sleep: async () => {},
        timeoutMs: 100
      })
    ).completed,
    true
  );
  assert.equal(polls, 1);
  assert.equal(f.files.size, 0);
});

test("a persistent 423 never substitutes for a conclusive exclusion response", async () => {
  const f = diskFixture();
  let moves = 0;
  const fetcher = async (target, init) => {
    if (new URL(target).pathname.endsWith("/move") && ++moves > 1)
      return new Response(null, { status: 423 });
    return f.fetcher(target, init);
  };
  await assert.rejects(
    runYandexRetentionProbe(f.auth, { fetch: fetcher, sleep: async () => {}, timeoutMs: 100 }),
    (error) => error.code === "permission"
  );
  assert.equal(moves, 5);
  assert.equal(f.files.size, 0);
});
