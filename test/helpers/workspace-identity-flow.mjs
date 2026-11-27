import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const root = fileURLToPath(new URL("../../src/", import.meta.url));
export function flowModules(overrides = {}) {
  const modules = new Map();
  const window = new EventTarget();
  function load(relative) {
    const file = path.resolve(root, relative).replace(/\.js$/, ".ts");
    const key = path.relative(root, file).replaceAll(path.sep, "/");
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    vm.runInThisContext(`(function(require,module,exports,window){${code}\n})`, { filename: file })(
      (specifier) => load(path.relative(root, path.resolve(path.dirname(file), specifier))),
      module,
      module.exports,
      window
    );
    return module.exports;
  }
  return load;
}
export const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
export const tick = () => new Promise((resolve) => setImmediate(resolve));
