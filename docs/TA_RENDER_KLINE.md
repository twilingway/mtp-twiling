# KLine TA presentation: implementation и native evidence

Дата: 2026-11-26. Consumer frozen bridge `a2117a89431e8a2bace8f4441e0034baaf836344` и policy
follow-up `bda56f79e64bf49e708d09c64c36219bc5774d0a` (cherry-pick `c7f55ad`). Это source-only K
stage; новые definitions не включены, browser paint не проверялся.

## Ownership и зависимости

Порядок: shared compiler/policy → `TechnicalRenderData.compile()` → KLine owner/context → optional
owned fill companion. В этом изменении production ownership только `src/charts/kline-technical.ts` и
`src/charts/kline-technical-geometry.ts`; плюс два новых test files, этот документ и собственный
OpenSpec change. Общие types/compiler/registry, numeric definitions, LW, UI, JSON/Drive и cache не
изменены. Никакой миграции, runtime objects в backup и дополнительных зависимостей.

## Поведение

- Metadata cross: ортогональный `+` в каждом finite index, без соединяющей линии. Relative size1..4
  даёт arm `2+size` CSS px и stroke `max(1,size/2)`. Это явный временный профиль, точная Pine pixel
  calibration остаётся G2.
- Metadata line/break: соседние finite points исходного массива; null, NaN/infinite projection и
  reversal masks разрывают путь. Singleton не создаёт segment. Canvas clip ограничивает pane; один
  сосед за viewport сохраняет обрезанные края.
- Columns: native bar figures и `baseValue:0`; shared `presentationColor` обслуживает solid, MACD
  sign/change и AO change palettes, включая equality/previous-null rules compiler contract. Native
  style callback использует symbol index, не поиск по timestamp. Mixed custom geometry owner рисует
  свои columns через ту же нулевую projection.
- Fill: paired finite indexed runs, не менее двух пар anchors. Anchor arrays не становятся
  figures/results. Скрытый stroke не выключает отдельную видимую заливку; instance hidden/collapse
  маскируется shared bridge. Hidden bodyMiddle/direction не добавляются в native scale/tooltip.
- Native owner остаётся носителем настоящих visible numeric figures, даже если draw заменён custom
  cross/linebr. Legacy outputs без metadata сохраняют прежний line/bar и explicit6 path.

## Precision и жизненный цикл

`precisionPolicy` выбирает class family до native create. `native-price`: registered
`IndicatorSeries.Price`, без explicit precision и без min/max/shouldOhlc. Поэтому native create
синхронизирует текущую price precision до descriptor override; subsequent chart precision sync
остаётся рабочим. Policy сохраняется при переносе в lower pane. `legacy-fixed-6`: прежний registered
Normal и explicit descriptor6, включая metadata MACD/PVO/AO; overlay descriptor сохраняет прежний
Price series.

Companion той же policy имеет `figures=[]`, `calc=[]`, только context anchors. Одного отсутствия
figures недостаточно: precision companion участвует в native range и при hidden/collapse. G7
проверяет actual registered constructor → Store.addInstance → sync → override → YAxis.calcRange,
включая flat/near-flat bars, initial6/8, изменения6→8→6, скрытие, lower move и удаление. Никаких
private-field mutations.

Owner удаляет companion перед собой, очищает rows/levels/outputs/fills/baseline и помечает context
disposed. Global callbacks не замыкают chart или dataset. Native settlement хранит WeakRef и
revision guard. Registry ограничен четырьмя семействами по100 names и одним custom figure; удалённые
slots переиспользуются.

## Typed native-only columns baseline

В installed9.8.12 `baseValue:0` управляет bar paint, но `YAxis.calcRange` читает только
`result[index][figure.key]`. Поэтому одноимённая semantic
`KlineColumnsBase {kind:'columns-base0',key,value:0,plots}` существует только внутри native context.
Это математическая граница columns, а не цена, не скрытый TA output и не изменение расчёта.

Key начинается с `__mtpColumnsBase0`, collision с любым настоящим outputId приводит к добавлению
`_`. Native derived row получает nonenumerable key0 только когда хотя бы один visible metadata
column finite на том же индексе. Исходные outputs/values/timestamps не меняются. Нет глобального
min/max0, fake quote, пересоздания pane или viewport listeners. Native range читает только реальные
visible row slots, поэтому viewport только с null columns не получает zero baseline. Hide/collapse
удаляют baseline figure; all-null не содержит baseline values; remove возвращает диапазон остальных
владельцев.

Public `registerFigure` регистрирует один no-op draw/checkEventOn=false custom type. Его figure
обязательно стоит первым. В pinned SDK `eachFigures` начинает с undefined default style; для
неизвестного custom type style не назначается и callback не вызывается. Следующие native bar/line
получают свои styles. Такая последовательность нужна: после styled figure SDK может повторно
использовать предыдущий default style. Actual native `eachFigures`, `IndicatorView`,
`IndicatorTooltipView`, `IndicatorLastValueView` и `ChartImp.crosshairChange` проверены: baseline не
создаёт paint/tooltip/axis-label glyph, не попадает в enumerable numeric result/crosshair JSON.
`figures` — внутренний native descriptor; UI outputs берутся из shared compiled outputs и не
получают semantic key.

