# Осцилляторы и объём: математический пакет

База: `cac6d9a`, ветка `feat/ta-momentum-volume`. Импорт:
`src/model/technical-indicators/momentum-volume/index.ts`. Восемь функций не расширяют общий
registry и не означают доступность в UI/native. Статус metadata — `math-only`.

## API и валидация

```ts
momentum(source: NumericSeries, length = 10): NumericValue[];
roc(source: NumericSeries, length = 9): NumericValue[];
cci(source: NumericSeries, length = 20): NumericValue[];
williamsR(bars: readonly TechnicalBar[], length = 14, source?: NumericSeries): NumericValue[];
mfi(bars: readonly TechnicalBar[], length = 14): NumericValue[];
obv(bars: readonly TechnicalBar[]): NumericValue[];
accumulationDistribution(bars: readonly TechnicalBar[]): NumericValue[];
pvt(bars: readonly TechnicalBar[]): NumericValue[];
```

Все функции чистые и причинные, сохраняют длину входа, возвращают конечные числа либо null. Пропуски
— только null. NaN, Infinity, undefined и sparse arrays в потребляемых данных вызывают RangeError.
Объём должен быть неотрицательным. High ниже low отклоняется. Open, timestamps и непотребляемые поля
не проверяются и не меняются: порядок, временное выравнивание и источник баров принадлежат
вызывающему слою. Пользовательский source Williams обязан совпадать по длине с bars; отсутствие
source означает close. Для остальных source-функций caller выбирает нужный ряд: preset CCI
предполагает HLC3, сама функция получает уже выбранные числа.

Периоды целые 1..10000; для MFI 1..2000 как в актуальном встроенном скрипте. Максимум 10000 для
остальных — локальный защитный предел, не утверждение о максимуме Pine. Нулевой объём валиден и
потребляет окно, отсутствие объёма не заменяется нулём. Цены могут быть нулевыми и отрицательными;
на отрицательных ценах обычные экономические интерпретации MFI и границы 0..100 не гарантируются.
Цена close вне high/low не исправляется, значения осцилляторов не обрезаются.

## Формулы и gaps

| Ряд         | Формула                                                           | Минимальный dense warmup |
| ----------- | ----------------------------------------------------------------- | ------------------------ |
| Momentum    | source[t] − source[t−n]                                           | n+1                      |
| ROC         | 100 × (source[t]−source[t−n]) / source[t−n]                       | n+1                      |
| CCI         | (source−mean)/(0.015 × mean absolute deviation)                   | n                        |
| Williams %R | 100 × (source−highest high)/(highest high−lowest low)             | n                        |
| MFI         | 100 × positive flow/(positive flow+negative flow)                 | n+1                      |
| OBV         | cumulative sign(close−previous close) × current volume            | 2                        |
| ADL         | cumulative ((close−low)−(high−close))/(high−low) × volume         | 1                        |
| PVT         | cumulative (close−previous close)/previous close × current volume | 2                        |

- Momentum/ROC используют точные индексы баров. Null на любом из двух концов даёт null; пропуск
  между концами не изменяет расстояние. Нулевой previous source для ROC даёт null.
- CCI использует последние n non-null наблюдений; сам текущий null выводит gap и не потребляет окно.
  Mean deviation считается относительно среднего всего текущего окна, с делителем n. Нулевой mean
  deviation, включая n=1, даёт null.
- Williams требует полное positional окно из n high/low. Missing high или low делает все содержащие
  этот бар окна недоступными. Missing текущего source даёт null; предыдущий source для экстремумов
  не нужен. Нулевой диапазон даёт null.
- MFI использует HLC3, затем HLC3×volume текущего бара. Поток положительный при росте HLC3,
  отрицательный при падении; tie даёт нулевой вклад в обе суммы. Обе суммы охватывают n **соседних
  изменений**, поэтому требуется n+1 бар. Missing HLC3 портит изменения до и после пропуска; missing
  volume — текущий вклад. Неполное окно или любой неизвестный вклад внутри него даёт null.
  Положительный поток без отрицательного даёт 100, обратный случай 0, оба нулевые дают null.
  Начальный прогрев выбран консервативно; его совпадение с Pine execution не подтверждено.
- OBV/PVT на первом баре дают null; первый известный соседний вклад добавляется к внутреннему
  origin=0. При одинаковых close OBV сохраняет известную сумму. Нулевой previous close для PVT даёт
  null. ADL включает первый доступный бар, при high=low его вклад равен 0, как в опубликованном
  built-in; отсутствующие поля всё равно дают null.
- Для накопительных рядов missing вклад выводит null и сохраняет **только известную сумму**.
  Следующий доступный вклад продолжает эту сумму без догадок о пропуске. Null close не соединяется
  со следующим валидным close через разрыв: нужны соседние бары. Это не полная восстановленная
  кривая при пропущенной истории. Все абсолютные значения накопительных рядов зависят от начала
  поданного входа.

Ни один из этих контрактов не обещает полную parity на sparse Pine данных. Исполнение Pine, feed
parity и визуальное совпадение не проверялись. Optional SMA/Bollinger smoothing встроенных CCI/OBV
здесь не реализованы: проверяется основная линия. Встроенные объёмные скрипты могут бросать ошибку
на суммарном volume=0; чистый пакет принимает настоящие нулевые объёмы (OBV/PVT/ADL дают известные
нули, MFI при двух нулевых потоках даёт null). Runtime может отдельно сообщать о недоступности
источника объёма.

## Числа и сложность

