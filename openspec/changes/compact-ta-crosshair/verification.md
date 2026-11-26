# Source verification

Base `f889aebb14b9b330913a73595aed11c39b7e5fcd`. Own WT compact-ta-crosshair;
build/version/browser/Google/private profiles и root QA/source не менялись. Production ownership:
один helper и два technical managers.

```text
node test/technical-compact-crosshair.test.mjs
node test/native-technical-renderers.test.mjs
node test/ta-render-kline.test.mjs
node test/ta-render-lightweight.test.mjs
node test/kline-technical-settle.test.mjs
node test/technical-compact-axis.test.mjs
node test/technical-pane-capture-order.test.mjs
node test/native-technical-geometry.test.mjs
node test/helpers/channel-average-source.mjs --typecheck
node node_modules/eslint/bin/eslint.js src/charts/technical-compact-crosshair.ts src/charts/lightweight-technical.ts src/charts/kline-technical.ts --max-warnings 0
node node_modules/prettier/bin/prettier.cjs --check <owned paths>
node scripts/spec.mjs validate --all --strict
git diff --check
```

- Focused13/13 и baseline75/75 PASS, всего88 scoped cases.
- Whole source strict noEmit PASS: existing compilerhost добавляет in-memory APP_VERSION/BUILD_ID
  string module только при отсутствии generated; без suppress/ослабления flags/записи версии.
- Scoped ESLint/Prettier PASS; OpenSpec57/57 PASS. Tests/mocks исправлялись для требуемых native
  canvas measurement boundaries; product source не ослаблялся ради failing tests.
- Actual SDK source hashes и native label/optimal width paths проверены вVM. Public API writes
  ограничены horizontal label flags и temporary sizing hold; current global cursor settings/vertical
  flags не записываются.
- Existing controlled fixtures без нового SDK surface используют no-op capability boundary; новые
  focused tests предоставляют полный нужный public surface и исполняют настоящие native label
  methods.
- Нет actual browser/screenshot assertion на новой версии. Fresh product verification требуется root
  после integration.
