import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../../src/", import.meta.url));
export function sourceLoader() {
  const modules = new Map();
  function load(relative) {
    const file = path.resolve(root, relative).replace(/\.js$/, ".ts");
    if (!file.startsWith(root)) throw new Error("Source outside workspace");
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
      (specifier) => load(path.relative(root, path.resolve(path.dirname(file), specifier))),
      module,
      module.exports
    );
    return module.exports;
  }
  return load;
}
export const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
export async function localBackend() {
  const records = new Map(),
    key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt"
    ]);
  return {
    records,
    key: async () => key,
    read: async (id) => structuredClone(records.get(id)),
    write: async (id, value, signal) => {
      signal.throwIfAborted();
      records.set(id, structuredClone(value));
    },
    remove: async (id, signal, generation) => {
      signal?.throwIfAborted();
      if (!generation || records.get(id)?.generation === generation) records.delete(id);
    }
  };
}
export function authorization(accountId = "123", generation = "credential-one") {
  const controller = new AbortController();
  return {
    connectionId: crypto.randomUUID(),
    credentialGeneration: generation,
    accountId,
    signal: controller.signal,
    stored: true,
    persistenceError: false,
    getAccessToken() {
      controller.signal.throwIfAborted();
      return "unit-yandex-access";
    },
    invalidate() {
      controller.abort();
    },
    controller
  };
}
export const config = {
  clientId: "5eb8206c526a4c5593716703d091fa8d",
  redirectUri: "http://localhost:5290/__dev/app/yandex-callback.html"
};
