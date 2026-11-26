# Контракт отображения TA: исследование перед реализацией

26.11.2026. **Research/spec-only; runtime не изменён.** База
`5d569c394ee3d8730af12c665aa956f290b3245e`, ветка `docs/ta-render-contract-research`. Установлены
Lightweight Charts **5.0.9** и KLineChart **9.8.12** (`package.json:24–25`). Новых зависимостей нет.
Проект не доказывает Pine execution, browser parity или готовность выпуска.

## 1. Проверенные границы

- На базе 42 computed TA. Результат остаётся числовым: timestamps, series из number|null,
  warmup/history metadata (`src/model/technical-indicators/types.ts:159–174`).
- Definition/compiled output поддерживают только line/histogram и статический цвет
  (`types.ts:109–138`, `src/charts/technical-render-data.ts:14–26,58–79`). Это ограничение
  контракта, а не заключение о текущем изображении браузера.
- Пять math-only TA reviewed на `49bfcf77c9a5200f8bcaf6d70735bd167c500b5f`: sibling
  `../ta-trend-state-math/docs/TECHNICAL_TREND_STATE.md` и
  `src/model/technical-indicators/trend-state/*`. Независимый отчёт:
  `../trend-state-readonly-review.md:1–11,80–105` (вне этого Git). SAR/Supertrend здесь не
  зарегистрированы; TSI/KST/Fisher регистрируются отдельно. DPO unresolved и в count не входит.
- Numeric результаты/params прежних42, timestamps/nulls/history и persistent v1 shape сохраняются.
  Versioned **render-only** metadata расширяется намеренно и проверяется отдельно. Полный definition
  hash не запрещает новые metadata; numeric результат ради картинки не меняется.
- Прочитаны AGENTS, `.agents/skills/openspec-workflow/SKILL.md`, current inventory (только
  drawing-editing), active changes и schema instructions. Новый capability: ta-plot-presentation.

## 2. Первичные public Pine источники

Анонимный текстовый GET26.11.2026, SHA256 от UTF-8 поля source; полные source/bundles в Git не
копируются. `last` изменяемый. Процесс унаследовал отключённую TLS verification: retrieval не
является самостоятельной гарантией подлинности транспорта. SAR/ST hashes совпали также с независимым
review. Аккаунт, Chrome, cookies и credentials не использовались.

