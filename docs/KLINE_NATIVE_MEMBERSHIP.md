# KLine: нейтральные неактивные native members

Source fix от `88d3509171fa4e690abec2267bdb8793d43813dd`, отдельный worktree
`artifacts/kline-inactive-precision`. Root release source/ledger, LW, математика, registry51,
params/styles/schema/Drive, версия и сборка не менялись. Новый browser gate здесь не запускался.

## Причина

Readonly eight-case evidence: `artifacts/ta-kline-inactive-precision-review`. Current KC owner и
fill были пустыми/hidden, но оставались IndicatorSeries.Price. Installed9.8.12 `YAxisImp.calcRange`
использует minprecision **всех** native instances, а optimalTicks и format используют maxprecision.
Empty figures/rows и visible=false не нейтрализуют metadata.

При fixed6/8 peer1.000001..1.000008 и chart precision2 скрытый KC расширял range
до≈0.960001..1.040008. При fixed6 peer и chart precision8 менялся axis format. Это отдельный P2 от
правильного поведения fill-only при отключённых scale contributors. Принятый контракт A сохраняется:
visible public plots участвуют в scale; fill:none и hidden internals собственного domain не создают.
Opacity0 с visibletrue остаётся настоящим contributor.

## Public native boundary

`kline-native-domain.ts` читает public getVisibleRange, getDataList, getPriceVolumePrecision,
getIndicatorByPaneId и getStyles. Native range перечисляет integer indices realFrom<=i<realTo; scan
ограничен пересечением с существующими data/values arrays. Отрицательные/virtual slots не становятся
values. Eligibility требует visible public plot и хотя бы один finite value в этом **текущем**
диапазоне. Math/cache/timestamps/nulls не обрезаются viewport-ом.

Neutral precision берётся из действующего диапазона precision настоящих visible finite sources:

- Owned planned public outputs используют semantic native-price/legacy-fixed6 policy.
- Foreign peers читаются по actual public metadata/result/figures; hidden/empty decorators не
  становятся candidates. Price series не принимается за доказательство unlocked autosync: explicit
  precision может навсегда поставить internal lock, которого public getter не показывает.
- Main candles/area добавляют текущий действительный candle domain и price precision.
- Все собственные native names исключаются из foreign scan; декоративные роли не заимствуют друг у
  друга. Если действующих источников нет, data-free Normal0 сохраняет пустую pane.

Выбранный min существующих precision уже принадлежит настоящему contributor, поэтому не меняет ни
native minprecision, ни maxprecision. Normal0 обозначает только metadata пустой layout role: это не
цена0, не scale figure, не min/max bound и не новая серия котировок.

## Native roles и lifecycle

`kline-native-members.ts` содержит извлечённый прежний descriptor/row/native resource код. Active
families сохраняют прежние имена/registration: native-price owner+companion не получают explicit
precision и наследуют6→8→6; legacy families сохраняют explicit6. Ни geometry, ни computed arrays не
меняются.

Когда eligible public plots нет, primary и fill переходят в отдельные Normal IDLE families с
заимствованной precision, calc=[] и figures=[]. Primary сохраняет прежний positive z и draw для
reference levels; отдельный fill сохраняет negative z и context anchors. Поэтому видимый all-null
RSI с другим законным peer не теряет levels, а plot-disabled KC может рисовать independent fill на
шкале другого peer. Whole hide/collapse маскируют их прежним compiler contract.

Create-before-remove сохраняет последнюю pane, её DOM identity и высоту при переходах active↔idle.
Новая active instance нужна для сброса precision-lock; idle definitions с одним ID могут менять
semantic policy без duplicate регистрации той же idle family. Families ограничены шестью наборами
по100 slots, освобождаются/переиспользуются только свои slots.

Новые lifecycle contexts на role replacement помечают старые disposed без изменения numeric rows.
Logical remove/dispose сохраняют прежнюю очистку refs. Weak epoch callbacks не держат chart и не
публикуют retired work. Reentrant update сохраняет только последний план; staged creations входят в
dispose cleanup. Guards выставляются до public native mutation.

## Metadata refresh и стоимость

`refreshNativeMetadata():void` синхронно читает актуальные public precision/domain и меняет только
member metadata/roles. Единственный forwarding hunk в `kline.ts` вызывает его сразу после actual
setPriceVolumePrecision и до setStyles, без setData/camera/prefs/math writes. Это покрывает
locked/unlocked foreign Price peers.

Один owned listener на OnVisibleRangeChange и один на OnDataReady coalesce в один RAF. На неизменном
range собственная eligibility memo по plan identity + exact index bounds не читает numeric arrays
повторно; price-only refresh использует memo. Новые data/style plans сбрасывают eligibility. При
новом viewport scan идёт только по видимым slots до первого finite значения, без полного rebuild
rows или formula calculation. Same-role/metadata signature не вызывает повторных native writes.

Worst-case нового viewport — O(visible slots × public outputs/native peers); дополнительные full
array indices/anchors и approximate/capped eligibility не вводились. Внешние public SDK изменения
foreign peers вне app lifecycle требуют explicit refresh после завершения их native calc; SDK не
даёт отдельного generic indicator-change action.

Bounded helper-only cost diagnostic лежит в sibling
`ta-kline-inactive-precision-fix-qa/visible-scan-cost.json`:100 all-null queries, changed viewport
500 slots ≈0.07–0.16ms median;10k visible≈1.40ms;100k visible≈11.69ms на текущем окружении. Это
исключает math/rows/native rendering и не доказывает full G6/frame/heap budget: использован один
shared null array, три runs, порог производительности не согласовывался.

## Проверки и границы доказательства

`test/kline-inactive-precision.test.mjs` использует actual installed native ChartImp
create/override/ remove, IndicatorStore и YAxis calcRange/optimalTicks; DOM/clock/viewport/canvas
являются controlled boundaries. Входы обозначены LAB, не котировки. Native SDK hash проверяется
existing pinned fixture.

- Первые8 case regressions сравнивают fixed6/8 × price2/6/8, whole hide, plots disabled/fill
  visible, collapse, remove и sync2→8→2. Peer rows/precision/range/axis text/pane identity совпадают
  с baseline **тех же dimensions**; collapsed baseline отдельно имеет30px, как требует layout.
- Exact88d readonly blob `84a23c0c9843ec4c328bf2e19b6c67465c299af2` через --baseline-88d
  даёт5FAIL/3PASS: negative defect cases и control cases различаются. Initial Node→git spawn EPERM
  не считался результатом: повтор использовал проверенный readonly blobfile через
  KLINE_INACTIVE_BASELINE_SOURCE.
- Остальные tests проверяют locked/unlocked Price peers, active ST+legacy, future fixed2 lab peer,
  opacity0 inheritance, current-index offscreen/null transitions, reference levels, fill geometry,
  empty pane/peer join/no borrowing cycle, metadata memo/noop/reentry, retired async work и dispose.
- Camera/geometry/capture/compact-hover и прежние native suites проверяются отдельно; существующие
  partial SDK fixtures без новой public surface сохраняют controlled compatibility path. Они не
  заменяют full public-boundary regressions этого fix.

Команды/итоговые counts и limits приведены в change verification и own QA manifest. Full app
build/version/deploy, browser/mobile pixels и exhaustive performance budget не запускались. После
независимого source review root выполняет fresh actual PRODUCT gate на integrated source: mixed
lower peer range/axis, precision2↔8, hide/collapse/reveal/remove/reorder, fill-only opacity0,
mobile, camera/pane heights и disposal. Этот source fix сам публикацию.24 не разрешает.
