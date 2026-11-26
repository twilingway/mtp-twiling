# Verification

Base exact88d3509171fa4e690abec2267bdb8793d43813dd. Own branch fix/kline-inactive-precision;
readonly original8case results сохранены без изменения. Source ownership: K manager, два focused
helpers и один metadata forwarding callback в kline.ts; собственные tests/docs/spec.

Итог:23/23 focused PASS +100/100 existing native/camera/geometry/hover PASS +20/20 независимых
A/opacity probes =143 scoped checks. Counterfactual exact88d:5FAIL/3PASS (8 targeted regressions,
без environmental EPERM в зачтённом прогоне). Strict whole-source/lint/format PASS; OpenSpec59/59
PASS. Production modules: manager224, members422, domain97 lines; каждый<=500.

```text
node test/kline-inactive-precision.test.mjs
KLINE_INACTIVE_BASELINE_SOURCE=<verified 88d blob> node test/kline-inactive-precision.test.mjs --baseline-88d
node test/ta-render-kline.test.mjs
node test/kline-technical-settle.test.mjs
node test/native-technical-renderers.test.mjs
node test/chart-camera.test.mjs
node test/native-technical-geometry.test.mjs
node test/technical-pane-capture-order.test.mjs
node test/technical-compact-crosshair.test.mjs
node test/technical-compact-axis.test.mjs
node test/ta-render-lightweight.test.mjs
node test/helpers/channel-average-source.mjs --typecheck
node node_modules/eslint/bin/eslint.js <four owned production modules> --max-warnings 0
node node_modules/prettier/bin/prettier.cjs --check <owned paths>
node scripts/spec.mjs validate --all --strict
git diff --check
```

Readonly original20 A/opacity0 native probe остаётся отдельно сохранён; его копия с новым source
path проверяется в own QA без переписывания исходного evidence. Whole source strict compilerhost
виртуализирует только два baseline version exports, когда generated module отсутствует.

LAB native tests не являются new quotes, screenshot pixels или browser PASS. Actual public API side
effects проверяются через installed methods и controlled DOM/viewport/clock. Cost probe —
helper-only diagnostic, без full performance threshold. Fresh integrated product/browser gate и
независимое review остаются root follow-up перед релизом.
