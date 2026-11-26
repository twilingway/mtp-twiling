import test from "node:test";
import assert from "node:assert/strict";
import { sourceModules } from "./helpers/watchlist-sections.mjs";
import { backup, root, sourceLoader } from "./drive-reader-guard-helpers.mjs";

const load = sourceModules();
const { lastPriceStyle, drawingPriceLabelStyle, updatePriceAxisLabelColor } = load(
  "model/last-price-style.ts"
);
const { chartRenderConfigKey } = load("charts/render-config.ts");
const priceAxisLabels = {
  light: {
    lastPrice: { fill: "#d2eef4", text: "#14224a" },
    drawings: { fill: "#ac23dc", text: "#0f1302" }
  },
  dark: {
    lastPrice: { fill: "#22122a", text: "#fcdd88" },
    drawings: { fill: "#de3321", text: "#fbfbfb" }
  }
};

test("light and dark palettes set only label fills and text, with independent Auto defaults", () => {
  const settings = { lastPriceColor: "#c73952", priceAxisLabels };
  for (const theme of ["light", "dark"]) {
    const active = { ...settings, theme };
    for (const rising of [true, false]) {
      assert.deepEqual(lastPriceStyle(active, rising), {
        color: "#c73952",
        ...priceAxisLabels[theme].lastPrice
      });
    }
    const before = drawingPriceLabelStyle({ theme }, "#3aafdb");
    assert.equal(before.fill, before.color);
    assert.deepEqual(drawingPriceLabelStyle(active, "#3aafdb"), {
      color: before.color,
      ...priceAxisLabels[theme].drawings
    });
  }
  const light = { ...settings, theme: "light" };
  const fillAuto = updatePriceAxisLabelColor(light, "light", "lastPrice", "fill", undefined);
  assert.deepEqual(lastPriceStyle(fillAuto, true), {
    fill: "#c73952",
    color: "#c73952",
    text: "#14224a"
  });
  assert.deepEqual(fillAuto.priceAxisLabels.dark, priceAxisLabels.dark);
  assert.equal(light.priceAxisLabels.light.lastPrice.fill, "#d2eef4");
  const noCustom = updatePriceAxisLabelColor(
    { priceAxisLabels: { dark: { drawings: { text: "#000001" } } } },
    "dark",
    "drawings",
    "text",
    undefined
  );
  assert.equal(Object.hasOwn(noCustom, "priceAxisLabels"), false);
  assert.deepEqual(
    lastPriceStyle({ ...settings, theme: "dark" }, true, null),
    lastPriceStyle({ lastPriceColor: "#c73952", theme: "dark" }, true)
  );
});

test("editing either palette keeps the native adapter configuration key unchanged", () => {
  const flags = {
    ma: false,
    ema: false,
    volume: false,
    mtp160: false,
    mtp440: false,
    mtp640: false
  };
  const settings = { theme: "light", lastPriceColor: "#c73952" };
  assert.equal(
    chartRenderConfigKey({ ...settings, priceAxisLabels }, flags),
    chartRenderConfigKey(settings, flags)
  );
});

const jsx = (type, props) => ({ type, props });
const gather = (node, predicate) => {
  if (Array.isArray(node)) return node.flatMap((element) => gather(element, predicate));
  if (!node?.props) return [];
  return [...(predicate(node) ? [node] : []), ...gather(node.props.children, predicate)];
};

