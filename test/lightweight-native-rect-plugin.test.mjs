import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { sourceLoader } from "./helpers/market-source-loader.mjs";
import { browserBuildOptions } from "../scripts/browser-build-config.mjs";
import {
  lightweightNativeRectPlugin,
  transformLightweightNativeRect
} from "../scripts/lightweight-native-rect-plugin.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sdk = join(root, "node_modules", "lightweight-charts");
const modes = {
  development: {
    renderer: "PaneRendererCandlesticks",
    view: "SeriesCandlesticksPaneView",
    method: "_internal__drawImpl",
    setData: "_internal_setData",
    prepare: "_internal__prepareRendererData",
    data: (spacing) => ({
      _internal_bars: [
        {
          _internal_x: 5,
          _internal_openY: 8,
          _internal_closeY: 12,
          _internal_highY: 3,
          _internal_lowY: 17,
          _internal_barColor: "#112233",
          _internal_barBorderColor: "#445566",
          _internal_barWickColor: "#778899"
        }
      ],
      _internal_visibleRange: { from: 0, to: 1 },
      _internal_barSpacing: spacing,
      _internal_wickVisible: true,
      _internal_borderVisible: true
    }),
    prepareThis: (options, receive) => ({
      _internal__series: { _internal_options: () => options },
      _internal__renderer: { _internal_setData: receive },
      _internal__model: { _internal_timeScale: () => ({ _internal_barSpacing: () => 0.25 }) },
      _internal__items: [],
      _internal__itemsVisibleRange: { from: 0, to: 0 }
    })
  },
  production: {
    renderer: "xe",
    view: "Ce",
    method: "et",
    setData: "ht",
    prepare: "pg",
    data: (spacing) => ({
      Xs: [{ _t: 5, Yl: 8, Xl: 12, jl: 3, Kl: 17, cr: "#112233", dr: "#445566", pr: "#778899" }],
      lt: { from: 0, to: 1 },
      mu: spacing,
      BM: true,
      Mi: true
    }),
    prepareThis: (options, receive) => ({
      Jn: { N: () => options },
      og: { ht: receive },
      Qn: { Et: () => ({ mu: () => 0.25 }) },
      rg: [],
      hg: { from: 0, to: 0 }
    })
  }
};

function recordingContext() {
  const commands = [];
  let style = "#000000";
  return {
    commands,
    get fillStyle() {
      return style;
    },
    set fillStyle(value) {
      style = value;
      commands.push(["fillStyle", value]);
    },
    fillRect(...args) {
      commands.push(["fillRect", ...args]);
    }
  };
}

