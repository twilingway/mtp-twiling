# Design

## Context

Входы используют принятые в MTP типы `NumericSeries` и `TechnicalBar`. Индекс элемента соответствует
исходному бару.

## Decisions

В позиционных окнах пропуск учитывается как бар без данных. EMA использует существующий первый
конечный seed. На самом пропуске результат остаётся `null`. Выход деления на ноль и числового
переполнения также `null`. Для прямых окон действует существующий вычислительный бюджет MTP.
Корреляция рассчитывается на центрированных данных, равные ранги усредняются.

| Индикатор                 | Входы и значения MTP по умолчанию                                                                                              | Выходы и минимум истории                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linear Regression Channel | Цена, 100 баров, верхнее и нижнее отклонения по 2                                                                              | `center`, `upper`, `lower`, только последнее окно. Полосы используют среднеквадратичное отклонение цены от fitted-линии. `length` баров. Отрисовка одним сегментом на полосу.                                         |
| RCI                       | Цена, 10 баров, сглаживание выключено. При включении период сглаживания 14, множитель BB 2. VWMA использует выровненный объём. | `rci`, `average`, `upper`, `lower`. RCI в пределах ±100, уровни −80, 0, 80. `length` баров до первого RCI. EMA начинает линию на первом определённом RCI, остальным MA нужны `smoothingLength` определённых значений. |
| RCI Ribbon                | Общая цена, периоды 9, 26 и 52                                                                                                 | `short`, `middle`, `long` прогреваются независимо. Уровни −80, 0, 80.                                                                                                                                                 |
| Trend Strength Index      | Закрытия, 14 баров                                                                                                             | Ряд Pearson в пределах ±1 после `length` баров. Для заливки пригоден знак значения. Отдельная запись от True Strength Index.                                                                                          |
| Mass Index                | High, low, EMA 9, сумма 25                                                                                                     | Безразмерный ряд после `sumLength` валидных последовательных отношений. Сходимость зависит от истории EMA.                                                                                                            |
| Ulcer Index               | Цена, 14 баров                                                                                                                 | RMS процента просадки. Первый результат после `2 × length − 1` баров.                                                                                                                                                 |
| Pring’s Special K         | Цена, сигнальные SMA 100 и 100                                                                                                 | `specialK`, `signal`. База после 725 баров, сигнал после `725 + firstSignalLength + secondSignalLength − 2` баров.                                                                                                    |
| Chop Zone                 | High, low, close. EMA 34 и диапазон 30 баров.                                                                                  | `angle` в целых градусах, `zone` от −4 до 4. Первый результат при полном диапазоне с двумя значениями EMA. Отдельная панель с цветными столбцами высотой 1.                                                           |

Регистрация использует общие цены текущего инструмента. Канал размещается на шкале цены, остальные
индикаторы из группы открываются в отдельных панелях. При новой свече канал пересчитывается в
пределах последнего окна. Выключенная сторона канала не имеет ни линии, ни заливки. Для Special K
окно SMA требует последовательных валидных ROC, а каждый ROC требует ненулевую базовую цену и
текущее значение.

Chop Zone использует высоту столбца 1 и отдельный ряд категорий для его цвета. Trend Strength Index
заливает область между кривой и нулём двумя цветами в зависимости от направления. У RCI независимо
выбираются режим сглаживания и его период. Для сортировки в RCI и RCI Ribbon бюджет учитывает длину
окна и сложность сортировки, для Trend Strength Index учитывает проходы по окну. При превышении
бюджета сохраняются параметры и отображается состояние слишком большого расчёта.

## References

- [TradingView Linear Regression](https://www.tradingview.com/support/solutions/43000644936-linear-regression/)
- [TradingView Rank Correlation Index](https://www.tradingview.com/support/solutions/43000765570-rank-correlation-index-rci/)
- [TradingView RCI Ribbon](https://www.tradingview.com/support/solutions/43000765571-rci-ribbon/)
- [TradingView Trend Strength Index](https://www.tradingview.com/support/solutions/43000730926-trend-strength-index/)
- [Donald Dorsey, The Mass Index, 1992](https://technical.traders.com/archive/display2.asp?mo=JUN&yr=1992)
  ·
  [Реализация StockCharts](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/mass-index)
- [TradingView Ulcer Index](https://in.tradingview.com/support/solutions/43000773115-ulcer-index/)
- [TradingView Pring’s Special K](https://ru.tradingview.com/support/solutions/43000773011/)
- [TakeProfit Chop Zone](https://indie-script.github.io/indicators/trend/built-in/Chop%20Zone/) ·
  [Altrady Chop Zone](https://www.altrady.com/charts/library/indicator/chop-zone)

## Risks / Trade-offs

Публичные страницы формул не всегда указывают стартовые настройки и обработку неполных данных.
Дефолты MTP указаны в таблице. Для сравнения с внешним графиком потребуется числовой и визуальный
smoke на общем наборе свечей.
