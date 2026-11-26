# Native presentation Lightweight Charts

26.11.2026. Source-only реализация L2.1/L2.2 в отдельном WT `artifacts/ta-render-lightweight`, ветка
`feat/ta-render-lightweight`. База bridge `a2117a89431e8a2bace8f4441e0034baaf836344`; frozen shared
follow-up `bda56f79e64bf49e708d09c64c36219bc5774d0a` перенесён отдельным commit7c18363. Definition
metadata и registry не активированы; controlled результаты существуют только в unit tests.

## Native ресурсы и geometry

- На output остаётся одна native series. Cross и linebr используют LineSeries с finite numeric
  значениями, whitespace для настоящих null, lineVisiblefalse и отключёнными point/crosshair
  markers, animation и labels. Один owned primitive на plot, независимо от числа runs.
- Cross — отдельный ортогональный плюс без соединений/круга. Локальная CSS policy: радиус2+relative
  size, stroke width из resolved style. Точная Pine visual calibration остаётся G2.
- Linebr читает исходные индексы через shared presentationRuns. Null/coordinate hole разрывает путь;
  непоследовательные значения не соединяются. Numeric singleton получает квадратный горизонтальный
  cap длиной style.width CSS px. Это явная local paint policy до G2 review.
- Columns остаются native HistogramSeries. Per-bar colors вычисляет shared presentationColor,
  opacity применяется через lineColor. Explicit v1 color остаётся solid, в том числе старый default.
- На fill создаётся один primitive, attached к existing scalePlotKey series. Ни hidden anchor,
  body/direction, ни fill не создают дополнительных series или axis values. Shared follow-up
  выбирает carrier по toSeries/fromSeries; при null SDK firstValue projection может использовать
  другой existing plot того же instance/pane. Fake zero и новые scale inputs запрещены.

## Fills и шкала

Fill pane view имеет zOrder normal и рисует только drawBackground: installed LW5.0.9 сначала рисует
grid, затем все normal backgrounds, затем normal foreground/candles. Cross/linebr рисуют только
draw. Геометрия — closed polygons по paired contiguous runs. Firstbar/warmup/null/reversal masks не
восстанавливаются; одиночная пара имеет нулевую time area и не получает искусственную полбарную
ширину. Рисование ограничено pane bitmap clip, раздельными horizontal/vertical DPR ratios и
save/restore; compositing source-over, alpha включена в цвет.

Fill visibility независима от скрытия stroke. Если fill видим, existing carrier остаётся native
visible с finite numeric данными, но скрытый line stroke отключён; скрытые columns прозрачны.
Metadata autoscaleInfoProvider возвращает null для скрытого output, включая collapsed instance;
примитивы всегда возвращают autoscaleInfo=null. Когда нет видимого fill, hidden owner nativevisible
false. Так firstValue сохраняется для coordinate conversion, а hidden numeric carrier не расширяет
шкалу. При отсутствии любого usable owner coordinate series fill не рисуется, без подстановки цены.

Legacy definitions без presentation сохраняют прежний native путь. Снятие metadata пересоздаёт
только соответствующий owned output, удаляя прежнюю primitive/provider policy. Reconcile не создаёт
ресурсы на каждый segment; смена pane сохраняет series/primitive identity. Dispose явно отсоединяет
plot/fill primitives перед removeSeries и удаляет только собственные panes/series. Устаревший owner,
detached/disposed renderer и update после dispose не рисуют и не запрашивают native coordinates.

Paint делает binary search по visible time range с одним соседним индексом с каждой стороны, затем
visits только выбранное окно. Source compilation/setData остаются O(N); frame/heap/performance
budget этим source тестом не измерялся.

## Проверки и оставшиеся gates

Focused tests проверяют carrier options/данные, plus/cap/null masks, fill polygons/DPR/clip/layer,
down-only/all-null owner, hidden/fill visibility, columns palette/opacity/manual color, bounded
resources/pane move/remove/dispose и traversal100k source slots при узком viewport. Fixtures не
используются как реальные котировки.

Четыре проверки исполняют extracted **installed SDK methods** drawSources, autoscaleInfo provider,
autoscaleInfoImpl с настоящими PriceRangeImpl/AutoscaleInfoImpl и priceToCoordinate. Native raw
range/margins для flat/narrow controlled prices совпадает до/после декоративного fill/remove; hidden
owner даёт null. Это проверка алгоритмов pinned SDK с fake host/data, **не** actual DOM
createChart/paint/price-axis acceptance. SDK source читается из node_modules, в Git не копируется.

Whole-source strict host использует исходные flags и ровно один virtual app-version module с двумя
string exports, когда generated отсутствует; diagnostics не подавляются. Build/prepare-version,
package/version/assets, browser/Google/auth/server/network/publish не запускались.

Итоги на owned source: новые LW tests17/17, совместный source/native/compiler/bridge/style/panel
набор70/70, whole-source strict0 diagnostics, scoped ESLint0 warnings/errors, Prettier и
OpenSpec49/49 PASS. Production files217/372 строк, меньше500. Plain tsc/build не выдаётся за
successful host check.

```text
node --test --experimental-test-isolation=none test/ta-render-lightweight.test.mjs test/native-technical-renderers.test.mjs test/native-technical-geometry.test.mjs test/ta-render-contract.test.mjs test/ta-render-data-presentation.test.mjs test/technical-settings-style-preservation.test.mjs test/technical-pane-layout.test.mjs
node test/helpers/derived-interval-source.mjs --typecheck
node node_modules/eslint/bin/eslint.js src/charts/lightweight-technical.ts src/charts/lightweight-technical-primitives.ts --max-warnings 0
node scripts/spec.mjs validate --all --strict
```

G2/G3 browser paint, масштабы linear/log/inverted, crosssize/singleton calibration, сочетание с
MTP/grid/cursor и frame/heap budgets остаются открытыми в L2.3/Q. Source/mock и extracted SDK unit
tests не закрывают их. Native KLine, shared compiler/bridge, definitions/registry, persistence и
Drive в owned implementation commit не меняются.
