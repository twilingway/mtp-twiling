# Primary formula evidence

Проверено 25.11.2026. Использованы только собственные материалы TradingView. Сторонние клоны, TA-Lib
и случайные community реализации не являются основанием формул или edge cases.

## Официальный Pine v6 Reference

Ссылки каждого определения находятся в data-only registry. Основной
[Pine v6 Reference](https://www.tradingview.com/pine-script-reference/v6/) загружает документацию
динамически: web reader показал только оболочку, поэтому текстово прочитаны публичные официальные
ресурсы, без браузера/авторизации/токенов:

- [Function payload](https://www.tradingview.com/static/bundles/11967.f052e1615089996eccf6.js).
- [English remarks](https://www.tradingview.com/static/bundles/en.66605.a376644de8252d21909b.js).
- [English function descriptions](https://www.tradingview.com/static/bundles/en.41280.e2a0384c9e88f1dd1d95.js).

Первый payload содержит examples EMA (seed первым source), RMA (seed SMA), BB (SMA±deviation),
population stdev и ATR через true range/RMA. Remarks различают na-skipping non-na observation count
у MA и bar-position lookback у extrema; biased по умолчанию true означает population. В проект не
скопированы payload, документация целиком или чужие исходники: реализованы формулы и собственные
тесты.

| Расчёт     | Primary pointer                                                                                                                                                                             | Что сверено                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| SMA        | [ta.sma](https://www.tradingview.com/pine-script-reference/v6/#fun_ta.sma)                                                                                                                  | Среднее length non-na наблюдений                                                 |
| EMA        | [ta.ema](https://www.tradingview.com/pine-script-reference/v6/#fun_ta.ema)                                                                                                                  | First-value seed и alpha2/(length+1), отличается от SMA seed                     |
| Wilder RMA | [ta.rma](https://www.tradingview.com/pine-script-reference/v6/#fun_ta.rma)                                                                                                                  | Начальный SMA и alpha1/length                                                    |
| RSI        | [Builtin STD;RSI](https://pine-facade.tradingview.com/pine-facade/get/STD%3BRSI/last)                                                                                                       | v47.0, open_no_auth, соседний change и приоритет zero-loss→100 перед zero-gain→0 |
| MACD       | [Builtin STD;MACD](https://pine-facade.tradingview.com/pine-facade/get/STD%3BMACD/last), [ta.macd](https://www.tradingview.com/pine-script-reference/v6/#fun_ta.macd)                       | v43.0, defaults12/26/9, EMA oscillator/signal; histogram difference              |
| Bollinger  | [ta.bb](https://www.tradingview.com/pine-script-reference/v6/#fun_ta.bb), [ta.stdev](https://www.tradingview.com/pine-script-reference/v6/#fun_ta.stdev)                                    | SMA basis и population sigma с multiplier                                        |
| ATR        | [ta.atr](https://www.tradingview.com/pine-script-reference/v6/#fun_ta.atr), [ta.tr(true)](https://www.tradingview.com/pine-script-reference/v6/#fun_ta.tr)                                  | True range с fallback при отсутствии previous close и Wilder smoothing           |
| Stochastic | [Builtin STD;Stochastic](https://pine-facade.tradingview.com/pine-facade/get/STD%3BStochastic/last), [формула](https://www.tradingview.com/support/solutions/43000502332-stochastic-stoch/) | v33.0, raw stoch→SMA K→SMA D; наш requested preset K smoothing3 указан отдельно  |

У generic ta.rsi Reference приведено отношение RMA без полного списка zero-denominator ветвей. Для
flat случая использован именно опубликованный builtin RSI, поэтому значение100 не угадано и не
заменено распространённым альтернативным50. Напрямую Pine runtime на edge fixtures здесь не
запускался; unit evidence доказывает наш явно записанный алгоритм, не все внутренние оптимизации
Pine и не равенство native движкам до их отдельной интеграции.

Дополнительные объяснения производителя:
[RSI](https://www.tradingview.com/support/solutions/43000502338-relative-strength-index-rsi/),
[ATR](https://www.tradingview.com/support/solutions/43000501823-average-true-range-atr/),
[EMA](https://www.tradingview.com/support/solutions/43000592270-exponential-moving-average/).
