# Дополнительные средние: контракт и источники

Основа: `6d5fbbf769c523d284a7e8ceaad1fc85bcebce84` (`0.3.16`), отдельная ветка
`feat/ta-moving-averages`. Импорт: `src/model/technical-indicators/averages/index.ts`. Это пакет
шести математических функций. Общие registry/runtime, native и UI здесь не изменены; статус presets
`math-only` не обещает доступность индикатора в графическом движке.

## API

```ts
wma(source: readonly (number | null)[], length: number): (number | null)[];
vwma(source: readonly (number | null)[], volume: readonly (number | null)[], length: number): (number | null)[];
dema(source: readonly (number | null)[], length: number): (number | null)[];
tema(source: readonly (number | null)[], length: number): (number | null)[];
hma(source: readonly (number | null)[], length: number): (number | null)[];
smma(source: readonly (number | null)[], length: number): (number | null)[];
```

Период — целое число 1..10000. Числа во входах должны быть конечными; NaN/Infinity, undefined и
sparse arrays отклоняются через RangeError. Для VWMA длины source/volume обязаны совпадать,
отрицательный volume отклоняется. Все функции сохраняют длину, не мутируют frozen input, не создают
timestamp и возвращают только finite number либо null. Порядок и timestamps остаются обязанностью
вызывающего source/runtime слоя. Нулевые цены и объёмы валидны, никакие shares/lots не выводятся из
цены и объём не пересчитывается в другие единицы.

## Формулы, seed и gaps

- **WMA:** веса 1..length по возрастанию давности от самого старого к самому новому наблюдению;
  делитель length×(length+1)/2. Берутся последние length non-null наблюдений. Сам исходный null
  возвращает null и не потребляет observation window.
- **VWMA:** сумма source×volume, делённая на сумму volume, по последним length совместно доступным
  парам. Нулевой объём потребляет окно. Missing source или volume не входит в окно и выводит gap;
  полностью нулевой denominator даёт null. Pairwise правило sparse входов намеренно явно отличается
  от независимого выбора окон в generic Pine выражении SMA(source×volume)/SMA(volume), если missing
  source/volume не совпадают. Полная parity sparse Pine VWMA не заявляется.
- **DEMA:** E1=EMA(source,n), E2=EMA(E1,n), результат 2×E1−E2.
- **TEMA:** E1/E2/E3 — три последовательных EMA одинакового периода, результат 3×(E1−E2)+E3. Обе
  функции используют существующий primitive EMA: первый non-null seed, alpha=2/(n+1). На пропуске
  source E1 удерживает значение, E2/E3 получают это реальное промежуточное значение и продолжают
  рекурсию. Только финальный вывод маскируется source gap. Это композиция primitive контрактов, без
  обещания Pine execution parity на sparse fixtures.
- **HMA:** WMA(2×WMA(source,half)−WMA(source,n),sqrt), где half=max(1,floor(n/2)),
  sqrt=max(1,floor(sqrt(n))). Это original Hull Integer convention; авторское усечение half и
  подтверждённый built-in floor sqrt не заменяются округлением к ближайшему. Null source и null
  внутреннего raw сохраняются как gap, не потребляют завершающее observation window. Для n=1
  предоставлено явное identity extension; public HMA preset имеет min2.
- **SMMA:** если предыдущий внутренний output null, взять текущий SMA(source,n); иначе обновить
  alpha=1/n. На dense данных это Wilder RMA с SMA seed. В опубликованном built-in отсутствие source
  сбрасывает recurrence в null, и следующий бар заново берёт SMA последних n валидных наблюдений.
  Поэтому SMMA реализован отдельно, существующий na-skipping RMA не изменён. При consecutive gaps
  literal previous-null branch может создать внутренний SMA seed на втором gap; финальная source
  mask продолжает возвращать null, а следующий valid бар использует этот внутренний seed.

Оконные суммы нормализуются по масштабу цен/весов, чтобы конечные входы не вызывали лишний overflow
произведения price×volume. Суммирование числителя компенсированное. Стабильные формы DEMA/HMA и TEMA
избегают умножения огромных равных значений до их вычитания. Непредставимый конечным number
результат становится null. WMA обновляет weightedNew=weightedOld−sumOld+length×new; VWMA обновляет
numerator/denominator добавлением и удалением пары. Ring buffer и monotonic maximum deques дают
обычный путь O(bars), память O(length) помимо выходов. Раз в length валидных наблюдений суммы
полностью перестраиваются за O(length), поэтому амортизированная сложность остаётся линейной.
Дополнительный защитный rebase возможен, когда максимум текущего окна становится более чем в миллион
раз меньше прежнего масштаба, либо denominator теряет положительность из-за округления. Такой
крайний fallback отделён от обычного пути. Если независимые price/volume scales вызывают underflow
промежуточного произведения, VWMA временно использует отдельный O(length) fallback с масштабом самих
взвешенных произведений. Это сохраняет, например, VWMA([1e308,1e−308],[1e−308,1e308],2)=2e−308,
вместо ложного нуля. При патологическом постоянном чередовании крайних масштабов этот защитный путь
может стоить O(bars×length); обычные данные идут через rolling engine. Все операции используют
только текущие и прошлые наблюдения. Задержка полного списка индикаторов в native/UI здесь не
измерялась.

## Metadata для подключения

`movingAveragePresets` — frozen массив frozen data-only объектов: id/title/shortTitle,
defaultPane=overlay, defaultSource=close, defaultLength/minLength/maxLength, requiresVolume,
status=math-only, reference. Он сериализуется без callback и не расширяет общий registry.
`movingAverageMetadata(id,length)` возвращает frozen `{defaultPane,warmupBars,historyRequirement}`.

