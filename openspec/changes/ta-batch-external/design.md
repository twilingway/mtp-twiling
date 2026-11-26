# Design

## Decisions

- Модель принимает возрастающие UTC-метки времени. Адаптер сопоставляет границы интервалов до вызова
  ядра. Совпадение ищется по точной метке.
- A/D Line накапливает разницу от выбранной базы. Пропуск делает дальнейшую линию неопределённой до
  повторного расчёта с заполненным входом. A/D Ratio делит количество растущих на количество
  падающих. Рыночной ширины в текущих адаптерах нет.
  [A/D Line](https://www.tradingview.com/support/solutions/43000589092-advance-decline-line/) ·
  [A/D Ratio](https://www.tradingview.com/support/solutions/43000589093-advance-decline-ratio/)
- Для A/D Ratio (Bars) цвет определяется знаком `close - open`. Длина проекта по умолчанию равна 9
  по примеру из справки. Нужны свечи текущего инструмента.
  [A/D Ratio (Bars)](https://www.tradingview.com/support/solutions/43000644914-advance-decline-ratio-bars/)
- Для корреляции настройки хранят идентификатор второго инструмента, выбранный источник и целую
  длину от 2 до 10000, по умолчанию 20. К существующему рыночному клиенту нужно добавить запрос
  второй истории на том же интервале, отмену при смене инструмента и учёт полноты ряда. Уровни −1,
  0, +1 идут в отдельной панели.
  [Correlation Coefficient](https://www.tradingview.com/support/solutions/43000502022-correlation-coefficient-cc/)
- Open Interest использует самостоятельный ряд. Bybit `linear` отдаёт размер в базовой монете. OKX
  `/api/v5/rubik/stat/contracts/open-interest-history` отдаёт контракты, монеты и USD раздельно.
  Службы MTP ещё не запрашивают эти методы. Подключение требует проверки контракта, единицы,
  интервала и времени публикации.
  [Open Interest](https://www.tradingview.com/support/solutions/43000685269-open-interest/) ·
  [Bybit](https://bybit-exchange.github.io/docs/v5/market/open-interest) ·
  [OKX](https://www.okx.com/docs-v5/en/#trading-statistics-rest-api-get-contract-open-interest-history)
- Price Target использует прогноз с точкой публикации и горизонтом поставщика. `GetForecastBy` уже
  используется в деталях российских акций. Текущая нормализация отдаёт границы, оценку и валюту
  консенсуса. Дата консенсуса остаётся пустой, горизонта и числа аналитиков в модели нет. Для
  отображения требуются дополнительные поля поставщика.
  [Price Target](https://www.tradingview.com/support/solutions/43000730980-price-target-indicator/)
  · [Т-Банк](https://developer.tbank.ru/invest/api/instruments-service-get-forecast-by)
- Technical Ratings следует условиям из справки индикатора, включая Bull Bear Power 13. Определение
  направления тренда для Stoch RSI и Bull Bear Power справка не раскрывает. Модель принимает
  направление отдельно для каждой составляющей. Адаптеру нужно подтвердить его источник и подать
  компоненты одного интервала. Предыдущие значения относятся к предыдущей свече этого интервала.
  Вход Ichimoku содержит значения, доступные на этой свече. Нужны 200 баров для самой длинной SMA и
  прогрев EMA. Для таблицы каждый интервал загружается отдельно.
  [Technical Ratings](https://www.tradingview.com/support/solutions/43000614331-technical-ratings/)

## Risks

Слияние по позиции или перенос значения вперёд может применить чужой интервал либо создать данные
для пустого периода. Сопоставление инструмента, валюты и интервала выполняют источники. Ядро
сохраняет пропуски и проверяет входы.
