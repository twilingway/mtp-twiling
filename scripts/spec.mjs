import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const { dirname, join } = await import("node:path");
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packagePath = join(root, "node_modules/@fission-ai/openspec/package.json");
const { readFileSync } = await import("node:fs");
const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
const entry = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.openspec;
const result = spawnSync(
  process.execPath,
  [join(dirname(packagePath), entry), ...process.argv.slice(2)],
  { stdio: "inherit", windowsHide: true, env: { ...process.env, OPENSPEC_TELEMETRY: "0" } }
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
