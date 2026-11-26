import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
export function loadRelativeSource(file = "index") {
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const module = { exports: {} };
    cache.set(path, module);
    const code = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS }
    }).outputText;
    const nativeRequire = createRequire(path);
    const localRequire = (name) =>
      name.startsWith(".")
        ? load(resolve(dirname(path), name.replace(/\.js$/, ".ts")))
        : nativeRequire(name);
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: path })(
      localRequire,
      module,
      module.exports
    );
    return module.exports;
  }
  return load(resolve(root, `src/model/technical-indicators/relative-oscillators/${file}.ts`));
}
