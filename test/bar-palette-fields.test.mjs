import test from "node:test";
import assert from "node:assert/strict";
import { sourceModules } from "./helpers/watchlist-sections.mjs";

const jsx = (type, props) => ({ type, props });
function gather(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((item) => gather(item, predicate));
  if (!node?.props) return [];
  return [...(predicate(node) ? [node] : []), ...gather(node.props.children, predicate)];
}

test("bar settings edit both themes and directions independently and restore each Auto color", () => {
  let selected;
  let settings = { theme: "dark", upColor: "#ffffff", background: "#ffffff" };
  const load = sourceModules({
    react: {
      useId: () => "bar-settings",
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
  const { BarPaletteFields } = load("screens/terminal/BarPaletteFields.tsx");
  const { barColors, updateBarColor, DEFAULT_BAR_COLORS } = load("model/bar-palette.ts");
  const render = () =>
    BarPaletteFields({
      settings,
      onChange: (theme, field, value) => {
        settings = updateBarColor(settings, theme, field, value);
      }
    });
  const colors = () =>
    gather(render(), ({ type, props }) => type === "input" && props.type === "color");
  const autos = () =>
    gather(render(), ({ type, props }) => type === "input" && props.type === "checkbox");
  const choose = (theme) =>
    gather(render(), ({ type }) => type === "select")[0].props.onChange({
      target: { value: theme }
    });
  assert.equal(colors()[0].props.value, barColors(settings).upColor);
  for (const theme of ["dark", "light"]) {
    choose(theme);
    assert.equal(colors().length, 2);
    assert.ok(colors().every(({ props }) => props.name.startsWith(`${theme}-bar-`)));
    assert.ok(autos().every(({ props }) => props.checked));
    const expected = theme === "dark" ? barColors(settings) : DEFAULT_BAR_COLORS.light;
    assert.deepEqual(
      colors().map(({ props }) => props.value),
      [expected.upColor, expected.downColor]
    );
    colors()[0].props.onChange({ target: { value: theme === "dark" ? "#abcdef" : "#123456" } });
    colors()[1].props.onChange({ target: { value: theme === "dark" ? "#fedcba" : "#654321" } });
    assert.ok(autos().every(({ props }) => !props.checked));
  }
  assert.equal(settings.theme, "dark");
  assert.equal(settings.background, "#ffffff");
  assert.equal(settings.upColor, "#ffffff");
  assert.deepEqual(settings.barColors, {
    dark: { upColor: "#abcdef", downColor: "#fedcba" },
    light: { upColor: "#123456", downColor: "#654321" }
  });
  autos()[0].props.onChange({ target: { checked: true } });
  assert.deepEqual(settings.barColors.light, { downColor: "#654321" });
  assert.equal(colors()[0].props.value, DEFAULT_BAR_COLORS.light.upColor);
  autos()[0].props.onChange({ target: { checked: false } });
  assert.equal(settings.barColors.light.upColor, DEFAULT_BAR_COLORS.light.upColor);
  choose("dark");
  assert.equal(colors()[0].props.value, "#abcdef");
});

test("inactive palette uses its standard background and active palette follows its custom background", () => {
  let selected = "dark";
  const load = sourceModules({
    react: {
      useId: () => "bar-background",
      useState: () => [
        selected,
        (next) => {
          selected = next;
        }
      ]
    },
    "react/jsx-runtime": { jsx, jsxs: jsx }
  });
  const { BarPaletteFields } = load("screens/terminal/BarPaletteFields.tsx");
  const { barColors, DEFAULT_BAR_COLORS } = load("model/bar-palette.ts");
  const settings = { theme: "light", background: "#000000" };
  const render = () => BarPaletteFields({ settings, onChange: () => {} });
  const colors = () =>
    gather(render(), ({ type, props }) => type === "input" && props.type === "color");
  assert.deepEqual(
    colors().map(({ props }) => props.value),
    Object.values(DEFAULT_BAR_COLORS.dark)
  );
  selected = "light";
  assert.deepEqual(
    colors().map(({ props }) => props.value),
    Object.values(barColors(settings))
  );
});
