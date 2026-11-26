# Проверки исследования и runtime compiler

## Runtime compiler — отдельная implementation ветка

Ветка `feat/ta-render-presentation`, base source50b5873; root decision record:
`docs/TA_RENDER_IMPLEMENTATION_DECISIONS.md`. Добавлены только три runtime model modules и два
source test/helper файла; definitions/adapters/registry/storage/Drive ещё не подключены. Новых
dependencies, generated version или build нет.

- `node --experimental-test-isolation=none --test test/ta-render-contract.test.mjs`: 8/8.
- `node test/technical-trend-state-typecheck.mjs`: whole-source strict PASS с ровно одним
  виртуальным модулем APP_VERSION/BUILD_ID string declarations; generated файл отсутствует,
  diagnostics не подавляются.
- Scoped ESLint/Prettier и `node scripts/spec.mjs validate --all --strict`: PASS.
- Независимый readonly Git50b5873 baseline numeric42/v1 witness, без render definitions:
  `7cd3515d0bf89d288c3715165c8da0d3584df81ae50525ce2681825cde507ca3`.

Source tests включают explicit old default solid, MACD/PVO zero/equality/null, AO negative-rising и
after-null policy, cross relative size/no fake values, hidden anchors/no scale, fill runs без
мостов, malformed references/length/timestamps/non-finite. Runtime graph не является parser backup.
Независимый compiler review, native lifecycle/actual paint/performance и G5 остаются открыты.

## Исторический research/spec-only этап

26.11.2026. Worktree `D:/MySource/ReactJS/vps/artifacts/ta-render-contract-research`, ветка
`docs/ta-render-contract-research`, база `5d569c394ee3d8730af12c665aa956f290b3245e`.

## Выполнено

- Прочитаны repository AGENTS, OpenSpec workflow/config, inventory/specs и current schema
  instructions proposal/design/specs/tasks. Применён OpenSpec workflow; дополнительных агентов нет.
- Установленные package.json подтверждают LW5.0.9/KLine9.8.12. node_modules — read-only Junction на
  `D:/MySource/ReactJS/tradingview-personal/node_modules`; install/update не запускались.
- Anonymous public Pine GET: PSAR33, Supertrend12, MACD43, PVO33, AO31; версии/SHA/строки в
  исследовании. Source/bundles не сохранялись в Git. Node процесс унаследовал TLS verification
  disabled; это ограничение получения источников указано в отчёте. Credentials/browser не
  использовались.
- Узкая source-only in-memory Node probe прочитала installed source и через assert подтвердила: LW
  bottom→grid→normal, KLine indicator→grid и destination-over в grid/negative indicators. Это
  проверка source structure, не canvas execution и не browser paint.
- Проверены UTF-8 без BOM и отсутствие повреждённых кириллических фрагментов в новых документах.
- `node node_modules/prettier/bin/prettier.cjs --check docs/TA_RENDER_CONTRACT_RESEARCH.md openspec/changes/ta-render-contract`:
  PASS (после scoped write).
- `node scripts/spec.mjs validate ta-render-contract --strict`: PASS.
- `node scripts/spec.mjs validate --all --strict`: **45 passed, 0 failed**.
- Все implementation tasks unchecked; граф зависимостей и G1–G7 не трактуются как одобренная
  реализация.

## Follow-up после independent review

База follow-up `760a5537ed219d9803deff398a25ebf7e84a576a`. Прочитан
`D:/MySource/ReactJS/vps/artifacts/ta-render-contract-readonly-review.md` и metadata/probes
reviewer. Обязательное замечание принято: figures=[]/visiblefalse не доказывают scale-neutral
companion. Добавлены effective Price precision policy, create/sync-before-override, conditional
precisionFlag trap и G7 native create/range tests. Production42 explicit6 path не изменён.

Собственная `node openspec/changes/ta-render-contract/probes/kline-precision-probe.mjs`: PASS. Probe
проверяет raw SDK SHA, исполняет extracted installed setPrecision/sync/calcRange и sequence model;
actualCreate=false/actualCanvas=false. Четыре calcRange случая: precision6/8 × visible/hidden;
matching companion сохраняет весь range object, default4 расширяет≈8e-6→8e-4 и≈8e-8→8e-4. Explicit6
ставит flag только при изменении числа; auto Price следует6→8, legacy Normal→Price explicit6
остаётся pinned6. Код SDK извлекается в памяти, не сохраняется в Git.

Source authenticity теперь подтверждена независимым verified TLS evidence reviewer:
`../ta-render-contract-verified-sources.py` и `.json` относительно worktree root. Прочитаны HTTP200/
CERT_REQUIRED/check_hostname metadata всех пяти совпавших hashes. Это не новый авторский TLS GET;
историческое ограничение первоначального insecure Node GET не скрыто и не используется как sole
proof.

Уточнена actual form period-only intent policy и авторская рекомендация discriminated instance2
presentation поверх сохранённого legacy styles bag, envelope3 при instance2, per-output
reset-to-auto и strict newer reject до projection/write/sync. Формат остаётся proposal до root
contract review; v1 не переписывались. Новые JSON/Drive/UI tests — будущие gates, не пройденная
реализация.

## Installed source fingerprints

SHA256 UTF-8 прочитанного текста, без копирования исходников в repo:

| Файл                                                       | SHA256                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| lightweight-charts/dist/lightweight-charts.development.mjs | `dec157fcccf103e2d152cce52b29204a66ab3a7df713af4132e6bb70e22233b9` |
| klinecharts/dist/index.esm.js                              | `313a26786af901e2b5b93c16ac002c6ceeebb54ecc9b6a55e386f1b31805ca5d` |

## Ограничения

Runtime/shared types/native adapters/UI/cache/Drive/version/build/server не менялись. Browser, Pine
execution, math tests/typecheck/build, performance benchmark, push/merge/deploy не выполнялись:
scope — source-only docs/spec. Ниже или в финальной передаче commit SHA и clean worktree относятся
только к этим документациям, не к готовности TA renderer.
