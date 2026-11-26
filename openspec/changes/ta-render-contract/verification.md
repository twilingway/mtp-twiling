# Проверка research/spec-only

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
- Все implementation tasks unchecked; граф зависимостей и G1–G6 не трактуются как одобренная
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
