# Relative oscillators — pure math only

Base: `f889aebb14b9b330913a73595aed11c39b7e5fcd`. Собственный WT
`artifacts/relative-oscillators-math`, branch `feat/relative-oscillators-math`. Только новый каталог
`src/model/technical-indicators/relative-oscillators` и собственные tests/docs/OpenSpec. Ни один
старый source/math/registry/UI/native/persistence файл не меняется. Нет регистрации, доступности в
библиотеке приложения, build, version generation или browser paint.

## Первичные wrappers

Анонимный verified-TLS GET 26.11.2026, Python default trust store, `CERT_REQUIRED`, hostname
verification, без proxy и insecure flags. Хеш относится к decoded UTF-8 `source`, а не JSON
envelope. `last` изменяемый; версия и SHA фиксируют прочитанный wrapper. Полный Pine source и
reference bundles не сохраняются. [Capture](RELATIVE_OSCILLATORS_PRIMARY_CAPTURE.json) содержит
только metadata.

| Точный public ID                                                                                                          | Version | SHA256                                                             |
| ------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------ |
| [STD;Stochastic_RSI](https://pine-facade.tradingview.com/pine-facade/get/STD%3BStochastic_RSI/last)                       | 33.0    | `1efda9937d6f197cefac02598b8fe6d53fd25aa004ca74fddf2d8038a0c2090e` |
| [STD;Relative_Vigor_Index](https://pine-facade.tradingview.com/pine-facade/get/STD%3BRelative_Vigor_Index/last)           | 32.0    | `21c618cff8c90a7825980363860abe2dc001160bbc7ca43e0ec793ed9db136f6` |
| [STD;Relative_Volatility_Index](https://pine-facade.tradingview.com/pine-facade/get/STD%3BRelative_Volatility_Index/last) | 37.0    | `0f62213d96162efdb39d87a4dcbebd60973002cbf9b15110d73d39acea243e99` |
| [STD;Coppock%1Curve](https://pine-facade.tradingview.com/pine-facade/get/STD%3BCoppock%251Curve/last)                     | 30.0    | `2964f27cca48f4ae0ccfa3eaa97c3ea2f6549400344208533be228cc93fdf255` |
| [STD;Bull%Bear%Power](https://pine-facade.tradingview.com/pine-facade/get/STD%3BBull%25Bear%25Power/last)                 | 7.0     | `d92b835970edc8fc513895ec5ebb1729ba82c52f06661462ba88100e7e3aed30` |

Все wrappers Pine v6, отдельная pane по умолчанию. Timeframe execution, `timeframe_gaps`, native
format/precision относятся к будущей интеграции. Чистые функции не resample свечи и не реализуют
отдельный Pine timeframe. `input.source` Stoch RSI локально ограничен восемью имеющимися
PriceSource; произвольный внешний indicator series не принимается.

## API и полные outputs

Импортировать собственный `relative-oscillators/index.ts`. `NumericSeries`, `NumericValue`,
`TechnicalBar`, `PriceSource` импортируются из прежнего types только как типы. Старые runtime math
helpers не вызываются и не редактируются. Каждая функция чистая, массивы выходов плотные
`number|null`, длина равна bars.length; нет timestamp sorting, dedupe, shift или подстановки свечей.

| Функция                   | Defaults и source inputs                                          | Возвращаемые ряды                       |
| ------------------------- | ----------------------------------------------------------------- | --------------------------------------- |
| `stochasticRsi`           | rsiLength14, stochasticLength14, smoothK3, smoothD3, source close | `{k,d}`                                 |
| `relativeVigorIndex`      | length10, offset0                                                 | `{value,signal}`                        |
| `relativeVolatilityIndex` | length10, offset0, maType SMA, maLength14, bbMultiplier2          | `{value,smoothing,upperBand,lowerBand}` |
| `coppockCurve`            | wmaLength10, longRocLength14, shortRocLength11; fixed close       | один NumericSeries                      |
| `bullBearPower`           | length13; EMA fixed close                                         | один NumericSeries, сумма bull+bear     |

Primary input minima: Stoch RSI все четыре периода min1; Vigor length min1; Volatility core length
min1. Vigor/Volatility offset целый −500..500. Volatility BB StdDev min.001/max50/step.5; step —
редакторский шаг, не требование кратности. Для smoothing length Volatility, трёх Coppock lengths и
Bull/Bear length wrapper не задаёт min/max; локальная граница 1..10000 явно отдельна. Source numeric
bounds доступны в `sourceInputBounds`, local bounds — в `localLimits`. Unknown options, null/arrays
вместо options object, неизвестные source/MA choices отклоняются.

`relativeOscillatorMetadata(id,options)` валидирует те же параметры без расчёта свечей, возвращает
deep-frozen defaults, actual parameters, exact public ID/version/SHA, outputs, requiredData,
requiresVolume, history, presentation и parityLimits. Ни одного hidden или omitted numeric plot нет.
Внутренние RSI/raw stochastic, bull/bear компоненты, directional EMA и stddev — формульные
промежуточные значения, не дополнительные plots. Static hlines/fills — source-only metadata.

## Формулы и presentation facts

**Stoch RSI:** RSI источника → нормирование текущего RSI относительно min/max RSI за stochastic окно
×100 → SMA K → SMA D. RSI использует отдельные RMA gain/loss; ненулевая gain с нулевой loss даёт100,
ненулевая loss с нулевой gain —0, обе0 —null. Нулевой stochastic range —null. При L>1 zero change
одинаково уменьшает обе RMA: прежнее RSI сохраняется точно, чтобы independent rounding не создавало
ложный range. Missing adjacent change также переносит опубликованное RSI без повторного деления
округлённых states; см. [P2 follow-up](TA_STOCH_RSI_INVARIANCE_FOLLOWUP.md). K `#2962FF`, D
`#FF6D00`; hlines80/50/20. Никакой дополнительной MA wrapper или offset нет.

**Relative Vigor:** четырёхпозиционный SWMA от close−open и high−low; независимые суммы L известных
значений, затем отношение. В реализации обе суммы делятся на одинаковое L и этот множитель
сокращается. Signal — SWMA полученного value. SWMA веса oldest→newest 1,2,2,1, делитель6. Colors
value `#008000`, signal `#FF0000`. Offset обоих plots лишь metadata; численные массивы остаются на
вычисляющих индексах. Параметра source нет.

**Relative Volatility:** population stddev close за length. Верхняя directional EMA получает0 при
change(close)≤0, иначе stddev; нижняя получает0 при change(close)>0, иначе stddev. Обе EMA имеют
**фиксированный14**, отдельного input для этого нет. Value —100×upper/(upper+lower), denominator0
даётnull. Equality относится к lower branch; при неизвестном change обе Pine v6 comparisons false,
поэтому обе ветки получают stddev. Это не фиктивная quote0: ноль здесь явный directional term.

MA choices exact: `None`, `SMA`, `SMA + Bollinger Bands`, `EMA`, `SMMA (RMA)`, `WMA`, `VWMA`. None
оставляет smoothing/bands целиком null. SMA+BB возвращает SMA(value,L) ± multiplier×population
stddev(value,L). Все остальные choices оставляют bands null. VWMA вычисляет отношение независимых
SMA(value×volume,L)/SMA(volume,L); missing/zero denominator —null. Volume нужен только этому choice.
Нет source input: только close. Offset относится **только к value**, MA/BB остаются без offset.
Value `#7E57C2`, smoothing `color.yellow`, bands `color.green`; hlines80/50/20, background
между80/20, BB fill только в BB mode. `display.none` smoothing inputs — status/data suppression, не
отсутствие редактируемых Inputs. Advanced fill/native controls этим пакетом не реализуются.

**Coppock:** recent-heavy WMA от суммы процентных ROC close за long/short lengths. ROC использует
точные индексы i−L, не последние L известных quotes. Zero/missing denominator даётnull; WMA skip-NA.
Один plot `Coppock Curve`; явного color в wrapper нет, цвет по умолчанию не выдумывается.

**Bull/Bear Power:** high−EMA(close,L) плюс low−EMA(close,L). **Один** plot `BBPower`, columns;
wrapper не рисует две линии bull/bear. Palette: value≥0 `#089981`, value<0 `#F23645`; hline0.
Palette только metadata: source package не подключает её к renderer/UI/JSON.

## Primitive evidence и точные локальные NA/startup правила

[Pine v6 reference](https://www.tradingview.com/pine-script-reference/v6/) — JS shell в текстовом
reader. Узкие описания и примеры прочитаны в официальных pinned
[function payload](https://www.tradingview.com/static/bundles/11967.f052e1615089996eccf6.js),
[English A](https://www.tradingview.com/static/bundles/en.66605.a376644de8252d21909b.js),
[English B](https://www.tradingview.com/static/bundles/en.41280.e2a0384c9e88f1dd1d95.js).
[Metadata-only witness](RELATIVE_OSCILLATORS_REFERENCE_CAPTURE.json) содержит verified-TLS hashes;
payload не сохранены. Character offsets в decoded string (не byte offsets): ta.ema485508,
ta.wma486847, ta.lowest492922, ta.highest493906, ta.stdev508289, ta.rma510521, ta.stoch521287,
ta.swma533810, math.sum482448.

English translation IDs подтверждают: `413143` default biased=true, `322213` population estimate,
`309834` известные non-NA наблюдения для stddev/sum/EMA/RMA, `221157` NA ignored для
stoch/highest/lowest/WMA, `472349` NA propagation SWMA, `98752` SWMA4 weights, `91823` stoch
formula. Reference examples задают EMA first-source seed, RMA SMA seed и population divisor N. Это
текстовые свидетельства определения primitives, **не выполненный Pine oracle**.

| Primitive           | Локальный контракт                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------- |
| SMA/WMA/stddev/sums | последние L non-null observations; до L null; null не вставляется, готовое окно переносится |
| EMA                 | first-known seed, alpha2/(L+1); null пропускается, state переносится                        |
| RMA                 | SMA первых L non-null observations, alpha1/L; null пропускается                             |
| SWMA                | ровно четыре соседних позиции, любые null →null                                             |
| ROC/change          | точный предыдущий индекс, null не заменяется старым известным quote                         |
| stochastic extrema  | последние L позиций, **partial startup**, null игнорируются                                 |
| undefined ratio     | null, без fallback0/50 и без denominator epsilon                                            |

**Не закрытый startup gate:** public reference remarks задают NA ignored для highest/lowest, но не
доказывают startup на неполном окне.
[Execution model](https://www.tradingview.com/pine-script-docs/language/execution-model/) описывает
первый L−1 бар highest как NA; это не позволяет молча объявить partial parity. Локальный тест
rsiLength1/stochasticLength10/K1/D1 возвращает первый K на index2; full-bar startup ожидал бы не
раньше9, full-known-RSI startup —10. Этот выбор явно локальный. Default14/14/3/3 сам по себе не
различает все возможные startup трактовки.

Legacy `calculations.ts` stochastic уже использует partial positional extrema; изменений и
доказанного нового дефекта legacy нет. Legacy RSI all-flat даёт100 через loss===0; этот пакет
использует null для0/0. Это boundary различие зафиксировано, не исправление старого witness и не
утверждение доказанной Pine runtime ошибки старого RSI. Pine execution fixtures нужны отдельно для
all-flat seed, sparse carry и threshold/float equality.

## History / first-ready

Индексы нулевые; таблица — минимально возможный dense index при ненулевых denominators и меняющихся
данных. Flat, missing, zero volume и zero ROC anchors способны отложить готовность навсегда. Display
offset не меняет math history.

| Kernel     | First possible index                                                                         | История                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Stoch RSI  | K=rsiLength+smoothK; D=K+smoothD−1; stochasticLength1 →оба null                              | recursive full input; default K17/D19                                                   |
| Vigor      | value=L+2, signal=L+5                                                                        | dense lookback L+6 для signal; sparse observation span не ограничен календарными барами |
| Volatility | value=L−1; L1 →null; EMA smoothing тот же index; SMA/RMA/WMA/VWMA/BB +maLength−1; None →null | directional EMA recursive full input; default9/22; VWMA нужен ненулевой volume sum      |
| Coppock    | max(long,short)+wmaLength−1                                                                  | dense lookback maxROC+wmaLength; sparse WMA span не ограничен                           |
| Bull/Bear  | 0 при известных HLC                                                                          | recursive EMA full input                                                                |

## Численная устойчивость и стоимость

Scalar хранит internal mantissa/exponent, включая exponent за пределами double: не runtime/persist
объект приложения, не backup shape. Публичный output — исключительно конечный double либо null. Это
позволяет делить отношения при промежуточном high−low>MAX, сохранять population SD ±MAX и subnormal
spread, сокращать противоположные большие terms. Реально непредставимый конечный output становится
null; underflow округляется к представимому double. Порядок устойчивых операций может отличаться от
Pine/последовательного double последними битами. Никакого глобального normalization по будущему
input: prefix causality сохраняется.

ObservationWindow — ring и segment tree: count, mean, weighted mean с весами1..L и population
central variance, без subtraction старой большой суммы. Update/query O(log L), память O(L),
recursive/SWMA/deque passes O(N). Deque compact bounded amortized. Полные result/intermediate
массивы O(N), bounded number passes. Модули production меньше500 строк.

Caps: 0..1,000,000 bars; period integer1..10000; на kernel до80,000,000 estimated visits до
выделения больших промежуточных массивов. Пусть V(L)=3ceil(log2L)+1:

- Stoch RSI: N×[8+V(K)+V(D)].
- Vigor: N×[8+2V(L)].
- Volatility: N×[10+V(core)+W×V(MA)], W2 для BB/VWMA, иначе1 (консервативно включая None/EMA).
- Coppock: N×[5+V(WMA)].
- Bull/Bear: N×5.

Visits — детерминированный admission proxy, не число CPU инструкций, не device budget и не timing
SLA. Например1M bars/core10000/BB MA10000 отклоняется cap. Все потребляемые поля валидируются;
неиспользуемые open/high/low/volume могут отсутствовать или быть невалидны, если kernel их не
читает. Consumed timestamp всегда finite; потребляемая volume nonnegative; если потребляются H/L,
high≥low; потребляемые O/C внутри известного диапазона. Null OHLC допустимы;
holes/undefined/NaN/Infinity —нет.

## Проверки и остающиеся gates

`node test/technical-relative-oscillators.test.mjs` —27 tests: отдельные рациональные RSI/SWMA/
population SD/ROC+WMA ledgers, все семь MA choices, 100 seeded random oracle fixtures, causal
prefix/append/correction, freeze/immutability, consumed fields, gaps, inactive outputs, offsets,
period/cost caps, MAX/subnormal/large-common-offset. Direct ordinary-double oracle независим от
production arithmetic/tree; random tolerance2e−11×max(1,|expected|), специальные extreme assertions
отдельные и строгие. Flat RSI decay задан аналитическим invariance, не epsilon repair.

`node test/technical-relative-oscillators-boundaries.test.mjs` сравнивает Git blob SHA каждого
старого tracked source, package/lock и fixtures с точным base. Whole-source:
`node test/helpers/channel-average-source.mjs --typecheck` (виртуальны лишь два строковых
app-version exports, если generated baseline отсутствует). Scoped ESLint/Prettier и strict all
OpenSpec выполняются без build/prepare-version.

До регистрации остаются независимое math review и Pine execution startup/NA/seed fixtures.
MTF/realtime/native rendering, offset carrier, MA/BB controls, advanced persistence и palette
активация этим source-only этапом не проверены и не заявляются.

Финальная source-проверка: новые numeric27 + boundary1 PASS; прежние core15 и channel-average88
PASS. Boundary witness: 340 прежних tracked файлов, включая70 файлов technical-indicators,
byte-identical base. Whole-source strict noEmit, scoped ESLint/Prettier и OpenSpec57/57 PASS. В
managed sandbox первый read-only `spawnSync git` получил EPERM; тот же witness повторён с
разрешённым unsandboxed execution и прошёл. Runtime/build/browser/сохранения не запускались.