| ID   | Default | Preset min | Minimum warmup | History requirement               |
| ---- | ------- | ---------- | -------------- | --------------------------------- |
| wma  | 9       | 1          | n              | finite n                          |
| vwma | 20      | 1          | n              | finite n                          |
| dema | 9       | 1          | 1              | recursive first-value EMA chain   |
| tema | 9       | 1          | 1              | recursive first-value EMA chain   |
| hma  | 9       | 2          | n+sqrt−1       | finite n+sqrt−1                   |
| smma | 7       | 1          | n              | recursive SMA seed, gap reseeding |

TEMA public built-in использует close без Source input; generic math API дополнительно допускает
другую явно переданную numeric source. SMMA default7 взят из текущего опубликованного built-in
v32.0, хотя Help Center описывает другой default9. HMA sqrt в таблице — целое max(1,floor(sqrt(n))).

Finite metadata использует
`{kind:"finite",lookbackBars,seedPolicy:"window", convergence:"exact-after-lookback"}`. Это
требование к числу наблюдений **без gaps**, не обещание достаточного fetch числа timestamp при
sparse data. Для рекурсивных рядов lookbackBars=null, convergence=full-input-dependent; seedBars=1
для DEMA/TEMA, n для SMMA. Seed policy — first-value-ema-chain либо sma-of-first-length
соответственно; SMMA повторяет SMA seed после reset. Warmup не является convergence padding. Расчёт
всегда использует весь поданный вход.

## Первичные источники

Проверено 26.11.2026. Использованы только публичные официальные Pine Reference/built-in тексты и
опубликованная оригинальная статья автора HMA. Браузер, аккаунты, токены, закрытые алгоритмы и Pine
execution не использовались; TypeScript написан самостоятельно. Целые payloads в Git не включены.

| Источник                                                                                                                                                    | Проверенный факт                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [Pine ta.wma](https://www.tradingview.com/pine-script-reference/v6/#fun_ta.wma)                                                                             | Linear weights, na ignored                                          |
| [Pine ta.vwma](https://www.tradingview.com/pine-script-reference/v6/#fun_ta.vwma)                                                                           | SMA(price×volume)/SMA(volume), na ignored                           |
| [Pine ta.ema](https://www.tradingview.com/pine-script-reference/v6/#fun_ta.ema), [ta.rma](https://www.tradingview.com/pine-script-reference/v6/#fun_ta.rma) | First-value EMA, SMA-seeded Wilder alpha                            |
| [WMA v31.0](https://pine-facade.tradingview.com/pine-facade/get/STD%3BWMA/last)                                                                             | Overlay, default9/min1                                              |
| [VWMA v32.0](https://pine-facade.tradingview.com/pine-facade/get/STD%3BVWMA/last)                                                                           | Overlay, default20/min1                                             |
| [DEMA v33.0](https://pine-facade.tradingview.com/pine-facade/get/STD%3BDEMA/last)                                                                           | Two EMA stages, default9/min1                                       |
| [TEMA v33.0](https://pine-facade.tradingview.com/pine-facade/get/STD%3BTEMA/last)                                                                           | Three EMA stages, default9/min1, close source                       |
| [HMA v28.0](https://pine-facade.tradingview.com/pine-facade/get/STD%3BHull%251MA/last)                                                                      | length/2 half expression, explicit floor sqrt, default9/min2        |
| [SMMA v32.0](https://pine-facade.tradingview.com/pine-facade/get/STD%3BSmoothed%251Moving%251Average/last)                                                  | Literal SMA/recurrent branch, default7/min1                         |
| [Alan Hull, original article](https://eisdownloads.com/hull_HMA.php)                                                                                        | Author/byline and Integer half/sqrt, sqrt30 remains5                |
| [Author site](https://alanhull.com/hull-moving-average)                                                                                                     | Live reader returned verification challenge; original article above |
| [TradingView HMA explanation](https://www.tradingview.com/support/solutions/43000589149-hull-moving-average/)                                               | Three WMA formula, without explicit rounding                        |
| [TradingView SMMA/RMA selection](https://www.tradingview.com/pine-script-docs/faq/techniques/)                                                              | SMMA (RMA) maps to ta.rma for generic smoothing                     |

Pine Reference reader показывает динамическую оболочку. Для текста справки прочитаны публичные
официальные
[function documentation](https://www.tradingview.com/static/bundles/11967.f052e1615089996eccf6.js) и
[remarks](https://www.tradingview.com/static/bundles/en.66605.a376644de8252d21909b.js): document
examples и связанный текст na, без извлечения внутренних вычислительных алгоритмов. WMA/VWMA/HMA
remarks говорят na ignored, но сами по себе не доказывают весь sparse plotting/weighting contract.
Авторское Integer half выбрано явно; built-in length/2 не содержит отдельного cast, а
[Pine v6 migration guide](https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/)
предупреждает о дробном integer division. Совпадение HMA на нечётных периодах с live Pine этим
пакетом не подтверждено.

## Проверки

`test/technical-averages.test.mjs` проверяет ручные рациональные WMA/VWMA/DEMA/TEMA/SMMA ledger,
линейные HMA n2/3/5/7/11, n1 identity, constant/zero, missing warmup и source/volume,
single/consecutive SMMA gap, высокие масштабы, finite/null invariant, frozen input, independent
calls и causality. Focused suite запускается без application build:
`node test/technical-averages.test.mjs`. Детерминированный complexity тест проверяет 100000 баров с
периодом10000: ровно10 periodic rebase и не более200000 push/rebase visits на каждый rolling engine,
включая закрытую формулу ramp. Дополнительно проверяется высокий offset1e12 и восстановление
tiny1e−308 после dominant1e308. Native parity, браузерная отрисовка и доступность всех встроенных ТА
в этот пакет не входят.
