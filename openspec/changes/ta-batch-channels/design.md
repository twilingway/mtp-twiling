# Design

Расчёты принимают OHLC и возвращают значения с индексами исходных свечей. Пропуск входа прерывает
локальное состояние затронутого расчёта. Параметры длин ограничены диапазоном 1–10000, медиана
использует ограничение объёма прямого окна. История для EMA, Wilder ATR и состояния Volatility Stop
влияет на последующие значения.

| Индикатор         | Параметры по умолчанию            | Выход и готовность                                                                         |
| ----------------- | --------------------------------- | ------------------------------------------------------------------------------------------ |
| Donchian Channels | Length 20, Offset 0               | Три ценовые серии и сдвиг, экстремумы по доступным свечам                                  |
| Envelope          | Length 20, Percent 10, Close, SMA | Три ценовые серии после окна SMA либо с первой цены для EMA                                |
| Median            | Median 3, HL2, ATR 14 × 2         | Медиана и EMA с первого полного окна, полосы после готовности ATR                          |
| Chande Kroll Stop | ATR 10 × 1, Stop period 9         | Два ценовых уровня после первого ATR; второе окно использует доступные уровни              |
| Volatility Stop   | ATR 20 × 2, Close                 | Уровень и признак направления после окна ATR; при развороте сбрасывается опорный экстремум |
| BBTrend           | Short 20, Long 50, StdDev 2       | Процентная гистограмма после обоих окон; текущий модуль проверяет цену Close               |
| Bollinger Bars    | Нет входных настроек              | Геометрия тела и фитилей на каждой полной свече                                            |

Дата и часовой пояс не участвуют в расчёте. Donchian передаёт смещение в свечах для отрисовки на
соответствующих позициях. Median даёт данные для заливки с двумя цветами между медианой и EMA.
Volatility Stop даёт направление для окраски без соединения сегментов на развороте. Bollinger Bars
требует примитива свечи с одинаковой шириной тела и обоих фитилей для обоих графиков. BBTrend
использует четыре цвета по знаку и движению относительно предыдущего столбца.

Для Envelope справка показывает расчёт 10% и SMA. Для Median и BBTrend справка задаёт формулы, а
таблица задаёт численные параметры для MTP. Для Volatility Stop выбран старт после появления ATR;
сверка каждого бара с текущим встроенным индикатором относится к интеграционной проверке.

- [Donchian Channels](https://www.tradingview.com/support/solutions/43000502253-donchian-channels-dc/)
- [Envelope](https://www.tradingview.com/support/solutions/43000502260-envelope-env/)
- [Median](https://www.tradingview.com/support/solutions/43000644897-median/)
- [Chande Kroll Stop](https://www.tradingview.com/support/solutions/43000589105-chande-kroll-stop/),
  [формула и параметры TA-Lib](https://ta-lib.org/functions/cksp.html)
- [Volatility Stop](https://www.tradingview.com/script/v9YZoIw1-Volatility-Stop/)
- [BBTrend](https://www.tradingview.com/support/solutions/43000726749-bbtrend/)
- [Bollinger Bars](https://www.tradingview.com/support/solutions/43000742575-bollinger-bars/)