CCI нормализует относительно масштаба цен и текущего source, чтобы избежать overflow суммы и
сохранить малые изменения на большом offset. ROC/PVT используют альтернативную относительную форму
при overflow вычитания. HLC3, Williams и ADL масштабируют значения перед потенциально
переполняющимся сложением/вычитанием. Накопление компенсированное. Непредставимый вклад даёт null и
не входит в известную сумму; overflow самой накопленной суммы оставляет последующие outputs null до
нового полного вызова. Это два разных случая, не скрытый reset.

MFI не может представить raw HLC3×volume, если произведение выходит за binary64; такой вклад
неизвестен до выхода из окна. Суммы потоков перестраиваются каждые n баров и после overflow или
резкой потери масштаба при удалении старого вклада. После выпадения проблемного окна расчёт
восстанавливается. Подпороговые произведения могут underflow в 0, стандартная точность binary64 не
является произвольной точностью.

Momentum/ROC и накопительные ряды — O(N). Williams использует monotonic deques: O(N), память O(n)
помимо выхода. MFI обычно O(N), память O(n) плюс HLC3 series; периодическая перестройка
амортизирована. При патологических чередующихся overflow/масштабах защитная перестройка MFI может
стоить O(Nn), n ограничено 2000. CCI сознательно O(Nn), память O(n), n ограничено 10000; миллионы
баров с максимальным CCI периодом не объявлены дешёвым сценарием. Тест 100000 баров для Williams
n=10000 и MFI n=2000 проверяет формулы начала и конца, без нестабильного лимита настенного времени.

## Metadata

`momentumVolumePresets` — frozen массив frozen объектов с title/shortTitle, defaultPane=pane,
defaultSource/defaultLength/minLength/maxLength, requiresVolume, status и reference. Defaults:
Momentum 10/close, ROC 9/close, CCI 20/hlc3, Williams 14/close, MFI 14/hlc3; накопительные ряды не
имеют length. ADL не имеет единственного source, OBV/PVT используют close.

`momentumVolumeMetadata(id,length?)` возвращает frozen warmup/history. Finite metadata использует
общий TechnicalHistoryRequirement с seedPolicy=window; warmup описывает плотную историю, а не
достаточное число fetched timestamps при gaps. CCI может требовать больше календарных баров. Для
накопления введён отдельный narrow тип CumulativeHistoryRequirement: kind=cumulative,
lookbackBars=null, seedBars=1 для ADL и 2 для OBV/PVT, seedPolicy=zero-before-first-contribution,
missingPolicy=gap-preserve-known-total, convergence=full-input-dependent. Общий enum shared types не
изменён и ложный EMA seed не указан.

## Первичные источники

Проверено 26.11.2026. Формулы и defaults прочитаны в официальной справке и публичных built-in Pine
исходниках. Код TypeScript написан самостоятельно; полные внешние исходники в Git не копировались.
Источники `last` изменяемые, ниже указаны проверенные версии.

| Источник                                                                                                                                                                                                     | Проверенные факты                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [Momentum v31](https://pine-facade.tradingview.com/pine-facade/get/STD%3BMomentum/last)                                                                                                                      | Разность source с source[n], length10/min1, close, отдельная панель             |
| [ROC v31](https://pine-facade.tradingview.com/pine-facade/get/STD%3BROC/last), [справка ROC](https://www.tradingview.com/support/solutions/43000502343-rate-of-change-roc/)                                  | Процентное изменение, length9/min1, close                                       |
| [CCI v40](https://pine-facade.tradingview.com/pine-facade/get/STD%3BCCI/last), [справка CCI](https://www.tradingview.com/support/solutions/43000502001-commodity-channel-index-cci/)                         | Константа .015, mean absolute deviation, length20/min1; preset HLC3 из built-in |
| [Williams v34](https://pine-facade.tradingview.com/pine-facade/get/STD%3BWillams_R/last), [справка Williams](https://www.tradingview.com/support/solutions/43000501985-williams-r-r/)                        | High/low экстремумы, default14, close, отрицательная шкала                      |
| [MFI v33](https://pine-facade.tradingview.com/pine-facade/get/STD%3BMoney_Flow/last), [справка MFI](https://www.tradingview.com/support/solutions/43000502348-money-flow-mfi/)                               | HLC3, raw money, directional sums, default14/min1/max2000                       |
| [OBV v39](https://pine-facade.tradingview.com/pine-facade/get/STD%3BOn_Balance_Volume/last), [справка OBV](https://www.tradingview.com/support/solutions/43000502593-on-balance-volume-obv/)                 | Накопление signed volume, close, tie без изменения                              |
| [ADL v30](https://pine-facade.tradingview.com/pine-facade/get/STD%3BAccumulation_Distribution/last), [справка ADL](https://www.tradingview.com/support/solutions/43000501770-accumulation-distribution-adl/) | Money flow multiplier и cumulative, high=low даёт нулевой вклад                 |
| [PVT v31](https://pine-facade.tradingview.com/pine-facade/get/STD%3BPrice_Volume_Trend/last), [справка PVT](https://www.tradingview.com/support/solutions/43000502345-price-volume-trend-pvt/)               | Накопление relative close change×volume, без дополнительного ×100               |

В CCI Help Center на момент проверки пишет default Close; актуальный built-in v40 использует HLC3.
Preset следует built-in. Написание `Willams_R` в URL — фактический официальный ID.

## Проверки

`node test/technical-momentum-volume.test.mjs` проверяет ручные рациональные ledger, flat, zero
base, zero/missing volume, high offset/extreme magnitude, overflow recovery, frozen inputs,
causality, defaults и invalid inputs. `pnpm typecheck`, scoped ESLint/Prettier и
`pnpm spec:validate` проверяют исходники и контракт. Build, server, браузер и native/UI этим пакетом
не запускались.