test("settings present four independent colors per palette and allow picking or resetting each", () => {
  let settings = { theme: "dark" };
  let selected;
  const uiLoad = sourceModules({
    react: {
      useId: () => ":price-settings",
      useState(initial) {
        selected ??= initial();
        return [
          selected,
          (next) => {
            selected = next;
          }
        ];
      }
    },
    "react/jsx-runtime": { jsx, jsxs: jsx }
  });
  const { PriceAxisLabelFields } = uiLoad("screens/terminal/PriceAxisLabelFields.tsx");
  const render = () =>
    PriceAxisLabelFields({
      settings,
      onChange: (theme, label, field, value) => {
        settings = updatePriceAxisLabelColor(settings, theme, label, field, value);
      }
    });
  for (const theme of ["dark", "light"]) {
    const [choose] = gather(render(), ({ type }) => type === "select");
    choose.props.onChange({ target: { value: theme } });
    const colors = gather(
      render(),
      ({ type, props }) => type === "input" && props.type === "color"
    );
    assert.equal(colors.length, 4);
    assert.ok(colors.every(({ props }) => props.name.startsWith(`${theme}-`)));
    colors[0].props.onChange({ target: { value: priceAxisLabels[theme].lastPrice.fill } });
  }
  assert.equal(settings.theme, "dark");
  assert.equal(settings.priceAxisLabels.dark.lastPrice.fill, "#22122a");
  assert.equal(settings.priceAxisLabels.light.lastPrice.fill, "#d2eef4");
  const [auto] = gather(
    render(),
    ({ type, props }) => type === "input" && props.type === "checkbox"
  );
  assert.equal(auto.props.checked, false);
  auto.props.onChange({ target: { checked: true } });
  assert.deepEqual(Object.keys(settings.priceAxisLabels), ["dark"]);
});

test("new palettes round-trip JSON and Drive while a prior projection refuses to discard their data", async () => {
  const fromSource = sourceLoader(root);
  const { validateBackup } = fromSource("model/backup-format.ts");
  const { sanitizeDriveBackup, prepareDriveBackup, restoreDriveBackup } = fromSource(
    "services/drive/backup.ts"
  );
  const { assertReadableDrivePayload } = fromSource("services/drive/reader-guard.ts");
  const initial = backup();
  const serialized = JSON.stringify(initial);
  assert.deepEqual(assertReadableDrivePayload(initial), initial);
  assert.equal(JSON.stringify(initial), serialized);
  const input = backup();
  input.layout.chartSettings.priceAxisLabels = priceAxisLabels;
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(input))), input);
  assert.deepEqual(assertReadableDrivePayload(input), input);
  const { payload } = await prepareDriveBackup(input);
  assert.deepEqual(await restoreDriveBackup(payload, []), input);
  const oldProjection = sourceLoader(root, {
    "services/drive/backup.ts": {
      sanitizeDriveBackup(value) {
        const copy = sanitizeDriveBackup(value);
        delete copy.layout.chartSettings.priceAxisLabels;
        return copy;
      }
    }
  });
  const readOld = oldProjection("services/drive/reader-guard.ts").assertReadableDrivePayload;
  assert.throws(
    () => readOld(input),
    (error) => error.code === "unsupported-format"
  );
  assert.deepEqual(input.layout.chartSettings.priceAxisLabels, priceAxisLabels);
});

test("new backup fields reject invalid or executable styles before Drive projection", () => {
  const source = sourceLoader(root);
  const { validateBackup } = source("model/backup-format.ts");
  const { sanitizeDriveBackup } = source("services/drive/backup.ts");
  const input = backup();
  for (const value of [
    [],
    { blue: {} },
    { dark: { lastPrice: { fill: "blue" } } },
    { light: { drawings: { alpha: 0.5 } } }
  ]) {
    input.layout.chartSettings.priceAxisLabels = value;
    assert.throws(() => validateBackup(input));
    assert.throws(
      () => sanitizeDriveBackup(input),
      (error) => error.code === "remote-invalid"
    );
  }
  let reads = 0;
  const style = {};
  Object.defineProperty(style, "text", {
    get() {
      reads++;
      return "#123456";
    }
  });
  input.layout.chartSettings.priceAxisLabels = { dark: { lastPrice: style } };
  assert.throws(
    () => sanitizeDriveBackup(input),
    (error) => error.code === "remote-invalid"
  );
  assert.equal(reads, 0);
});