Это намеренная зависимость от публичного registration API и поведения installed SPI. SHA pin в
native fixture требует повторного review при SDK update. Unconditional min/max0 отвергнуты:
calcRange игнорирует indicator.visible при сборе bounds, а max override в9.8.12 вызывает
setMinValue. Ни одна из этих ловушек не обходится private mutation.

## Слои

Owner strokes имеют `z=10+order`. Fill companion имеет `z=-3-order`, все значения<=-3. Actual
Store.override пересортировывает instances; более поздний instance идёт первым среди negative fills,
поэтому при `destination-over` находится выше ранее добавленного. Fills внутри companion обходятся в
обратном declaration order по той же причине. MTP -1 и drawings -2 сохраняют относительный порядок
выше fills; native grid рисуется destination-over после indicator pass. Actual SDK tests проверяют
Store order после override и compositing trace native IndicatorView/GridView. Итоговые pixels,
candle glyphs, cursor overlays и anti-aliasing этим не доказаны.

## Native source evidence

Установленный `klinecharts@9.8.12`, `node_modules/klinecharts/dist/index.esm.js`, SHA256
`313a26786af901e2b5b93c16ac002c6ceeebb54ecc9b6a55e386f1b31805ca5d`. Тест читает installed bundle, не
копирует его в repository; VM сохраняет actual native implementations и подменяет только DOM/chart
boundaries и compiled numeric fixture.

| Участок installed source      | Значение для реализации                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `982–1030` eachFigures        | undefined default style, custom prefix skip, per-bar callback                        |
| `1070–1080` setPrecision      | explicit precision flag trap                                                         |
| `4107–4130` _overrideInstance | min/max override bug, не использовать                                                |
| `4181–4202` addInstance       | constructor → synchronizeSeriesPrecision → descriptor override                       |
| `4307–4325`, `6478–6480`      | native Price/Volume sync, chart precision update                                     |
| `7520`, `7884`                | grid и negative indicator destination-over                                           |
| `8124` IndicatorTooltipView   | actual tooltip path                                                                  |
| `9938` IndicatorLastValueView | actual last-value axis path                                                          |
| `10294–10420` calcRange       | visible rows/figure keys, precision влияющий на flat range, отсутствие visible guard |
| `13319` crosshairChange       | native crosshair result list                                                         |

Первичные public API: [custom indicator](https://v9.klinecharts.com/en-US/guide/indicator),
[registerIndicator](https://v9.klinecharts.com/en-US/api/registerIndicator),
[registerFigure](https://v9.klinecharts.com/en-US/api/registerFigure). Это reference links из
предшествующего source research; новых сетевых проверок в этом implementation этапе не выполнялось.
Official/source provenance и исходные исследовательские limits сохраняются в
`TA_RENDER_CONTRACT_RESEARCH.md`.

## Проверки и границы доказательств

`node test/ta-render-kline.test.mjs`: 15/15 PASS; whole installed SDK выполняется в VM, настоящие
Store create/override/remove, ChartStore/ChartImp precision, YAxis range, native figure
paint/tooltip/axis/crosshair. Controlled compiled fixtures нужны, поскольку metadata ещё не
подключены в production definitions. Они не объявляются реальными котировками или browser paint.

Legacy suites: `node test/native-technical-renderers.test.mjs`22/22,
`node test/native-technical-geometry.test.mjs`4/4, `node test/kline-technical-settle.test.mjs`7/7
PASS. Включают45 common formulas, timestamps/warmup, grouping/reorder/resize/restore, camera и async
native settlement.

Полный source TypeScript noEmit с двумя version strings только in-memory PASS; scoped ESLint двух
production modules и Prettier всех owned files PASS; strict OpenSpec50/50 PASS. Frozen SHA и clean
status передаются отдельно после commit. Обычный `node --test` в sandbox получил spawn EPERM; прямой
запуск test files через node выполняет тот же node:test runner без дочернего процесса и прошёл.

G2 остаётся root integration gate: actual browser canvas при linear/log/inverted, DPR1/2,
price/lower panes, first-bar/reversal/viewport boundaries, gaps/live/history corrections,
MTP/drawings/cursor, hide/collapse/reorder/resize/restore и смене engine. Log zero/negative columns
используют native scale semantics; invalid native projections разрываются. Native linear tests не
доказывают log/inverted correctness или точное визуальное совпадение TradingView. Paint perf на
длинных runs и wide viewport требует browser measurement: reconcile O(all rows×outputs), draw
O(viewport×outputs), fill memory O(visible run). Cache, camera и data/history loading этим
изменением не управляются.
