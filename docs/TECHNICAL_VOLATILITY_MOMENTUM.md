# Волатильность и импульс: математический пакет

База `b4b04d4`, ветка `feat/ta-volatility-momentum`. Импорт:
`src/model/technical-indicators/volatility-momentum/index.ts`. Восемь расчётов самостоятельны; общий
registry, каталог, UI, native, storage и allowlist не меняются. Статус presets — math-only.

## API

```ts
bollingerPercentB(source: NumericSeries, length = 20, multiplier = 2): NumericValue[];
bollingerBandwidth(source: NumericSeries, length = 20, multiplier = 2,
  expansionLength = 125, contractionLength = 125): {
    value: NumericValue[]; highestExpansion: NumericValue[]; lowestContraction: NumericValue[];
  };
historicalVolatility(source: NumericSeries, periodsPerYear: number, length = 10): NumericValue[];
awesomeOscillator(bars: readonly TechnicalBar[]): NumericValue[];
balanceOfPower(bars: readonly TechnicalBar[]): NumericValue[];
cmo(source: NumericSeries, length = 9): NumericValue[];
ultimateOscillator(bars: readonly TechnicalBar[], fastLength = 7,
  middleLength = 14, slowLength = 28): NumericValue[];
trix(source: NumericSeries, length = 18): NumericValue[];
```

Все функции сохраняют длину, не мутируют frozen input и используют только текущие и прошлые данные.
Выходы — конечные числа либо null; текущий missing источник не подменяется нулём. Периоды целые
1..10000. Это локальный предел ресурсов; публичные built-in обычно задают только min 1. Multiplier
для Bollinger — 0.001..50, как в актуальных built-in. Неизвестные значения — только null; NaN,
Infinity, undefined и sparse arrays в потребляемых входах вызывают RangeError.

OHLC-функции проверяют потребляемые поля и high>=low. Open нужен только BOP; volume и timestamp не
нужны ни одному из этих трёх OHLC расчётов. Непотребляемые поля не проверяются. Выравнивание,
сортировка timestamps, выбор price source, валидация целой свечи и feed принадлежат вызывающему
слою. Цены вне high/low не исправляются, готовые осцилляторы не обрезаются по условным границам.

## Формулы и прогрев

| Ряд                        | Проверенная основа                                     | Dense warmup   |
| -------------------------- | ------------------------------------------------------ | -------------- |
| Bollinger %B               | (source−lower)/(upper−lower), population SD, SMA basis | n              |
| BandWidth                  | 100×(upper−lower)/basis; highest/lowest за свои окна   | n              |
| Historical Volatility      | 100×population SD(log returns,n)×sqrt(periodsPerYear)  | n+1            |
| Awesome Oscillator         | SMA(HL2,5)−SMA(HL2,34), фиксированные периоды          | 34             |
| Balance of Power           | (close−open)/(high−low), без сглаживания               | 1              |
| Chande Momentum Oscillator | 100×(sum gains−sum losses)/(sum gains+sum losses)      | n+1            |
| Ultimate Oscillator        | 100×(4×ratioFast+2×ratioMiddle+ratioSlow)/7            | max(lengths)+1 |
| TRIX                       | 10000×change(EMA(EMA(EMA(log(source),n),n),n))         | 2              |

### Bollinger

Basis — SMA последних n non-null наблюдений, deviation — population SD с делителем n. %B возвращает
долю, а не проценты: upper=1, lower=0; значения вне диапазона допустимы. При нулевой ширине %B равен
null. BandWidth возвращает проценты и равен нулю при нулевой deviation и ненулевом basis; при
basis=0 он равен null. Отрицательный basis даёт отрицательный BandWidth, без изменения формулы.

Bandwidth содержит все три численных выхода публичного built-in: value, highestExpansion и
lowestContraction, с default 125 у обоих extrema. Extrema берут последние N позиций баров и
игнорируют null внутри такого окна, не растягивая его. Они доступны уже с первого известного BBW:
отдельные 125 баров для первоначального показа не требуются. На missing текущего source все три
outputs маскируются null; при валидном source, но неопределённом текущем value, extrema могут
сохранять известный экстремум из своего окна. Это явная локальная gap-маска, не обещание идентичного
Pine отображения gaps.

Для стабильности используются эквивалентные формы %B=0.5+(source−basis)/(2×multiplier×SD) и
BBW=200×multiplier×SD/basis в нормализованных координатах. Они не строят переполненные upper/lower
перед последующим вычитанием. На крайних масштабах это может отличаться от буквального выполнения
Pine выражения; execution parity не заявляется.

### Historical Volatility: обязательный контекст