| Public source                                                                              | Версия | SHA256 source                                                      | Строки source                              |
| ------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------ | ------------------------------------------ |
| [PSAR](https://pine-facade.tradingview.com/pine-facade/get/STD%3BPSAR/last)                | 33.0   | `0b65333a9c928edf614ff55fb66654e0f66fa00a7fc57d7e2d590923df77350e` | 6–7: ta.sar, cross, blue                   |
| [Supertrend](https://pine-facade.tradingview.com/pine-facade/get/STD%3BSupertrend/last)    | 12.0   | `0c4115d2b12d1a3eb07c12bbc44e9dd99eaded6019781a40115be066311c42e3` | 7–15: firstbar, linebr, hidden body, fills |
| [MACD](https://pine-facade.tradingview.com/pine-facade/get/STD%3BMACD/last)                | 43.0   | `569525e80149118b5ef4c0fc29cca0799ca4927db15d8a1c751fdc16abd96679` | 24,27–29: four-color columns               |
| [PVO](https://pine-facade.tradingview.com/pine-facade/get/STD%3BVolume%251Oscillator/last) | 33.0   | `210ee697a01439ecb29e9761a02dd2ba68dd913a979b3542db4a57a2dd3c1994` | 23,26–28: та же palette                    |
| [AO](https://pine-facade.tradingview.com/pine-facade/get/STD%3BAwesome_Oscillator/last)    | 31.0   | `359c1a2a2b0eaf0df3af3c5e4f327d58b3ce736de97eb07bb225a43779f69158` | 3–5: разность с previous, два цвета        |

### SAR

Overlay на ta.sar: отдельные ортогональные cross (+), цвет #2962FF, без соединений. Source не задаёт
linewidth/join: defaults Pine — linewidth1, join=false. Для cross linewidth обозначает относительный
размер, а не CSS px. Предлагается `pine-relative:1`; общий профиль обоих engines переводит его в CSS
arm/stroke после калибровки. Точные пиксели пока не установлены. Autoscale учитывает конечные
видимые SAR значения; glyph может добавлять пиксельный margin, но не синтетические min/max/ноль.
Скрытый SAR scale не расширяет. См.
[Pine plots](https://www.tradingview.com/pine-script-docs/visuals/plots/).

### Supertrend

Overlay: upTrend при direction<0, иначе downTrend. Оба **linebr**, цвета Pine green #4CAF50 и red
#F23645 ([v6 constants](https://www.tradingview.com/pine-script-docs/visuals/colors/)). Linewidth не
задан: default1. bodyMiddle=(open+close)/2, display.none; value/direction остаются вычислительными
выходами. direction ±1 и hidden bodyMiddle не создают plots/axis/legend/crosshair values и не влияют
на autoscale. bodyMiddle нужен как fill anchor. См. display.none в
[plots](https://www.tradingview.com/pine-script-docs/visuals/plots/).

Первый dataset bar маскирует trend и bodyMiddle. Два fills идут bodyMiddle→upTrend/downTrend, цвет
направления, transparency90 (opacity0.1), fillgaps=false. Polygon строится только между соседними
индексами с двумя конечными anchors и неизменным направлением. При reversal старый polygon
закрывается на последнем известном центре старой ветви, новый начинается на первом известном центре
новой. Через null/смену направления/отсутствующий open fill не продолжается. Missing open скрывает
только body/fill, известный trend остаётся. Missing HLC использует reviewed math reset/warmup;
renderer seed не пересчитывает и цены не восстанавливает. Math маскирует первый бар каждого нового
сегмента; barstate.isfirst явно маскирует только первый dataset bar. Поэтому sparse parity
ограничена. См. [fills](https://www.tradingview.com/pine-script-docs/visuals/fills/) и
[bar states](https://www.tradingview.com/pine-script-docs/concepts/bar-states/).

### Цвета histogram

MACD/PVO source использует **columns** с шириной по bar spacing, а не Pine histogram с фиксированным
linewidth. Numeric output keys сохраняются; новый render descriptor задаёт columns/base0. AO тоже
использует columns.

| Правило                                                 | Цвет    |
| ------------------------------------------------------- | ------- |
| MACD/PVO h>=0 и h>предыдущего h                         | #26A69A |
| MACD/PVO h>=0 и h<=предыдущего h                        | #B2DFDB |
| MACD/PVO h<0 и h>предыдущего h                          | #FFCDD2 |
| MACD/PVO h<0 и h<=предыдущего h                         | #FF5252 |
| AO h−предыдущее h<=0, включая равенство при любом знаке | #F44336 |
| AO h−предыдущее h>0 при любом знаке                     | #009688 |

Ноль относится к nonnegative ветви MACD/PVO. AO не окрашивается по знаку. Current null не рисуется.
Предлагаемая sparse policy: сравнивать **непосредственно предыдущий слот**, не last-known. При
previous=null выбирать false-comparison ветвь Pine v6: MACD/PVO светлый teal при h>=0, red при h<0,
AO green. Это тестируемое локальное правило, а не измеренная sparse Pine parity;
first-known/after-gap требуют подтверждения. Math null masks ради цвета не меняются.
[Официальная справка AO](https://www.tradingview.com/support/solutions/43000501826-awesome-oscillator-ao/)
подтверждает change-based colors; равенства/missing branch видны в actual source expression.

## 3. Установленные API и выбранный проект

Пути ниже относительно read-only node_modules Junction к canonical dependencies. Строки относятся к
установленным версиям. Код библиотек и лицензии в Git не копируются.

| Доказательство                                           | Путь и строки                                                                  | Следствие                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| LW markers — circles; lineVisible                        | lightweight-charts/dist/typings.d.ts:3058–3109                                 | circles не заменяют SAR cross                              |
| LW custom series, priceValueBuilder/isWhitespace/destroy | тот же:1681–1725                                                               | fallback с дополнительными data/scale обязанностями        |
| LW primitive draw/drawBackground, zOrder                 | тот же:2105–2138,4625–4633                                                     | normal background подходит для fill; bottom ниже grid      |
| LW отдельные background/foreground проходы               | lightweight-charts/dist/lightweight-charts.development.mjs:9044–9048,9111–9129 | grid→normal backgrounds→normal foregrounds                 |
| LW autoscale от numeric bars независимо от lineVisible   | тот же:3307–3338                                                               | невидимая линия несёт scale, primitive рисует glyph/linebr |
| LW numeric items и walkLine                              | тот же:12354–12360,12397–12459; whitespace:10579–10595                         | whitespace сам по себе не гарантирует linebr               |
| KLine callback prev/current/next                         | klinecharts/dist/index.d.ts:977–1007; index.esm.js:995–1030                    | per-bar palette из соседних numeric rows                   |
| KLine draw boolean, figures/zLevel                       | index.d.ts:1027–1112                                                           | custom cross/fill без global chart closure                 |
| KLine line требует numeric current И next                | index.esm.js:7933–7987                                                         | null разрывает соседний segment; singleton требует browser |
| KLine negative z — destination-over                      | index.esm.js:7881–7910                                                         | fill под candles/positive lines; это не CSS z-index        |
| KLine grid последним — destination-over                  | index.esm.js:7510–7558,8893–8897                                               | grid ниже negative fill; native grid менять не нужно       |
| KLine calcRange читает figure keys без visible guard     | index.esm.js:10301–10324,10360–10369                                           | hidden anchors нельзя включать в figures                   |

Первичные docs:
[LW primitives](https://tradingview.github.io/lightweight-charts/docs/5.0/plugins/series-primitives),
[LW custom series](https://tradingview.github.io/lightweight-charts/docs/5.0/plugins/custom_series),
[KLine v9 indicators](https://v9.klinecharts.com/en-US/guide/indicator). Для недокументированного
порядка приоритет у installed source.

**LW:** owned LineSeries служит numeric carrier для SAR/linebr: lineVisible=false,
pointMarkersVisible=false, crosshairMarkerVisible=false, lastValueVisible=false,
priceLineVisible=false. Carrier visible только пока виден plot, чтобы сохранить autoscale. Owned
primitive рисует cross или linebr runs по исходным полным индексным массивам через
logicalToCoordinate/carrier.priceToCoordinate. Native filtered rows не определяют adjacency.
Предварительное правило singleton — нет segment; подтвердить Pine перед приёмкой. Число native
ресурсов ограничено; отдельная series на каждый segment не создаётся. Custom series — fallback при
доказанном lifecycle/performance ограничении primitive.

**LW fill:** normal primitive, polygon в drawBackground, draw пустой для fill-only view. Anchors
используют scale trend carrier, отдельной bodyMiddle series нет. Проход после native и bottom
calendar grid, до price/MTP/TA foreground. top primitive не используется, cursor остаётся выше.
Existing MTP back/front сохраняется (`src/charts/lightweight.ts:120–159`). Порядок нескольких TA
fills задаётся instance order; attach order сам по себе не считается долговечным контрактом.

**KLine:** SAR figure содержит только value для scale; custom draw возвращает true и рисует cross
без native line/circle. ST figures — видимые upTrend/downTrend; direction/bodyMiddle остаются в
runtime context/rows, исключаются из figures/tooltip. Native line adjacency применяется после actual
gap probe; fallback — общий indexed segment renderer. Fill companion: figures=[], calc пустой, draw
из owner context, zLevel=-3. Existing DRAWINGS(-2), MTP(-1) неизменны
(`src/charts/kline-drawing-indicators.ts:46–85`). Negative instances сортируются по возрастанию и
рисуются destination-over: ранний -3 fill ближе к цене, чем поздние legacy layers. Такое положение
требует MTP review. Линии positive; grid ниже всех. IDs стабильны на instance; registry names
переиспользуемые/ограниченные. Callbacks читают extendData, не захватывают chart. Сохраняются
существующие weak-settlement/dispose правила (`src/charts/kline-technical.ts:39–49,69–86`).

## 4. Предлагаемый typed контракт

Только runtime, если явно не указано иное. Sketch предназначен для review; shared types здесь не
изменены. seriesKey ссылается на result.series, длина каждого выхода равна timestamps. Runtime graph
восстанавливается из definition+instance+numeric data.

```ts
type ColorPolicy =
  | { kind: "solid"; color: string }
  | { kind: "palette"; id: "macd-sign-change-v1" | "ao-change-v1" };
type PlotGeometry =
  | { kind: "line"; gaps: "legacy" | "break" }
  | { kind: "columns"; base: 0 }
  | { kind: "cross"; size: { unit: "pine-relative"; value: number } };
interface RenderPlotV2 {
  id: string;
  seriesKey: string;
  geometry: PlotGeometry;
  color: ColorPolicy;
  width: number;
  lineStyle: "solid" | "dashed" | "dotted";
  opacity: number;
  visible: boolean;
  scale: "include-when-visible";
}
interface RenderFillV2 {
  id: string;
  fromSeriesKey: string;
  toPlotId: string;
  color: string;
  opacity: number;
  visible: boolean;
  gaps: "break";
  layer: "above-grid-below-price";
  scale: "none";
}
interface RenderDefinitionV2 {
  renderVersion: 2;
  plots: readonly RenderPlotV2[];
  fills: readonly RenderFillV2[];
  internalSeriesKeys: readonly string[];
}
type ColorModeV2 = { kind: "default" } | { kind: "solid"; color: string };
interface PersistedPlotStyleV2 {
  colorMode?: ColorModeV2;
  width?: number;
  visible?: boolean;
  opacity?: number;
  lineStyle?: "solid" | "dashed" | "dotted";
}
interface PersistedFillStyleV2 {
  colorMode?: ColorModeV2;
  visible?: boolean;
  opacity?: number;
}
```

TechnicalOutputDefinition и42 numeric results остаются допустимыми. Typed descriptor рядом с numeric
definitions разрешает defaults централизованно, без ID hardcode в adapters. Без descriptor compiler
сохраняет legacy mapping. Новые MACD/PVO/AO columns/palette descriptors намеренно меняют
отображение: это отдельный snapshot, numeric fixtures не переписываются. Cross/linebr/fill —
renderer metadata. ST plots ссылаются на upTrend/downTrend;
internalSeriesKeys=[value,direction,bodyMiddle], fill bodyMiddle→up/down opacity0.1. У fill нет
series/axis/legend entry. SAR использует value без fill. Некорректный graph/длины отключают только
этот instance с diagnostic, не весь chart. Fill разрешён только при visible instance, собственном
visible fill и видимом toPlot; скрытие trend скрывает его fill. Это не меняет defaults остальных
plots. RenderDefinitionV2 содержит разрешённые render defaults; compiler создаёт effective runtime
styles после разрешения persistent patches.

Per-bar цвета существуют только в памяти; hex+opacity объединяются один раз. Computed colors,
geometry, функции, canvas, chart APIs, WeakRef, cached arrays и callbacks не входят в
instances/backup. Coordinate cache сбрасывается при range/scale/resize/DPR/data/pane/style revision;
math cache остаётся по definition+params+полный вход и не зависит от viewport.

### Default/custom и миграционная граница

Старый form создаёт styles с defaultcolor каждого выхода и отправляет их даже при period-only edit
(`src/screens/terminal/TechnicalIndicatorSettings.tsx:53–65,102–110`). Сохранённый defaultcolor не
раскрывает намерение. **Безопасная v1 policy:** нет style → descriptor auto palette; любой явный v1
output style.color → solid этого цвета, даже равного старому default. Width/opacity/visibility
сохраняются. Reset к default должен быть явным; эвристика по равенству цвета запрещена.

Предлагаемая будущая persistent instance v2, после отдельного review: сохранить
ID/definitionId/params/pane/order; per-output style задаёт tagged
`colorMode: {kind:"default"}|{kind:"solid",color:hex}`, optional width/opacity/visible/lineStyle;
отдельные fillStyles по объявленным fill IDs. Cross size сначала использует existing width1..4 как
относительный Pine размер с корректным названием UI; больший диапазон требует нового validator. Все
tags — JSON scalars; defaults разрешаются при render, resolved palette не сохраняется. Новые v2 поля
не добавляются в schemaVersion1.

Один migration owner атомарно меняет union/exact-key validator, settings/actions, JSON
export/import, portable/storage paths и Drive whitelist с сохранением v1 reader. Текущие границы:
`instances.ts:9–23,34–48,50–113`, `src/model/backup-format.ts:239–240,372–397`,
`src/model/types.ts:231–232,311`, `src/services/drive/backup.ts:49–59,140–143`. Drive whitelist
независим от TypeScript: правка только types теряет поля. Validation не пишет данные; unknown
versions/keys, accessors/prototypes, invalid fill IDs и non-finite numbers отвергаются до import.

Альтернатива без v2: reset удаляет целый v1 output style, теряя независимые width/visibility edits.
Это допустимо только как явно выбранный ограниченный scope. Предпочтительный v2 сохраняет эти edits.
Old readers не обязаны читать v2; export version/old-reader/rollback policy требует product
approval. Текущий top-level backup schema1|2 относится к envelope и не решает эту задачу
автоматически. В исследовании миграция не применяется.

## 5. Владение и зависимости

Все пути ниже — будущие изменения, относительно src, если не указано иное. Research владеет только
этим документом и openspec/changes/ta-render-contract/**. Shared файлы меняет один integrator;
native владельцы ждут замороженный contract и не редактируют их параллельно.

Имена новых файлов заранее закреплены: C — `model/technical-indicators/presentation.ts` и
`test/ta-render-contract.test.mjs`; L — `charts/lightweight-technical-primitives.ts` и
`test/ta-render-lightweight.test.mjs`; K — `charts/kline-technical-geometry.ts` и
`test/ta-render-kline.test.mjs`; P — `test/ta-render-persistence.test.mjs`; R —
`model/technical-indicators/trend-state-definitions.ts` и
`test/technical-trend-state-registry.test.mjs`. Пути test относительно корня. C единолично
интегрирует shared `definitions.ts`, `runtime.ts`, `index.ts` этого model namespace; R передаёт
mapping/output contracts текстом. Q владеет только `docs/review/ta-render-qa-<candidateSHA>.md` и
своей новой папкой evidence вне production source.

| Владелец                     | Исключительные будущие пути                                                                                                                  | Зависимость               | Доказательство                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------- |
| C: contract integrator       | model/technical-indicators/types.ts, definitions metadata, новый presentation module, charts/technical-render-data.ts                        | решения G                 | numeric42 и graph tests                |
| P: persistence/UI integrator | instances.ts, backup-format/import/export, model/types.ts, services/drive/backup.ts, storage integration, TechnicalIndicatorSettings/actions | C + G5 approval           | strict v1/v2 JSON/Drive roundtrip      |
| L: LW renderer               | charts/lightweight-technical.ts, новый lw TA primitive module, собственные tests                                                             | C                         | cross/linebr/fill/scale/dispose        |
| K: KLine renderer            | charts/kline-technical.ts, новый kline TA geometry module, собственные tests                                                                 | C                         | callbacks/segments/fill/async teardown |
| R: registry integrator       | новые trend-state definitions/runtime/catalog; shared index через C                                                                          | C + reviewed math + L + K | только intended definitions/count      |
| Q: integration review        | test fixtures и новые QA evidence paths                                                                                                      | P,L,K,R                   | actual browser/MTP/performance         |

Graph: `G → C → {P,L,K}; {C,L,K,math} → R; {P,L,K,R} → Q → release-review`. R не регистрирует SAR/ST
обычными линиями, пока renderers не готовы. TSI/KST/Fisher могут регистрироваться независимо. Никто
не владеет production version/build/server/cache/credentials в этом исследовании. Новые агенты здесь
не запускаются.

## 6. Проверки перед будущей реализацией

Native tests по возможности source-only, по pattern `test/native-technical-fixture.mjs` и
`test/native-technical-renderers.test.mjs`, без production version preparation. Mock проверяет
options/ownership/input, но не доказывает paint библиотеки.

- Numeric42: заморозить enumerable result keys, params, timestamps, series
  keys/nulls/values/history. Новые render metadata проверять отдельно. SAR/ST expected — из reviewed
  math fixtures, не renderer.
- Palette: оба знака/ноль, рост/падение/равенство, first finite/current-null/previous-null/post-gap;
  absent styles и каждый explicit v1 color, включая old default. Цвета LW и KLine совпадают; старый
  period-only style остаётся solid.
- Geometry: два ортогональных strokes на finite SAR sample, ноль межбарных segments; direction/body
  создают ноль carriers/figures. ST `[up,up,null,down,down]`, singleton, частые reversals, missing
  open, dataset first/pre-ATR/restart/timestamp gap и один сосед за viewport. Проверять run/polygon
  vertices, отсутствие cross-gap triangles.
- Ownership: hide/show/remove/reorder, pane move/collapse, duplicates/last instance, dispose до
  async calc; stale callback не рисует/не воссоздаёт pane. Нет global chart/timer retention/fill
  leak. Style edit не пересчитывает math и не сбрасывает camera.
- Persistence после approval: старые bytes/shape неизменны, strict v1/v2 roundtrip, unknown keys/
  accessors/NaN/Infinity rejected; JSON+Drive whitelist fixture staging до записи. Runtime graph не
  сериализуется. Live Drive для проверки fixture не используется.

### Обязательная будущая actual browser matrix

Здесь **не выполнена**. Chrome DevTools MCP с isolated-ui-review worker/test profile; если
недоступен, Playwright в отдельном профиле. Обычный Chrome и credentials не затрагивать. Для каждого
кейса записать candidate SHA, engine version, fixture SHA, screenshot path и наблюдаемые пиксели.

| Engines/среда                                                               | Кейсы и результат                                                                                              |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| LW5.0.9/KLine9.8.12 desktop, light/dark, DPR1/2                             | размер/цвет SAR cross без линии; ST firstbar/reversal/gaps; все цвета palette                                  |
| Оба: linear/log где поддержано, inverted, zoom/pan                          | SAR даёт actual min/max; hidden body/direction не двигают scale; anchors используют engine conversion          |
| Оба: grid on/off, calendar timeframe, MTP160/440/640, drawings back/front   | grid→fill→price, прежние MTP bounds/lines/drawings, cursor выше, labels в своей оси                            |
| Оба: old42+SAR/ST, duplicates/lower panes/legacy volume                     | resize/collapse/move/scroll/legend/settings сохраняют camera/scale; remove очищает свои ресурсы                |
| Оба: narrow mobile/touch, resize/DPR change                                 | нет pane/axis bleed, pointer работает, alignment после settle в пределах одного device pixel                   |
| Публичный TradingView builtin на том же fixture без аккаунта, если доступен | cross relative1, singleton/caps, fill clipping и first-known palette; MTP-only screenshot не доказывает parity |

Performance: old42 baseline и плюс SAR/ST, 10k/100k bars, 1/10/100 instances, alternating reversals,
zoom/scroll/resize/last-bar update. Записать median/p95 frame work и heap/resource counts до/после
dispose на одном host. Предложенный budget: не более10% p95 regression неизменного old42 workload;
новый paint O(visible bars), O(N) compile только при data revision; нет native series на segment.
Budget требует review; benchmark PASS здесь не заявлен.

## 7. G-решения и недостающие доказательства

1. **SAR size:** доказан relative1, cross/blue. CSS arm/stroke ещё не откалиброваны; нужен pinned
   публичный reference, точные пиксели не выдумывать.
2. **linebr:** KLine source доказывает current→next adjacency; singleton/caps требуют paint. LW
   whitespace недостаточно, выбранный indexed primitive обходит эту зависимость. Отличия от TV при
   недоступном oracle описывать явно.
3. **Fill z-order:** installed traces подтверждают слоты; alpha/overlap/MTP/drawings/export требуют
   browser gate. Не переносить исходный MTP код ради удобства TA.
4. **Palette missing-data:** dense/default rules доказаны source; sparse first-known/post-gap Pine
   не исполнялись. Нужна явная приёмка локальной policy либо Pine oracle до слов exact parity.
5. **Persistent v2:** нужны approval совместимости, migration/backup version/old-reader/rollback.
   Tasks остаются gated; explicit v1 color solid, без equality heuristic и переписывания профилей.
6. **Render metadata:** одобрить renderVersion2 при frozen numeric42/instance shape. Это намеренное
   изменение представления; выполнение всех TradingView TA/alerts не заявляется.

## 8. Проверки исследования и ограничения

Выполнены read-only source inspection и anonymous public retrieval. node_modules — только Junction,
пакеты не менялись. Browser/server/build/typecheck/version preparation, network state changes, Drive
mutation, registry/runtime/UI implementation, push/merge/deploy не выполнялись. Scoped Prettier и
strict OpenSpec результаты фиксируются в verification.md этого change.
