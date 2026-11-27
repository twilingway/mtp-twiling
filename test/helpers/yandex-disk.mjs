import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sourceLoader, authorization } from "./yandex-source.mjs";
const load = sourceLoader(),
  { YandexTransport } = load("services/yandex/transport.ts");
const name = `${crypto.randomUUID()}_${crypto.randomUUID()}.mtp`;
export const metadata = (body, itemName = name) => ({
  name: itemName,
  size: body.size,
  type: "file",
  modified: "2026-11-27T12:00:00Z",
  md5: "a".repeat(32)
});
export function diskFixture() {
  const files = new Map(),
    calls = [];
  let puts = 0;
  const hooks = {};
  const itemMetadata = async (body, itemName) => ({
    ...metadata(body, itemName),
    md5: createHash("md5")
      .update(Buffer.from(await body.arrayBuffer()))
      .digest("hex")
  });
  const fetcher = async (target, init) => {
    const url = new URL(target);
    calls.push({ url, init });
    await hooks.before?.(url, init);
    if (url.hostname.startsWith("uploader")) {
      if (!/^probe_(?:slot|stage)_/.test(url.searchParams.get("name"))) puts++;
      assert.equal(new Headers(init.headers).has("Authorization"), false);
      files.set(url.searchParams.get("name"), init.body);
      if (hooks.afterPut) return hooks.afterPut();
      return new Response(null, { status: 201 });
    }
    if (url.hostname.startsWith("downloader"))
      return new Response(files.get(url.searchParams.get("name")));
    assert.equal(new Headers(init.headers).get("Authorization"), "OAuth unit-yandex-access");
    const itemName = url.searchParams.get("path")?.split("/").at(-1);
    if (url.pathname.endsWith("/move")) {
      const from = url.searchParams.get("from").split("/").at(-1);
      assert.equal(url.searchParams.get("overwrite"), "false");
      if (!files.has(from)) return new Response(null, { status: 404 });
      if (files.has(itemName)) return new Response(null, { status: 409 });
      files.set(itemName, files.get(from));
      files.delete(from);
      if (hooks.afterMove) return hooks.afterMove(itemName);
      return Response.json(
        {
          href: `https://cloud-api.yandex.net/v1/disk/resources?path=${itemName}`,
          method: "GET",
          templated: false
        },
        { status: 201 }
      );
    }
    if (url.pathname.endsWith("/download"))
      return Response.json({
        href: `https://downloader.dst.yandex.ru/disk/?name=${itemName}`,
        method: "GET",
        templated: false
      });
    if (url.pathname.endsWith("/upload")) {
      assert.equal(url.searchParams.get("overwrite"), "false");
      return Response.json({
        href: `https://uploader1d.dst.yandex.net/upload-target/?name=${itemName}`,
        method: "PUT",
        templated: false
      });
    }
    if (init.method === "PUT") return new Response(null, { status: 201 });
    if (init.method === "DELETE") {
      if (
        /^(?:probe_)?(?:slot|stage)_/.test(itemName) &&
        files.has(itemName) &&
        url.searchParams.get("md5") &&
        url.searchParams.get("md5") !== (await itemMetadata(files.get(itemName), itemName)).md5
      )
        return new Response(null, { status: 412 });
      files.delete(itemName);
      return new Response(null, { status: 204 });
    }
    if (url.searchParams.has("limit")) {
      return Response.json({
        _embedded: {
          total: files.size,
          items: await Promise.all([...files].map(([name, body]) => itemMetadata(body, name)))
        }
      });
    }
    return files.has(itemName)
      ? Response.json(await itemMetadata(files.get(itemName), itemName))
      : new Response(null, { status: 404 });
  };
  const auth = authorization(),
    transport = new YandexTransport(auth, { fetch: fetcher, sleep: async () => {}, timeoutMs: 30 });
  return { files, calls, hooks, transport, auth, fetcher, puts: () => puts };
}
