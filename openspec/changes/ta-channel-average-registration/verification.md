# Source verification

База7cc9df914d78dc3da545fc17e11d5baa268fe490. Source worktree
`artifacts/ta-channel-average-registration`, ветка `feat/ta-channel-average-registration`.
Build/prepare-version не запускались. Frozen SHA передаётся после commit; tracked tree должен быть
clean.

Команды без app build:

```text
node --experimental-test-isolation=none test/technical-channel-average.test.mjs
node test/technical-channel-price-registration.test.mjs
node test/technical-channel-price-settings.test.mjs
node test/helpers/channel-average-source.mjs --typecheck
node node_modules/eslint/bin/eslint.js <owned src paths> --max-warnings 0
node node_modules/prettier/bin/prettier.cjs --check <owned paths>
node scripts/spec.mjs validate --all --strict
git diff --check
```

- Math88/88 PASS;6 pure modules byte-identical accepted780e9c5.
- Registration9/9 PASS: append-only3/count50/51, primary hashes, old47 witness,
  ledgers/selectors/causality/history, threshold50M+kernel bypass, ALMA/LSMA
  recovery/cache/history/params/reload, subnormal/MAX derived sources, JSON/Drive exactkeys.
- Settings4/4 PASS: actual form RU/EN controls/labels/local LSMA min2/style preservation; live draft
  status, valid expensive save without flag, shared price/lower legend status recovery; actual
  library55/51/4 and blocked state.
- Baseline pane-layout7/7, native geometry4/4 PASS. Old trend-price settings4 behavior cases PASS,
  old count case fails `55 !== 52` at test194. Existing global count fixtures оставлены без правок
  по ownership root; полный общий suite не объявляется зелёным.
- Whole-source TypeScript noEmit PASS с исходными strict options. При отсутствующем generated
  app-version compilerhost виртуально добавляет только APP_VERSION:string и BUILD_ID:string;
  generated file не записывается и diagnostics не подавляются.
- Scoped ESLint/Prettier PASS; strict OpenSpec55/55 PASS. Принятый math package проверяется только
  --check, не переформатируется.
- Первый source witness получил sandbox `spawnSync git EPERM`. Повторный read-only scoped запуск вне
  sandbox прошёл; source/runtime не менялись ради окружения.
- Primary GET verified default Python TLS, status200 и source hashes совпали с accepted780e9c5.
  Полный Pine source не сохранялся. Нового browser/UI screenshot/Pine execution parity нет.

Граница50M проверяется spy, не benchmark: actual cheap recovery uses16000 bars и не урезает quotes.
Нет claim общего frame/device budget или50M speed. Полный result timestamps length51000 проверен на
cost-limited case.
