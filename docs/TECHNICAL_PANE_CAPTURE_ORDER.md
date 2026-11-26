# Сохранение порядка TA panes после separator resize

Source-only fix от `f74c33d968d7ca258def096bfc2d731bbdf74b5f`, отдельный worktree
`artifacts/technical-pane-capture-order`. Первый order fix
`d5c306040b45c606de3981b077c631fd67df444e` дополнен runtime intent follow-up после независимого
queue review. Frozen R worktree не менялся.

## Наблюдение и доказательства

Независимый actual-paint worker сообщил regression KLine9.8.12: при order
price,size1,size2,size3,size4 drag между size2/size3 меняет только их высоты, а следующий
`qa.sync()` переставляет size1 вниз. В этом этапе прочитан текстовый JSON evidence; изображения не
открывались, браузер не запускался.

- Harness: `D:/MySource/ReactJS/vps/artifacts/ta-render-kline-paint-qa/harness.ts`.
- Evidence: `D:/MySource/ReactJS/vps/artifacts/ta-render-kline-paint-qa/evidence.json`, actions
  `paneDragBefore`, `paneDragAfter`, `paneDragReconcile`.
- Evidence SHA256: `2d5d9088d5fb7b52c7c2fe076b7dc3f52edd75f29b615b46c6e9cf50803c07e3`.
- Worker report/manifest: `REPORT.md`, `manifest.json` в той же папке; screenshot reference
  `28-pane-drag-reconcile-dpr2.png`, DPR2 desktop1440×1000.

| Шаг                 | Порядок                       | Высоты price и четырёх lower panes |
| ------------------- | ----------------------------- | ---------------------------------- |
| До drag             | price,size1,size2,size3,size4 | 258,165,166,165,166                |
| После drag          | price,size1,size2,size3,size4 | 258,165,222,109,166                |
| После прежнего sync | price,size2,size3,size1,size4 | 258,222,109,165,166                |

Drag CSS(600,644)→(600,700),15 steps. Прежний capture вернул только size2 ratio222/920 и size3
ratio109/920. Grouping использует array order persisted layout прежде fallback instance order,
поэтому эти два IDs становятся первыми. Отдельно writer `persistTechnicalPaneLayout` раньше проходил
сначала старый sparse layout; даже полный capture мог потерять измеренный order при сохранении
поверх существовавших overrides.

## Исправление

`capturedTechnicalLayout` возвращает полный snapshot измеренных active lower panes после настоящего
height change. Порядок определяется фактическим native `top`, а не названиями, lexical ID, default
instance order или порядком sparse overrides. `price` и legacy volume не становятся TA preference
records.

Только height delta>=1 меняет ratio. Нетронутые existing ratio/collapsed копируются точно; если
override отсутствовал, сохраняется прежний renderer default0.18/collapsed false. Default константа
теперь общая для geometry, capture и writer. Required v1 ratio shape не меняется;
viewport-normalized peers не превращаются в новые измеренные ratios. Changed pane ratio по-прежнему
clamped0.05..0.8; collapsed сбрасывается только если resized pane выше31. Без изменений heights
capture возвращает null. Максимум100 lower panes сохраняется без обрезания active IDs.

Поле order не добавлено: источником persisted order остаётся array order текущего v1 layout.

## Runtime intent и queued preferences

Независимый review
`artifacts/technical-pane-capture-order-review/{REPORT.md,probe.mjs,probe-results.json}` показал два
P2 на d5: предыдущая queued операция сохраняла untouched collapse=true либо ratio0.37 до начала
capture transform, после чего full old snapshot возвращал false/0.18. Проверка references после
transform такой случай не отменяла. Old snapshot мог отменить и предыдущую явную pane reorder.

Новый `captureTechnicalPaneLayout` возвращает явный объект:

```ts
{
  layout: TechnicalPaneLayout; // полный actual-top order
  context: {
    resizedPaneIds: readonly string[]; // только изменённые heights
    baselineOrder: readonly string[]; // saved IDs до capture
  };
}
```

