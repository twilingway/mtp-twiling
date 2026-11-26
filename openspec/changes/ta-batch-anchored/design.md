# Design

## Context

Расчёты используют общий `TechnicalBar` и численные ряды с `null` для пропусков. Показывать
неподтверждённый период или подставлять вес по умолчанию означало бы менять значения цены.

## Decisions

- Контроллер передаёт фактические UTC timestamps первых свечей периодов в миллисекундах и загружает
  историю до каждой отмеченной границы. Начало сессии, биржевой календарь и корпоративные события
  приходят от вызывающей стороны. Граница раньше загруженной истории не начинает расчёт.
- Обычный VWAP накапливает `hlc3` с весами объёма. Режим полос «Процент» использует процент от
  абсолютного VWAP, а режим «Стандартное отклонение» использует взвешенную по объёму дисперсию цен с
  начала периода. Численное совпадение полос с TradingView требует отдельной проверки.
- Auto VWAP оставляет один период. Автоопределение выбирает сессию, месяц, квартал, год или
  десятилетие по длительности текущего интервала. Варианты High, Low и Volume ищут экстремум в
  загруженной части указанного окна. При равенстве выбирается ближайшая к концу свеча.
- TWAP усредняет `ohlc4` по доступным свечам одинаковой длительности. Временной разрыв не добавляет
  вес последней цене. Для Visible Average Price `close` выбран как значение по умолчанию MTP.
  Среднее и координаты первой и последней видимой свечи передаются рендереру для горизонтали.
- Ишимоку использует полные окна High/Low 9, 26 и 52. Смещение 26 считает текущую свечу первой и
  соответствует 25 шагам по оси. Облако визуально проходит между Senkou Span A и B.
- Аллигатор использует общий SMMA от `hl2`, с длинами 13, 8, 5 и смещениями вперёд 8, 5, 3.
- Оба адаптера применяют `barOffset` только при отрисовке. Для положительных смещений нужен будущий
  участок оси времени. Настройки, регистрация, получение внешних границ и браузерная проверка входят
  в отдельную интеграцию.

## References

- [TradingView VWAP](https://www.tradingview.com/support/solutions/43000502018-volume-weighted-average-price-vwap/)
- [TradingView VWAP Auto Anchored](https://www.tradingview.com/support/solutions/43000652199-vwap-auto-anchored/)
- [TradingView TWAP](https://www.tradingview.com/support/solutions/43000692939-time-weighted-average-price/)
- [Nasdaq TWAP, приложение C](https://indexes.nasdaqomx.com/docs/Methodology_XNDXCR10.pdf)
- [TradingView Visible Average Price](https://www.tradingview.com/support/solutions/43000678766-visible-average-price/)
- [TradingView Ichimoku](https://www.tradingview.com/support/solutions/43000589152-ichimoku-cloud/)
- [Расчёт включительного сдвига Ишимоку](https://www.tradingview.com/chart/XAUTUSDT.P/QqMq66am-Is-Your-Ichimoku-Indicator-Plotting-the-Wrong-Displacement/)
- [TradingView Williams Alligator](https://www.tradingview.com/support/solutions/43000592305-williams-alligator/)
- [MetaQuotes Alligator, формула HL2](https://www.metatrader5.com/en/mobile-trading/iphone/help/chart/indicators/bw_indicators/alligator)
- [Overcharts VWAP, взвешенная дисперсия](https://www.overcharts.com/en/helpcenter/docs/vwap-volume-weighted-average-price/)
