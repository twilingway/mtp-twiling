import { mkdir, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "public", "vendor");
await mkdir(output, { recursive: true });
await Promise.all(
  [
    [
      "lightweight-charts/dist/lightweight-charts.standalone.production.js",
      "lightweight-charts.js"
    ],
    ["klinecharts/dist/umd/klinecharts.min.js", "klinecharts.js"],
    ["lightweight-charts/LICENSE", "lightweight-charts.LICENSE"],
    ["klinecharts/LICENSE", "klinecharts.LICENSE"],
    ["klinecharts/NOTICE", "klinecharts.NOTICE"]
  ].map(([input, name]) => copyFile(join(root, "node_modules", input), join(output, name)))
);
console.log("Локальные библиотеки графиков подготовлены.");