Актуальный built-in v31 использует length=10, annual=365 и per=1, если timeframe intraday либо daily
с multiplier=1; во всех остальных случаях per=7. Его множитель равен sqrt(annual/per). Даже intraday
использует per=1: нельзя незаметно заменить это число количеством intraday баров за календарный год.

API требует явный periodsPerYear=annual/per: для повторения указанного built-in caller передаёт 365
для intraday/1D либо 365/7 для других таймфреймов. Автоопределения по timestamps нет; никакого
скрытого default 252 нет. Отсутствие параметра, ноль, отрицательное или неконечное значение вызывает
RangeError. Другой положительный конечный масштаб допускается как явный пользовательский выбор,
который уже не является указанным built-in preset.

Log return использует строго соседние положительные цены. Null, zero или отрицательная цена делает
текущий и следующий adjacent return неизвестными. Новое движение через пропуск не выдумывается. Для
SD берутся последние n валидных returns; gaps не потребляют observation window, а текущий
неизвестный return выводит null. Near-one отношение вычисляется через log1p, при overflow/underflow
отношения используется разность логарифмов: большой конечный log return не теряется только из-за
переполнения промежуточного price ratio.

### AO, BOP, CMO и UO

AO получает HL2 и две SMA, пропуская отсутствующие midpoint наблюдения; текущий gap даёт null.
Периоды 5/34 фиксированы, как в публичном built-in, хотя Help Center показывает пример с input.
Пакет возвращает численную гистограмму; цвета изменения и alert side effects не входят в API. BOP не
сглаживается; high=low даёт null, одинаковые open/close при ненулевом диапазоне дают 0.

CMO использует простые sums соседних gains/losses; это не Wilder smoothing. Актуальный built-in
default 9 отличается от общего описания периода 20 в справке. Flat окно даёт null, только gains дают
100, только losses −100. Локальный контракт требует n полностью известных соседних изменений.
Missing source/previous source или непредставимое изменение сбрасывает прогрев; новое окно начинает
накапливаться со следующего известного adjacent change.

UO определяет bottom=min(low,previousClose), BP=close−bottom, TR=max(high,previousClose)−bottom.
Каждый ratio — sum(BP)/sum(TR) своего периода. Периоды независимы: требование fast<=middle<=slow не
добавлено, поскольку его нет в public inputs. Первому бару и бару после отсутствующего previous
close не подставляется high−low fallback. Любой неизвестный BP/TR сбрасывает все три окна; нулевой
TR sum даёт null. Для CMO/UO sums вычисляются через эквивалентные средние одинакового числа вкладов,
избегая overflow общей суммы. Их консервативная recovery политика не объявлена sparse Pine parity.

### TRIX: важное отличие

Актуальный built-in v31 считает изменение тройной EMA логарифма цены, умноженное на 10000. Это не
100×percent ROC тройной EMA сырых цен, как можно предположить по общему описанию справки. Например,
при length=1 и ценах 1,e выход равен null,10000. Встроенный скрипт не имеет численной signal line,
поэтому отсутствующий signal не считается потерянным выходом.

EMA использует существующий first-non-null primitive, alpha=2/(n+1). Log допустим только для
положительного source. При log gap первая стадия удерживает state, следующие стадии получают это
промежуточное значение и продолжают рекурсию; финальный output на исходном gap маскируется null.
Следующий output использует adjacent изменение настоящего промежуточного EMA state. Плоский
положительный ряд после второго бара даёт 0, цена 1 допустима несмотря на log(1)=0: нулевого
denominator в этой формуле нет. Два бара — минимум для первого результата, не период сходимости; вся
поданная левая история влияет на результат.

## Числа, производительность, metadata

Общий новый rolling engine использует ring buffer, центрирование относительно anchor,
масштабирование, population central moment и компенсированную сумму для среднего. Он сохраняет малые
изменения на большом offset, обходит лишний overflow и восстанавливает малый масштаб после выхода
доминирующего значения. Monotonic deque отслеживает максимум масштаба. Полный rebase выполняется
периодически через n наблюдений и при резком падении масштаба/численной потере M2.

Обычная сложность O(N), память O(n) помимо возвращаемых и промежуточных series. Периодический O(n)
rebase амортизирован; патологически повторяющийся защитный rebase может дать O(Nn). Test budget для
100000 наблюдений/n10000 ограничивает количество учтённых операций, без ненадёжного лимита
настенного времени. Периоды ограничены 10000. Неустранимые потери точности binary64, underflow и
непредставимые результаты не обещают arbitrary precision. Конечные цены не гарантируют
представимость разности BP/TR/CMO; непредставимые вклады дают gap/reseed.

