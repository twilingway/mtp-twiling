import test from "node:test";
import assert from "node:assert/strict";
import { sourceLoader } from "./helpers/yandex-source.mjs";
import { diskFixture } from "./helpers/yandex-disk.mjs";
const load = sourceLoader(),
  { YandexTransport } = load("services/yandex/transport.ts"),
  { slotName, stageName } = load("services/yandex/slot-model.ts"),
  { sha256 } = load("services/yandex/types.ts");
for (const finish of [true, false])
  test(`move202 ${finish ? "waits for success and exact readback" : "stays indeterminate even while destination bytes are visible"}`, async () => {
    const f = diskFixture(),
      stage = stageName(crypto.randomUUID()),
      destination = slotName(crypto.randomUUID(), 1),
      body = new Blob(["verified binary"]),
      reference = { size: body.size, sha256: await sha256(body) };
    let polls = 0;
    const fetcher = async (target, init) =>
        new URL(target).pathname.startsWith("/v1/disk/operations/")
          ? Response.json({ status: finish && ++polls > 1 ? "success" : "in-progress" })
          : f.fetcher(target, init),
      transport = new YandexTransport(f.auth, {
        fetch: fetcher,
        sleep: async () => {},
        timeoutMs: 100
      });
    await transport.putImmutable(stage, body, reference);
    f.hooks.afterMove = () =>
      Response.json(
        {
          href: "https://cloud-api.yandex.net/v1/disk/operations/slot-probe",
          method: "GET",
          templated: false
        },
        { status: 202 }
      );
    if (finish)
      assert.equal(
        (await transport.moveImmutable(stage, destination, reference)).name,
        destination
      );
    else
      await assert.rejects(
        transport.moveImmutable(stage, destination, reference),
        (e) => e.code === "indeterminate"
      );
  });
test("conditional deletion refuses a changed file and cannot target legacy backups", async () => {
  const f = diskFixture(),
    name = stageName(crypto.randomUUID()),
    body = new Blob(["first"]),
    file = await f.transport.putImmutable(name, body, {
      size: body.size,
      sha256: await sha256(body)
    });
  f.files.set(name, new Blob(["changed"]));
  await assert.rejects(f.transport.removeExact(file), (e) => e.code === "conflict");
  assert.equal(await f.files.get(name).text(), "changed");
  await assert.rejects(
    f.transport.removeExact({ ...file, name: `${crypto.randomUUID()}_${crypto.randomUUID()}.mtp` }),
    (e) => e.code === "permission"
  );
});
