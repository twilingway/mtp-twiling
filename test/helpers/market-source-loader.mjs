import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const root = fileURLToPath(new URL("../../src/", import.meta.url));
export function sourceLoader(overrides = {}) {
  const modules = new Map();
  return function load(relative) {
    const file = path.resolve(root, relative).replace(/\.js$/, ".ts");
    const key = path.relative(root, file).replaceAll("\\", "/");
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
      (spec) => load(path.relative(root, path.resolve(path.dirname(file), spec))),
      module,
      module.exports
    );
    return module.exports;
  };
}
