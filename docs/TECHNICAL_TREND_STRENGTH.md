# Сила тренда: самостоятельный математический пакет

База `de0f42d` — замороженная source .19. Пакет добавляет только
`src/model/technical-indicators/trend-strength/*`, отдельные тесты, документ и OpenSpec. Registry,
shared types/runtime/catalog, native/UI, Drive и версии не меняются. Статус metadata — `math-only`;
подключение в графики остаётся отдельной задачей.

## API и данные

```ts
aroon(bars: readonly TechnicalBar[], length = 14): {
  up: NumericValue[]; down: NumericValue[];
};
aroonOscillator(bars: readonly TechnicalBar[], length = 14): NumericValue[];
dmi(bars: readonly TechnicalBar[], diLength = 14, adxSmoothing = 14): {
  plusDI: NumericValue[]; minusDI: NumericValue[]; adx: NumericValue[];
};
adx(bars: readonly TechnicalBar[], diLength = 14, adxSmoothing = 14): NumericValue[];
vortex(bars: readonly TechnicalBar[], length = 14): {
  plusVI: NumericValue[]; minusVI: NumericValue[];
};
choppinessIndex(bars: readonly TechnicalBar[], length = 14): NumericValue[];
```

Все серии имеют длину bars, их индекс соответствует исходному бару. Вход и timestamps не изменяются,
новые бары/времена не создаются. Timestamp сортировку и перенос series к chart timestamps выполняет
caller; расчёты работают по позициям баров и не используют будущие значения.

Aroon использует только high/low, остальные функции — high/low/close. Open, volume и timestamps не
потребляются и не проверяются. Sparse arrays, undefined bars/consumed fields, NaN/Infinity вызывают
RangeError. Unknown поле представляется null. High ниже low отклоняется; для HLC функций известный
close за известной границей high/low также отклоняется. Отрицательные цены валидны при корректном
диапазоне. Volume не требуется и не восстанавливается из цены.

Все периоды целые 1..10000; верхняя граница — локальная защита ресурсов, не публичный Pine max.
Vortex имеет min=2 как в built-in. CHOP min=1 допускается как в публичном input, но при n=1 формула
неопределена и весь ряд равен null. Отдельный ADX принимает сначала diLength, затем adxSmoothing;
это явный порядок math API, а не порядок двух визуальных input controls скрипта.

## Формулы, прогрев и история

| Расчёт           | Численная формула                                         | Defaults       | Минимальный dense warmup    | History              |
| ---------------- | --------------------------------------------------------- | -------------- | --------------------------- | -------------------- |
| Aroon            | 100×(n−age(highest/lowest в n+1))/n                       | n=14           | 1, частичное начальное окно | finite n+1           |
| Aroon Oscillator | Up−Down                                                   | n=14           | 1                           | finite n+1           |
| DMI              | Wilder DM/TR ratios, fixnan DI; отдельная Wilder RMA DX   | DI=14 / ADX=14 | DI=15, ADX=28               | recursive full input |
| ADX              | тот же ADX выход DMI                                      | DI=14 / ADX=14 | 28                          | recursive full input |
| Vortex           | sum(abs(high−low[1]))/sum(ATR1), зеркальный VI−           | n=14, min=2    | n+1=15                      | finite n+1           |
| CHOP             | 100×log10(sum(ATR1,n)/(highest high−lowest low))/log10(n) | n=14           | n=14                        | finite n+1           |

### Aroon и граница tie evidence

Актуальный Aroon v33 вызывает highestbars/lowestbars с length+1 и делит age на length. Поэтому самый
левый бар на расстоянии n ещё участвует и может дать значение 0. Выбрано доступное частичное окно в
начале истории: первый известный high/low даёт соответствующее 100, без искусственного ожидания n+1
баров. Missing текущего high маскирует только Up, missing low — только Down; Oscillator требует оба.
Null внутри positional окна игнорируется и не растягивает его.

При равных экстремумах выбран наиболее свежий бар. Это явная локальная tie policy. Проверенный
официальный reference описывает offset экстремума и na-игнорирование, но не закрепляет правило
равенства; исполнение Pine на tie fixtures не запускалось. Поэтому unit test доказывает наш
заявленный контракт, а не Pine tie parity или точное cold/gap отображение.

Текущий Aroon Oscillator v4 импортирует TradingView/ta/11 и вычитает Up−Down. Официальный Help
Center подтверждает окно на один бар больше length; changelog библиотеки сообщает, что Aroon
приведён к встроенному индикатору начиная с v4. Код импортированной библиотеки v11 отдельно не
исполнялся. Реализация использует ту же подтверждённую формулу recency; это ограничение evidence
записано отдельно от подтверждённого n+1 окна.

### DMI/ADX: строгий первый TR и Wilder seeds

UpMove=high−previousHigh, DownMove=previousLow−low. +DM равен UpMove только если он строго
положителен и больше DownMove; −DM симметричен. Равные положительные движения дают оба нулевых DM,
внутренние бары тоже не выбирают направление. Это строгие ветви актуальных built-in, не произвольное
предпочтение стороны при равенстве.