async function loadRenderer(source, names, minify) {
  const result = await build({
    stdin: {
      contents: `${source}\nexport { ${names.renderer} as TestRenderer, ${names.view} as TestView };`,
      resolveDir: join(sdk, "dist"),
      sourcefile: "pinned-sdk-renderer.mjs"
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    minify,
    legalComments: "eof",
    logLevel: "silent"
  });
  const module = { exports: {} };
  runInNewContext(result.outputFiles[0].text, { module, exports: module.exports });
  return { ...module.exports, output: result.outputFiles[0].text };
}

for (const [mode, names] of Object.entries(modes)) {
  test(`${mode}: native geometry, this, scope and fallback survive the opt-in hook and minification`, async () => {
    const path = join(sdk, "dist", `lightweight-charts.${mode}.mjs`);
    const original = await readFile(path, "utf8");
    const transformed = transformLightweightNativeRect(original, mode);
    assert.equal(
      transformed.slice(0, original.indexOf("*/") + 2),
      original.slice(0, original.indexOf("*/") + 2)
    );
    const native = await loadRenderer(original, names, false);
    const candidate = await loadRenderer(transformed, names, true);
    assert.match(candidate.output, /mtpNativeRectCull/);
    assert.match(candidate.output, /TradingView Lightweight Charts/);
    const scope = (context) => ({
      context,
      bitmapSize: { width: 40, height: 40 },
      horizontalPixelRatio: 2.75,
      verticalPixelRatio: 2.75
    });
    function draw(Renderer, spacing, hook, target = recordingContext()) {
      const renderer = new Renderer();
      renderer[names.setData]({ ...names.data(spacing), ...(hook && { mtpNativeRectCull: hook }) });
      renderer[names.method](scope(target));
      return target.commands;
    }
    for (const spacing of [0.1, 0.999, 1, 1.001, 10]) {
      const expected = draw(native.TestRenderer, spacing);
      assert.deepEqual(draw(candidate.TestRenderer, spacing), expected);
      let calls = 0;
      assert.deepEqual(
        draw(candidate.TestRenderer, spacing, () => {
          calls++;
          return false;
        }),
        expected
      );
      assert.equal(calls, 1);
      if (spacing < 1) {
        const proxy = recordingContext();
        let captured;
        const actual = draw(
          candidate.TestRenderer,
          spacing,
          (originalScope, runNative, actualSpacing) => {
            assert.equal(actualSpacing, spacing);
            assert.equal(originalScope.horizontalPixelRatio, 2.75);
            captured = originalScope.context;
            runNative(proxy);
            return true;
          }
        );
        assert.deepEqual(actual, []);
        assert.equal(captured.commands, actual);
        assert.deepEqual(proxy.commands, expected);
        assert.ok(expected.some(([operation]) => operation === "fillRect"));
      }
    }
    let forwarded;
    const hook = () => false;
    candidate.TestView.prototype[names.prepare].call(
      names.prepareThis(
        { wickVisible: true, borderVisible: false, mtpNativeRectCull: hook },
        (data) => {
          forwarded = data;
        }
      )
    );
    assert.equal(forwarded.mtpNativeRectCull, hook);
    const { OpaqueRectCuller, OpaqueRectUnsupportedError } = sourceLoader()(
      "model/opaque-rect-culler.ts"
    );
    const instances = [];
    class TrackedCore extends OpaqueRectCuller {
      constructor(width, height) {
        super(width, height);
        instances.push(this);
      }
    }
    const { createLightweightNativeRectCull } = sourceLoader({
      "model/opaque-rect-culler.ts": {
        OpaqueRectCuller: TrackedCore,
        OpaqueRectUnsupportedError
      }
    })("charts/lightweight-native-rect-cull.ts");
    const bridge = createLightweightNativeRectCull();
    const context = () =>
      Object.assign(recordingContext(), {
        canvas: { width: 40, height: 40 },
        globalAlpha: 1,
        globalCompositeOperation: "source-over",
        filter: "none",
        shadowBlur: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        shadowColor: "rgba(0,0,0,0)",
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        getContextAttributes: () => ({ colorSpace: "srgb", colorType: "unorm8" })
      });
    const handled = [];
    const realHook = (...args) => {
      const result = bridge.hook(...args);
      handled.push(result);
      return result;
    };
    for (const spacing of [0.5, 1, 1.001, 10]) {
      draw(candidate.TestRenderer, 0.1, realHook, context());
      assert.equal(handled.at(-1), true);
      const denseCore = instances.at(-1);
      assert.ok(denseCore.memoryBytes > 0);
      const count = instances.length;
      assert.deepEqual(
        draw(candidate.TestRenderer, spacing, realHook, context()),
        draw(native.TestRenderer, spacing, undefined, context())
      );
      assert.equal(handled.at(-1), false);
      assert.equal(denseCore.memoryBytes, 0, "ordinary SDK draw releases the actual bridge core");
      assert.equal(instances.length, count, "ordinary SDK draw must not allocate a new core");
    }
    bridge.dispose();
    assert.equal(await readFile(path, "utf8"), original);
  });
}

test("source guards reject drift, unknown version and unsupported entrypoint mode", async () => {
  for (const mode of Object.keys(modes)) {
    const source = await readFile(join(sdk, "dist", `lightweight-charts.${mode}.mjs`), "utf8");
    assert.throws(() => transformLightweightNativeRect(source + "\n", mode), /SHA256 mismatch/);
    assert.throws(() => transformLightweightNativeRect(source, mode, "5.0.10"), /unsupported SDK/);
  }
  assert.throws(() => transformLightweightNativeRect("", "standalone"), /unsupported SDK/);
});

test("real esbuild onLoad covers dev and default production imports without modifying SDK files", async () => {
  const paths = [
    "package.json",
    ...Object.keys(modes).map((mode) => `dist/lightweight-charts.${mode}.mjs`)
  ];
  const digest = async () =>
    Promise.all(
      paths.map(async (path) =>
        createHash("sha256")
          .update(await readFile(join(sdk, path)))
          .digest("hex")
      )
    );
  const before = await digest();
  for (const conditions of [[], ["development"]]) {
    const options = browserBuildOptions(root, "artifacts/plugin-test-not-written");
    assert.equal(options.plugins[0].name, "mtp-lightweight-native-rect");
    const result = await build({
      ...options,
      stdin: {
        contents: 'export { CandlestickSeries, LineSeries } from "lightweight-charts";',
        resolveDir: root
      },
      format: "esm",
      conditions,
      write: false,
      logLevel: "silent"
    });
    assert.match(result.outputFiles[0].text, /mtpNativeRectCull/);
    const sdkInputs = Object.keys(result.metafile.inputs).filter((name) =>
      /lightweight-charts\.(development|production)\.mjs$/.test(name)
    );
    assert.equal(sdkInputs.length, 1);
    assert.match(sdkInputs[0], conditions.length ? /development\.mjs$/ : /production\.mjs$/);
  }
  assert.deepEqual(await digest(), before);
  const dev = await readFile(join(root, "scripts/dev.mjs"), "utf8");
  assert.match(dev, /plugins: \[\.\.\.common\.plugins, devPlugin\("install"\)\]/);
  assert.match(dev, /plugins: \[\.\.\.common\.plugins, devPlugin\("app"\)\]/);
});

test("plugin rejects unknown SDK entrypoints and validates both hashes before loading", async () => {
  const plugin = lightweightNativeRectPlugin(root);
  let start, load;
  plugin.setup({
    onStart(callback) {
      start = callback;
    },
    onLoad(_options, callback) {
      load = callback;
    }
  });
  await start();
  await assert.rejects(
    load({ path: join(sdk, "dist/lightweight-charts.standalone.production.mjs") }),
    /unsupported SDK entrypoint/
  );
  for (const mode of Object.keys(modes)) {
    const result = await load({ path: join(sdk, "dist", `lightweight-charts.${mode}.mjs`) });
    assert.equal(result.watchFiles.length, 3);
    assert.match(result.contents, /mtpNativeRectCull/);
  }
});

test("shared common plugin keeps independent SDK snapshots for install and app contexts", async () => {
  const plugin = lightweightNativeRectPlugin(root);
  function capture() {
    const callbacks = {};
    plugin.setup({
      onStart(callback) {
        callbacks.start = callback;
      },
      onLoad(_options, callback) {
        callbacks.load = callback;
      }
    });
    return callbacks;
  }
  const install = capture();
  const app = capture();
  const args = { path: join(sdk, "dist/lightweight-charts.production.mjs") };
  await install.start();
  assert.match((await install.load(args)).contents, /mtpNativeRectCull/);
  await assert.rejects(app.load(args), /unsupported SDK entrypoint/);
  await app.start();
  assert.equal((await install.load(args)).contents, (await app.load(args)).contents);
});
