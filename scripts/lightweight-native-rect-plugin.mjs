import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { basename, join } from "node:path";

const version = "5.0.9";
const hashes = Object.freeze({
  development: "dec157fcccf103e2d152cce52b29204a66ab3a7df713af4132e6bb70e22233b9",
  production: "896dc39fa159ad981cae3580aacd064dc81bb3e808c8122afc3293e526a454d9"
});

function replaceOnce(source, before, after) {
  if (source.indexOf(before) === -1 || source.indexOf(before) !== source.lastIndexOf(before))
    throw new Error("Lightweight native rect: expected one pinned renderer anchor");
  return source.replace(before, after);
}

/** The original method body is retained verbatim; the hook receives its bound invocation. */
function wrapper(renderer, method, data, spacing) {
  return `
/* MTP build modification: opt-in native candle rect hook, Apache-2.0 SDK unchanged on disk. */
const mtpNativeRectOriginal = ${renderer}.prototype.${method};
${renderer}.prototype.${method} = function(scope) {
  const data = this.${data};
  const spacing = data?.${spacing};
  const hook = data?.mtpNativeRectCull;
  if (typeof hook === "function" && Number.isFinite(spacing) && spacing > 0) {
    const runNative = (context) => mtpNativeRectOriginal.call(this, { ...scope, context });
    if (hook(scope, runNative, spacing) === true) return;
  }
  return mtpNativeRectOriginal.call(this, scope);
};
`;
}

export function transformLightweightNativeRect(source, mode, sdkVersion = version) {
  if (sdkVersion !== version || !Object.hasOwn(hashes, mode))
    throw new Error(`Lightweight native rect: unsupported SDK ${sdkVersion}/${mode}`);
  const digest = createHash("sha256").update(source).digest("hex");
  if (digest !== hashes[mode])
    throw new Error(`Lightweight native rect: ${version}/${mode} SHA256 mismatch`);
  if (mode === "development") {
    source = replaceOnce(
      source,
      "_internal_wickVisible: candlestickStyleProps.wickVisible,",
      "mtpNativeRectCull: candlestickStyleProps.mtpNativeRectCull,\n            _internal_wickVisible: candlestickStyleProps.wickVisible,"
    );
    return replaceOnce(
      source,
      "class SeriesCandlesticksPaneView extends BarsPaneViewBase {",
      wrapper(
        "PaneRendererCandlesticks",
        "_internal__drawImpl",
        "_private__data",
        "_internal_barSpacing"
      ) + "class SeriesCandlesticksPaneView extends BarsPaneViewBase {"
    );
  }
  source = replaceOnce(
    source,
    "BM:t.wickVisible,Mi:t.borderVisible,lt:this.hg",
    "mtpNativeRectCull:t.mtpNativeRectCull,BM:t.wickVisible,Mi:t.borderVisible,lt:this.hg"
  );
  return replaceOnce(
    source,
    "class Ce extends Me{",
    wrapper("xe", "et", "Yt", "mu") + "class Ce extends Me{"
  );
}

/** Fail closed on both package entrypoints, including when only one is imported by a build. */
export function lightweightNativeRectPlugin(root) {
  const directory = join(root, "node_modules", "lightweight-charts");
  const packageFile = join(directory, "package.json");
  return {
    name: "mtp-lightweight-native-rect",
    setup(build) {
      let snapshots = new Map();
      build.onStart(async () => {
        snapshots = new Map();
        const metadata = JSON.parse(await readFile(packageFile, "utf8"));
        if (metadata.name !== "lightweight-charts" || metadata.version !== version)
          throw new Error(`Lightweight native rect: expected lightweight-charts ${version}`);
        for (const mode of Object.keys(hashes)) {
          const path = join(directory, "dist", `lightweight-charts.${mode}.mjs`);
          const source = await readFile(path, "utf8");
          snapshots.set(await realpath(path), {
            contents: transformLightweightNativeRect(source, mode, metadata.version),
            path
          });
        }
      });
      build.onLoad({ filter: /[\\/]lightweight-charts[\\/]dist[\\/]/ }, async (args) => {
        const snapshot = snapshots.get(await realpath(args.path));
        if (!snapshot)
          throw new Error(
            `Lightweight native rect: unsupported SDK entrypoint ${basename(args.path)}`
          );
        return {
          contents: snapshot.contents,
          loader: "js",
          watchFiles: [packageFile, ...[...snapshots.values()].map((entry) => entry.path)]
        };
      });
    }
  };
}