Встроенные DMI/ADX используют **ta.tr**, эквивалентный ta.tr(false). Без previous close, включая
первый бар, TR неизвестен: high−low fallback здесь не применяется. Для TR, +DM и −DM используется
существующий pure RMA: alpha=1/diLength, seed — среднее первых diLength известных наблюдений. На
плотной истории первый DI возможен после diLength+1 баров.

DI=100×RMA(DM)/RMA(TR), затем fixnan сохраняет ближайшее реально известное прошлое отношение. При
нулевом TR начальное 0/0 остаётся null, никакой первоначальный DI=0 не выдумывается. Если DI уже был
известен, последующее неопределённое отношение сохраняет его. DX равен abs(+DI−−DI)/(+DI+−DI), а при
обеих нулевых DI равен 0: публичный скрипт подставляет в denominator 1 только при нулевой сумме,
числитель тогда тоже 0. ADX=100×RMA(DX,adxSmoothing), с отдельным SMA seed. Минимум для ADX —
diLength+adxSmoothing баров; default 28. Это seed minimum, не padding для «достаточной сходимости»:
вся поданная история влияет на результат.

Два разных flat случая намеренно не смешаны:

- При high=low=close на всей истории нет ни одного определённого DI, поэтому DI/ADX остаются null.
- При постоянных ненулевых high−low и неподвижных high/low прогретые DM/DI и ADX равны 0.

Локальный DM guard требует совместно известных соседних high/low. Первичные скрипты имеют раздельные
na guards, поэтому их поведение на асимметрично missing OHLC не объявлено совпадающим. Внутренние
RMA держат известное state на null, fixnan DI сохраняет прошлое отношение, и Wilder ADX продолжает
обрабатывать внутренний DX. Финальные outputs при этом маскируются null на missing текущего HLC,
неизвестном/переполненном raw TR или текущем adjacent DM. Первый бар после полного OHLC gap поэтому
также неизвестен, хотя внутренние state сохранены. Следующий доступный adjacent бар продолжает
реальное state, без фиктивных нулей и без полного reseed.

Отдельный ADX вызывает тот же подтверждённый численный pipeline и возвращает только adx series;
никакого другого EMA seed или другого диапазона smoothing у него нет.

### Vortex и CHOP: ATR1 включает первый диапазон

Здесь публичные скрипты используют ATR(1), то есть RMA(true range с fallback,1). На первом баре это
high−low, как у ta.tr(true). Внутренняя ATR1 стадия использует существующий RMA primitive и держит
последнее известное значение на null raw TR. Это отличается от строгого TR DMI.

Vortex VM+=abs(high−previousLow), VM−=abs(low−previousHigh). У каждого VM собственное окно последних
n известных наблюдений; denominator имеет отдельное окно n значений ATR1, как у math.sum в Pine. Для
избежания лишнего overflow суммы делятся через эквивалентное отношение средних одинаковой длины.
Null в numerator не подменяется нулём; из-за ATR1 hold окна на sparse данных могут охватывать разные
позиции. Текущий неизвестный VM/raw TR или missing HLC выводит null в соответствующем конечном VI.
Нулевой denominator тоже даёт null. VI может быть больше 1, поэтому обрезания по диапазону 0..1 нет.

CHOP использует positional high/low extrema длины n и сумму ATR1 последних n наблюдений. Чтобы сумма
и high−low не переполнялись до logarithm, применяется эквивалентная log форма:
log10(meanATR)+log10(n)−log10(span). Span вычисляется в нормализованных координатах. На n=1,
нулевом/неположительном ATR sum или нулевом span результат null. Постоянные ненулевые диапазоны дают
100; полностью нулевой постоянный диапазон даёт null. Gap/overflow финально маскируются, state
SMA/RMA не получает нулевых замен unknown inputs.

Число не ограничивается 0..100: буквальная публичная формула может превысить 100, когда большой true
range от предыдущего close входит в окно очень узких текущих свечей. Например, ATR sum=101 и span=1
при n=2 дают 100×log10(101)/log10(2). Справочное описание bound не заменяет формулу clamp.

Публичный CHOP имеет plot offset 0, с диапазоном −500..500. Он записан как presentation input, но
math API его не принимает и не сдвигает series: это сохраняет исходные индексы и не позволяет
перенести будущий результат в прошлую свечу. Для ненулевого offset визуальная parity не заявляется.

## Metadata, ошибки и сложность

`trendStrengthPresets` — глубоко frozen data-only массив из шести объектов с id/publicId,
title/shortTitle, defaultPane=pane, status=math-only, reference/verifiedVersion, defaults/limits,
requiredData, outputs, presentationInputs и parityLimits. Все численные выходы включены:
omittedNumericOutputs пуст. Source/gap/tie ограничения не означают готовность native/UI.

`trendStrengthMetadata(id,periods?)` возвращает frozen warmupBars, outputWarmup, historyRequirement
и alwaysUndefined. Для Aroon warmup 1 и lookback n+1 различаются. Для Vortex lookback n+1 учитывает
previous high/low/close. Для CHOP lookback также n+1: предыдущий close нужен для самого старого TR в
полном окне, хотя первая вычислимая точка уже возможна на n барах через first-bar fallback. На n=1 у
CHOP warmupBars=null, alwaysUndefined=true и явная причина; это потребуется честно обработать при
будущей регистрации, общий numeric warmup type не менялся.