Это runtime-only contract: `ChartOptions.onTechnicalPaneLayout(layout, context)` → оба native
forwarders → actual `chart-lifecycle.ts` →
`persistTechnicalPaneLayout(controller, layout, valid, context)`. Никаких WeakMap/hidden array
properties, persistent metadata или DB migration. Старый `capturedTechnicalLayout` остаётся
array-only measurement helper для существующих geometry readers.

Writer внутри serialized transform берёт geometry только resized IDs из snapshot; untouched
ratio/collapse берёт из fresh prefs, затем measurement/default0.18 для ещё не сохранённых IDs. Если
относительный порядок общих baseline saved IDs изменён предыдущей model reorder, используется fresh
group order; иначе сохраняется измеренный native order плюс новые active IDs в свежем порядке. Само
добавление first override при collapse/height в empty/sparse layout не является reorder intent.
Removed/moved IDs фильтруются по свежим instances; новые active entries сохраняются. Default
grouping sort не меняется.

Legacy3arg calls остаются explicit partial geometry patches на fresh full group order. Полный resize
snapshot должен передавать context: без него все переданные records означают намеренные geometry
updates. Production callback требует второй аргумент типами; tests проверяют реальную forwarding
цепочку. Original serialization/owner/session/import/route/valid guards не меняются; изменение
preferences после начала transform по-прежнему отменяет pending capture через reference guard.

Production ownership follow-up: shared model runtime types/default constant, `adapter.ts`, geometry,
actions и минимальные forwarding hunks в `kline-technical.ts`, `lightweight-technical.ts`,
`chart-lifecycle.ts`. Native rendering/axis/geometry policy, event layer, controller routing,
DB/JSON/Drive shape, numeric series, camera и кэш не меняются.

## Проверки

Новый `test/technical-pane-capture-order.test.mjs` использует реальный source
adapter/event/capture/action/grouping pipeline с controlled native/DOM/storage boundaries
существующего fixture. На baseline до source fix первые7 cases дали5 FAIL/2 PASS: оба engines теряли
size1/size4 в capture; отдельно падали actual-top ordering, sparse writer order и100-pane
completeness.

После fix8/8 PASS:

- Реальный separator callback обоих adapters → actual TA action writer → reconcile. KLine fixture
  воспроизводит exact observed heights, оба engines сохраняют untouched pane order, resized ratios,
  camera и primary data writes. JSON/Drive projection сохраняют весь layout.
- Actual native-top порядок, отличный от metrics array/default/lexical order; untouched nondefault
  ratio/collapse не нормализуются по viewport.
- Sparse persisted layout заменяется полной captured последовательностью; свежие active entries
  сохраняются, removed IDs не возвращаются.
- Hidden/collapsed/stacked instances сохраняют stable pane IDs; move/remove не восстанавливают
  obsolete keys.
- 100-pane capture и strict ratio/schema bounds; только resized collapsed pane разворачивается.
- Transient owner/import/session/valid cancellation и pending move/remove во время storage;
  subscriptions освобождаются.

Follow-up suite `technical-pane-capture-race.test.mjs` проверяет9 cases: оба независимых P2 на full
baseline, collapse/height при partial/empty baseline, previous queued explicit reorder, new active
pane и legacy partial API. `node test/technical-pane-capture-race.test.mjs --baseline-d5` читает
только frozen writer через `git show` и даёт8 FAIL/1 PASS; current source9/9 PASS. Это различающий
before/after probe, старый source не копируется в repository. Actual lifecycle suite2/2 PASS на
kline/tradingview: context forwarding при queued collapse и retired-owner guard.

Прежние suites layout7/actions5/native-renderers22/native-geometry4/KLine-settle7 и
render-lifecycle1 —46/46 PASS; order8/race9/lifecycle2 —19/19 PASS. Всего65 scoped tests.
Whole-source noEmit с in-memory version strings, scoped ESLint/Prettier, strict OpenSpec51/51 и
diff-check — PASS. Frozen full SHA и clean WT status передаются отдельно после commit; portable
shape не меняется.

Это source regression и controlled adapter evidence, не новый actual-browser paint PASS. Повторить
исходный drag→persist→sync в actual KLine и LW после root integration; исходный screenshot остаётся
отдельным визуальным evidence. Сборка, prepare-version, новые servers/processes, Google API и
публикация не выполнялись.
