import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { lightweightNativeRectPlugin } from "./lightweight-native-rect-plugin.mjs";

export const installEntryPoints = { "pwa-install-entry": "src/pwa-install-entry.ts" };
export const browserEntryPoints = {
  "app-entry": "src/main.tsx",
  "history-codec": "src/model/history-codec.ts",
  "market-model": "src/model/market-model.ts",
  mtp: "src/model/mtp.ts",
  "mtp-raster-worker": "src/model/mtp-raster-worker.ts",
  "drawing-model": "src/model/drawing-model.ts",
  "backup-format": "src/model/backup-format.ts"
};

export function browserBuildOptions(root, outdir) {
  return {
    absWorkingDir: root,
    bundle: true,
    platform: "browser",
    target: "es2023",
    outdir,
    metafile: true,
    minify: true,
    legalComments: "eof",
    plugins: [lightweightNativeRectPlugin(root)]
  };
}

export async function copyBrowserLicenses(root, outdir) {
  await mkdir(join(outdir, "licenses"), { recursive: true });
  for (const [dependency, files] of [
    ["lightweight-charts", ["LICENSE", "NOTICE"]],
    ["klinecharts", ["LICENSE", "NOTICE"]],
    ["react", ["LICENSE"]],
    ["react-dom", ["LICENSE"]]
  ])
    for (const file of files) {
      try {
        await copyFile(
          join(root, "node_modules", dependency, file),
          join(outdir, "licenses", dependency + "-" + file + ".txt")
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
}