DMI/ADX history — recursive, lookbackBars=null, seedBars=diLength+adxSmoothing,
seedPolicy=adjacent-change-wilder, convergence=full-input-dependent. Никакой произвольный конечный
fetch padding не обещает точную Wilder parity. Finite history описывает dense данные; na-skipping
windows могут требовать больше timestamp истории.

Конечные входы не гарантируют представимость разностей в binary64. Непредставимый raw TR/DM/VM
становится null; на таком affected баре финальный output gap. Внутреннее ранее известное state может
продолжаться по правилам RMA/fixnan/SMA, но это не восстановление неизвестной экстремальной истории.
Непредставимый final ratio становится null. Существующие SMA/RMA primitives сохраняют свои численные
пределы; произвольная точность, underflow parity и точное Pine overflow execution не обещаются.

Все обычные пути O(N), дополнительная память extrema O(n), промежуточные/выходные series O(N).
Aroon/CHOP используют monotonic deques, RMA/SMA — существующие rolling primitives. Большой fixture
100000 баров/n10000 проверяет независимые closed-form endpoints и warmup, не вводя нестабильного
лимита настенного времени. Он не является сетевым или браузерным benchmark.

## Первичные источники

Проверено 26.11.2026. Формулы и inputs прочитаны в публичных официальных built-in Pine scripts;
полные внешние тексты не скопированы в Git, TypeScript написан самостоятельно. Ссылки last
изменяемые; в таблице указаны версии, реально прочитанные при проверке.

| Источник                                                                                                                                                                                                                                                            | Проверенный факт                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [Aroon v33](https://pine-facade.tradingview.com/pine-facade/get/STD%3BAroon/last), [справка](https://www.tradingview.com/support/solutions/43000501801-aroon-indicator/)                                                                                            | default 14/min=1, highestbars/lowestbars(length+1), делитель length                                      |
| [Oscillator v4](https://pine-facade.tradingview.com/pine-facade/get/STD%3BAroon_Oscillator/last), [справка](https://www.tradingview.com/support/solutions/43000773004-aroon-oscillator/), [официальная библиотека](https://www.tradingview.com/script/BICzyhq0-ta/) | default 14/min=1, TVta/11 aroon Up−Down; Help устанавливает n+1, changelog v4 сообщает matching built-in |
| [DMI v34](https://pine-facade.tradingview.com/pine-facade/get/STD%3BDMI/last), [справка](https://www.tradingview.com/support/solutions/43000502250-directional-movement-dmi/)                                                                                       | default 14/14, strict DM competition, ta.tr, RMA, fixnan, zero sum branch                                |
| [ADX v32](https://pine-facade.tradingview.com/pine-facade/get/STD%3BAverage%251Directional%251Index/last), [справка](https://www.tradingview.com/support/solutions/43000589099-average-directional-index-adx/)                                                      | default 14/14, та же отдельная dirmov/ADX формула, одна линия                                            |
| [Vortex v31](https://pine-facade.tradingview.com/pine-facade/get/STD%3BVortex%251Indicator/last), [справка](https://www.tradingview.com/support/solutions/43000591352-vortex-indicator/)                                                                            | default 14/min=2, две VM sums / sum(ATR1)                                                                |
| [CHOP v32](https://pine-facade.tradingview.com/pine-facade/get/STD%3BChoppiness_Index/last), [справка](https://www.tradingview.com/support/solutions/43000501980-choppiness-index-chop/)                                                                            | default 14/min=1, log10 формула, offset 0/−500..500                                                      |

Динамический Pine Reference проверен через официальный
[function payload](https://www.tradingview.com/static/bundles/11967.f052e1615089996eccf6.js) и
English payloads [A](https://www.tradingview.com/static/bundles/en.66605.a376644de8252d21909b.js),
[B](https://www.tradingview.com/static/bundles/en.41280.e2a0384c9e88f1dd1d95.js): strict ta.tr, ATR
true-range fallback, Wilder RMA seed, na-skipping math.sum и fixnan previous-known behavior.
Highestbars reference не дал явного tie правила. Runtime Pine и browser не запускались.

## Проверки и дальнейшая регистрация

`node test/technical-trend-strength.test.mjs`: 17 тестов с ручными rational/log ledgers, DM
ties/seed/fixnan, initial TR, CHOP>100, gaps, frozen/causal/timestamp alignment,
scale/translation/reflection invariants, invalid/overflow inputs, defaults/metadata и большим
closed-form fixture. Дополнительно — source typecheck, scoped lint/format и strict OpenSpec.

Координатору предстоит добавить шесть definitions и точные public IDs, numeric output/style keys,
параметры diLength/adxSmoothing и length, history/warmup и явную политику CHOP length=1. Нужные
изменения сериализации/Drive и native/UI проверяются отдельно. Настоящий source commit не меняет 29
computed каталога .19 и не обещает реализацию всех TA.
