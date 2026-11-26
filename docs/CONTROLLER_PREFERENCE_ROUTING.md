# Routing preferences: source-only исправление .22

База `d3575934cb5c0ef051714eeeb20edad987ac72ac`, ветка `feat/controller-routing-fix`, WT
`D:/MySource/ReactJS/vps/artifacts/controller-routing-fix`. Root одобрил reversible fix после двух
deterministic source regressions в `../route-race-review/{REVIEW.md,probe.mjs,probe-output.json}`.

## Исправлено

- TF1h + engine KLine либо symbol/TF во время actual camera save/editing.flush больше не теряют
  независимые поля. Pending valid records объединяются, latest same-field выигрывает.
- Invalid depth во время persistence уже committed TF не отменяет его history load.
- Reload публикует historyViewReady=false вместе с preferences/candles/loading, поэтому actual
  ChartRangeControl disabled и в этом await gap. UI/native файлы не менялись.
- Late input during carry отменяет selectionCurrent, повторно выбирает valid intents и пересчитывает
  fresh preferences. После carry nonrouting style/layout edits повторно merge, не затираются.
- Old camera capture/key, owner/client/UID/revision/import guards, original valid и forceReload
  сохранены. Старые scopes не replay после transient bounce. Network не задерживает next critical.

Владение production ограничено controller.ts и controller-preference-routing.ts. Helper хранит
только per-controller runtime intent list, scopes и committed generation; новых persistent полей,
таймеров, зависимостей или глобальных объектов нет. Invalid record не повышает generation. Errors
отклоняют callers без подмены исходной storage ошибки и без poisoning следующих requests.

## Проверки

Новый `node test/controller-preference-routing.test.mjs`: **19/19 PASS**. Реальные implementations
controller/editing/history/camera/chart-lifecycle и JSX disabled props; fake
storage/DB/market/native и controllable React hook/JSX boundary. Начальная ready history получена
real loadHistory, а не вставкой неправдоподобного flags state. Network/DB gates управляют
interleaving детерминированно.

Cases: saveView и editing.flush partial loss; latest-depth/no-key5; symbol+TF/latest UID; late input
before camera transaction и после её commit; atomic readyfalse/no eager load; invalid depth не
отменяет committed TF; next critical не ждёт old network; nonrouting during carry; originalvalid/
forceReload; owner/import/revision bounce, client change без update, dispose; storage error
recovery.

Прежние source suites:

| Команда                                   | Результат                               |
| ----------------------------------------- | --------------------------------------- |
| node test/lifecycle.test.mjs              | 11/11 PASS                              |
| node test/history-depth-camera.test.mjs   | 8/8 PASS, исходные assertions сохранены |
| node test/chart-import-camera.test.mjs    | 6/6 PASS                                |
| node test/chart-render-lifecycle.test.mjs | 1/1 PASS                                |

Lifecycle latest-symbol fixture освобождает old saveView gate до await обоих routing callers:
critical camera wait намеренно общий, latest/independent assertions сохранены. PWA abort test
получает только два version string exports in-memory; source-only WT не содержит generated module.
Никакой prepare-version/build для прохождения тестов не запускался.

`node test/technical-trend-state-typecheck.mjs` проверяет **весь реальный source** с исходным strict
tsconfig/noEmit, только app-version.ts virtual string declarations. Это source-only compiler-host
PASS, не plain tsc/build PASS. Scoped ESLint двух production файлов и Prettier changed production/
новых tests/docs/OpenSpec проходят; legacy lifecycle целиком не переформатирован ради двух hunks.
Strict OpenSpec **48 passed, 0 failed**, scoped format и diff check PASS при freeze.

## Пределы

Если camera transaction уже committed до late input, прежний valid key может остаться. Тест явно
проверяет этот предел; удалять такой key как «rollback» запрещено. Final preferences latest. Если
persistence отклонён после staging, ошибка доходит до caller; eager history не выполняется.
Browser/full integration/release находятся у root. Этот worktree не выполняет browser, build,
prepare-version, server, credential access, push/merge/deploy и не меняет .22 интеграционный WT.

## Follow-up independent review

На ae4889f reviewer подтвердил дополнительный blocker: combined depth30 + valid forced sidebar ждали
повторного camera save; actual toggleIndicator(ma) запускал refresh и отменял depth. Aggregate
batch.finish() ошибочно разрешал обоих callers, теряя отдельный force/sidebar intent.

Теперь record один раз получает собственный sticky depth guard внутри critical. Guard сохраняется
через list-version retries, не создаётся заново после transient invalidation. При повторном выборе
удаляются только invalid records целиком, включая собственные fields/forceReload. Остальные valid
records повторно объединяются. При camera carry failure отменяются только atomic depth records;
retry требует удаления минимум одного record, поэтому нет blind continue/livelock. Camera и
scope/original-valid guards не ослаблены. Это отдельный follow-up поверх ae4889f, без amend.

Три actual-controller cases: indicator refresh сохраняет forced sidebar; завершённый refresh с
полным market fixture не rearm-ит depth/style record; retired adapter carry failure сохраняет
отдельный forced preference и не пишет rejected depth key.

Follow-up checks: routing19/19, прежние depth8/8/lifecycle11/11, independent readonly probes11/11,
whole-source virtual-version noEmit, scoped ESLint/Prettier, strict change validation и diff check
PASS. Header SHA в external reviewer probe — исторический label ae4889f, не assertion текущего
worktree; повторный запуск читал этот follow-up source. Full build/browser/full suite не
запускались.
