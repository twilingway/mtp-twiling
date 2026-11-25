import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../../src/services/providers/bybit/", import.meta.url));
const cache = new Map();
export function loadBybit(file = "index.ts") {
  const filename = resolve(root, file).replace(/\.js$/, ".ts");
  assert.ok(filename.startsWith(root));
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const output = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  new vm.Script(`(function(require,module,exports){${output}\n})`, { filename }).runInThisContext()(
    (specifier) => {
      assert.ok(specifier.startsWith("."));
      return loadBybit(resolve(dirname(filename), specifier));
    },
    module,
    module.exports
  );
  return module.exports;
}
