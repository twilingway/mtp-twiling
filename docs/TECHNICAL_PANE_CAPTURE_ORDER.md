# Сохранение порядка TA panes после separator resize

Source-only fix от `f74c33d968d7ca258def096bfc2d731bbdf74b5f`, отдельный worktree
`artifacts/technical-pane-capture-order`. Frozen R worktree и native modules не изменялись.

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
теперь общая для geometry и capture. Required v1 ratio shape не меняется; viewport-normalized peers
не превращаются в новые измеренные ratios. Changed pane ratio по-прежнему clamped0.05..0.8;
collapsed сбрасывается только если resized pane выше31. Без изменений heights capture возвращает
null. Максимум100 lower panes сохраняется без обрезания active IDs.

Shared `persistTechnicalPaneLayout` ставит принятые актуальные captured IDs первыми в их порядке,
затем сохраняет остальные свежие active layout entries. Удалённые или перемещённые в другую pane IDs
фильтруются по текущим instances; stale records не восстанавливаются. Serialization,
owner/session/import/route guards и original valid callback не меняются. При изменении массива
preferences во время ожидания storage прежний reference guard отменяет captured write. Поле order не
добавлено: источником persisted order остаётся array order текущего v1 layout.

Production diff только в `src/charts/technical-pane-geometry.ts` и одном hunk
`persistTechnicalPaneLayout` в `src/screens/terminal/technical-indicator-actions.ts`. Default
grouping sort, `kline-technical.ts`, `lightweight-technical.ts`, event layer, controller routing,
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

Прежние suites: technical-pane-layout7, technical-indicator-actions5, native-technical-renderers22,
native-technical-geometry4, kline-technical-settle7 —45/45 PASS. С новым regression всего53 scoped
tests. Whole-source TypeScript noEmit с двумя version strings только in-memory — PASS. Scoped
ESLint/Prettier — PASS; strict OpenSpec51/51 — PASS. Frozen full SHA и clean WT status передаются
отдельно после commit.

Это source regression и controlled adapter evidence, не новый actual-browser paint PASS. Повторить
исходный drag→persist→sync в actual KLine и LW после root integration; исходный screenshot остаётся
отдельным визуальным evidence. Сборка, prepare-version, новые servers/processes, Google API и
публикация не выполнялись.
