import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const entry = resolve(root, "src/model/technical-indicators/channel-average/index.ts");
const config = ts.readConfigFile(resolve(root, "tsconfig.json"), ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);

export function checkChannelAverageSource(wholeProject = false) {
  const host = ts.createCompilerHost(parsed.options);
  const generated = resolve(root, "src/generated/app-version.ts");
  const virtual = !existsSync(generated);
  const virtualText =
    'export const APP_VERSION: string = "source-check";\nexport const BUILD_ID: string = "source-check";\n';
  const originalRead = host.readFile.bind(host);
  const originalExists = host.fileExists.bind(host);
  const originalDirectory = host.directoryExists.bind(host);
  const originalSource = host.getSourceFile.bind(host);
  const isVirtual = (path) => virtual && resolve(path) === generated;
  host.readFile = (path) => (isVirtual(path) ? virtualText : originalRead(path));
  host.fileExists = (path) => isVirtual(path) || originalExists(path);
  host.directoryExists = (path) =>
    (virtual && resolve(path) === dirname(generated)) || originalDirectory(path);
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    isVirtual(path)
      ? ts.createSourceFile(path, virtualText, languageVersion, true)
      : originalSource(path, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram(wholeProject ? parsed.fileNames : [entry], parsed.options, host);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length)
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCurrentDirectory: () => root,
        getCanonicalFileName: (path) => path,
        getNewLine: () => "\n"
      })
    );
  return program;
}

export function loadChannelAverageSource() {
  checkChannelAverageSource();
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
  return load(entry);
}

if (process.argv.includes("--typecheck")) {
  checkChannelAverageSource(true);
  console.log("Strict whole-project source check passed; virtual version module only when absent.");
}