`volatilityMomentumPresets` — глубоко frozen массив data-only объектов: id/publicId/title,
shortTitle, defaultPane=pane, status=math-only, reference, verifiedVersion, defaults/limits,
outputs, omittedNumericOutputs и requiredContext/notes. Все численные линии built-in включены,
поэтому omittedNumericOutputs пуст. Метаданные не обещают цветовую или alert-интеграцию. HV явно
требует контекст periodsPerYear; его annual/per constants записаны отдельно от API.

`volatilityMomentumMetadata(id,periods?)` — frozen warmup/history. Неуместные periods отклоняются.
Finite lookback: n для %B, n+max(expansion,contraction)−1 для полного BBW extrema window, n+1 для
HV/CMO, 34 для AO, 1 для BOP, max(UO periods)+1. Это dense контракт: na-skipping windows могут
требовать больше timestamp history. Для TRIX history recursive, lookbackBars=null, seedBars=1,
seedPolicy=first-value-ema-chain, convergence=full-input-dependent; warmupBars=2.

## Первичные источники

Проверено 26.11.2026. Использованы официальные Help Center и публичные built-in Pine источники, без
аккаунтов или Pine execution. TypeScript написан самостоятельно; полные внешние скрипты в Git не
копировались. Ссылки last изменяемые; версии ниже соответствуют моменту проверки.

| Источник                                                                                                                                                                                                       | Проверенные факты                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [%B v36](https://pine-facade.tradingview.com/pine-facade/get/STD%3BBollinger_Bands_B/last), [справка %B](https://www.tradingview.com/support/solutions/43000501971-bollinger-bands-b-b/)                       | length=20, close, multiplier=2/0.001..50; fraction scale                |
| [BBW v34](https://pine-facade.tradingview.com/pine-facade/get/STD%3BBollinger_Bands_Width/last), [справка BBW](https://www.tradingview.com/support/solutions/43000501972-bollinger-bandwidth-bbw/)             | length=20, multiplier=2, проценты, обе extrema default 125              |
| [HV v31](https://pine-facade.tradingview.com/pine-facade/get/STD%3BHistorical_Volatility/last), [справка HV](https://www.tradingview.com/support/solutions/43000589145-historical-volatility/)                 | length=10, log returns, population SD, annual=365/per=1 или 7           |
| [AO v31](https://pine-facade.tradingview.com/pine-facade/get/STD%3BAwesome_Oscillator/last), [справка AO](https://www.tradingview.com/support/solutions/43000501826-awesome-oscillator-ao/)                    | фиксированные SMA5/34 по HL2                                            |
| [BOP v30](https://pine-facade.tradingview.com/pine-facade/get/STD%3BBalance%251of%251Power/last), [справка BOP](https://www.tradingview.com/support/solutions/43000589100-balance-of-power-bop/)               | несглаженное OHLC отношение, без пользовательских параметров            |
| [CMO v31](https://pine-facade.tradingview.com/pine-facade/get/STD%3BChande_Momentum_Oscillator/last), [справка CMO](https://www.tradingview.com/support/solutions/43000589109-chande-momentum-oscillator-cmo/) | simple directional sums, default 9/min 1, close                         |
| [UO v30](https://pine-facade.tradingview.com/pine-facade/get/STD%3BUltimate_Oscillator/last), [справка UO](https://www.tradingview.com/support/solutions/43000502328-ultimate-oscillator-uo/)                  | BP/TR с предыдущим close, периоды7/14/28, веса4/2/1                     |
| [TRIX v31](https://pine-facade.tradingview.com/pine-facade/get/STD%3BTRIX/last), [справка TRIX](https://www.tradingview.com/support/solutions/43000502331-trix/)                                               | length=18, close, triple EMA(log source), delta scale=10000, одна линия |

First-value EMA также описан в
[Pine reference](https://www.tradingview.com/pine-script-reference/v6/#fun_ta.ema) и существующем
документе `TECHNICAL_AVERAGES.md`. Sparse parity и визуальная проверка этими ссылками не
доказываются.

Динамический reference также проверен текстово через официальные
[function payload](https://www.tradingview.com/static/bundles/11967.f052e1615089996eccf6.js),
[English payload A](https://www.tradingview.com/static/bundles/en.66605.a376644de8252d21909b.js) и
[English payload B](https://www.tradingview.com/static/bundles/en.41280.e2a0384c9e88f1dd1d95.js). В
них подтверждены stdev biased=true по умолчанию, population divisor, na-skipping observation count и
first-source seed EMA. Полные payload не сохранены в репозитории.

## Проверки

`node test/technical-volatility-momentum.test.mjs` — ручные рациональные/log ledger, defaults,
flat/zero/gaps, freeze/causality, invalid input, extreme scales, deterministic work budget,
metadata/history/JSON. Дополнительно: TypeScript, scoped ESLint/Prettier, strict OpenSpec. Build,
server, браузер, push и merge в задачу не входят и не выполнялись.
