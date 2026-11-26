# Source-only verification

26.11.2026, branch `feat/ta-trend-state-math`, base `ef2b63302dc36bf77fd0fe450407d37d2ff2dff2`.

- `node test/technical-trend-state.test.mjs`: **19 passed, 0 failed**. Проверяются независимые SAR
  EP/AF/reversal/clamp и ATR/band ledgers, TSI rational и Fisher log ledgers, KST percent
  ROC/default45/53 warmup, partial extrema, n1/zero/flat, gap до/после с повторным seed,
  overflow/recovery, readonly/prefix/timestamps, source requirements/bounds, metadata, 100000
  bars/n10000 fixture.
- `node node_modules/typescript/bin/tsc --noEmit`: baseline отсутствует generated app-version, два
  TS2307 в ApplicationInfo/pwa. Generated/prepare-version не создавались и не запускались.
- `node test/technical-trend-state-typecheck.mjs`: **PASS** полного реального src с исходным strict
  tsconfig/noEmit и **ровно одним виртуальным module** app-version.ts (два string exports
  APP_VERSION/BUILD_ID). Diagnostics не фильтруются. Host ничего не пишет. Это ограниченная
  source-only проверка, не plain tsc PASS.
- `node node_modules/eslint/bin/eslint.js src/model/technical-indicators/trend-state --max-warnings 0`:
  **PASS**. Tests/helpers исключены исходным ESLint config и отдельно проверены
  Prettier/исполнением.
- Scoped `prettier --check` production folder, оба tests/helpers, docs и change: **PASS**.
- `node scripts/spec.mjs validate --all --strict`: **43 passed, 0 failed**.
- `git diff --check`: PASS; production modules имеют менее500 nonempty lines каждый.

В установленном Node22 флаг `--test-isolation=none` не поддерживается; использован direct
`node test/...` без spawn/test subprocess. Никаких
build/browser/server/version/registry/Drive/account действий. Входные synthetic unit fixtures не
попадали в продуктовые свечи.

## Limits and follow-up gates

Пять math-only вычислений, **DPO unresolved**: actual source32/Pine6 fractional offset default21.
Честная presentation future boundary описана, floor/round не выдуманы. Sparse segment reset
SAR/Supertrend, preseed price mask и finite-safe arithmetic — explicit local policies. Source/Pine
Reference evidence не означает runtime parity.

Координатору отдельно: review/cherry-pick source commit, точные public IDs/output
keys/параметры/limits, history/warmup integration и serializers; native/UI/browser gates; DPO
conversion исследование. Исходный computed count и .20/.21 cut не изменены. После review
архивировать OpenSpec отдельно, canonical specs в текущем ownership не менялись.
