import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// The source-only worktree has no generated version. Supply only its two string types in memory.
const root = fileURLToPath(new URL("../", import.meta.url));
const virtualFile = path.join(root, "src/generated/app-version.ts");
const virtualDirectory = path.dirname(virtualFile);
const declaration =
  "export declare const APP_VERSION: string; export declare const BUILD_ID: string;";
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const configFile = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
if (configFile.error)
  throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root, { noEmit: true });
const host = ts.createCompilerHost(config.options);
const originalExists = host.fileExists.bind(host),
  originalRead = host.readFile.bind(host),
  originalSource = host.getSourceFile.bind(host),
  originalDirectory = host.directoryExists.bind(host);
host.fileExists = (file) => same(file, virtualFile) || originalExists(file);
host.readFile = (file) => (same(file, virtualFile) ? declaration : originalRead(file));
host.directoryExists = (directory) =>
  same(directory, virtualDirectory) || originalDirectory(directory);
host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) =>
  same(file, virtualFile)
    ? ts.createSourceFile(file, declaration, languageVersion, true)
    : originalSource(file, languageVersion, onError, shouldCreateNewSourceFile);
const program = ts.createProgram([...config.fileNames, virtualFile], config.options, host);
const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) {
  process.stderr.write(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => root,
      getCanonicalFileName: (n) => n,
      getNewLine: () => "\n"
    })
  );
  process.exitCode = 1;
} else
  process.stdout.write(
    "Full source TypeScript noEmit passed; version strings supplied only in-memory.\n"
  );
