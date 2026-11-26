# Каталог индикаторов: источник и готовность

`reference/tradingview-indicators/catalog.json` — снимок публичных builtin metadata открытого
TradingView selector от 25.11.2026: 127 индикаторов, 23 стратегии, 64 паттерна, 8 профилей и 2
options. RU/EN имена, IDs, версии и категории взяты из загруженного объекта, включая невидимые
строки. Каталог может отличаться между версиями и тарифами. Приватные, купленные и community scripts
в снимок не включены. Metadata каталога сама по себе не содержит формулы и input defaults.

В ветке расширения каталога реализованы **106 вычисляемых TA-индикаторов**, объём и четыре
пользовательских MTP-скрипта. Это 107 доступных встроенных индикаторов из 127 и 111 доступных
записей всей библиотеки. Вычисляемые IDs закреплены в `test/technical-registry-expectation.mjs`:
ожидания меняются только после приёмки новой регистрации, а исторические witnesses сохраняются.

Доступны средние SMA/EMA/WMA/VWMA/DEMA/TEMA/HMA/SMMA/ALMA/LSMA; RSI, Stochastic, MACD, Momentum,
ROC, CCI, Williams %R, CMO, Ultimate Oscillator, TRIX, Awesome Oscillator, Balance of Power, TSI,
KST и Fisher Transform; ATR, Bollinger Bands/%B/Bandwidth, Historical Volatility, Keltner Channels;
Aroon/Aroon Oscillator, DMI/ADX, Vortex, Choppiness, Parabolic SAR, Supertrend и Chandelier Exit;
MFI, OBV, ADL, PVT, CMF, Chaikin Oscillator, EFI, EOM, Volume Oscillator, NVI и PVI. Stochastic RSI,
Coppock Curve, Relative Vigor Index, Relative Volatility Index и Bull Bear Power доступны в
отдельных панелях. RVGI и RVI отображаются на исходных свечах со смещением 0.

Добавлены адаптивные средние, осцилляторы, каналы, пивоты и уровни Фибоначчи, VWAP и TWAP, Ишимоку и
Аллигатор, гэпы, торговые сессии и фазы Луны. Открытый интерес работает с линейными деривативами
Bybit на поддерживаемых интервалах. Оборот за 24 часа использует непрерывные закрытые свечи Bybit и
OKX и валюту котировки.

Остаются 20 позиций:

- Ширина рынка для A/D Line, A/D Ratio и Cumulative Volume Index.
- История второго инструмента для корреляции, прогнозы с датами для Price Target.
- Объёмные дельты, Up/Down Volume и Net Volume требуют младших свечей либо сделок.
- Auto Key Levels, Auto Pitchfork и Auto Trendlines требуют собственных правил выбора опор и
  дополнительных данных или геометрии.
- Multi-time Period, Pivot Points Standard и три исследования пивотов Букера требуют истории
  соответствующих периодов. Knoxville Divergence требует проверки правил сопоставления опор.
- Performance и Seasonality требуют таблиц и дополнительной дневной или месячной истории.

Отображение на ценовом графике или в отдельной панели задаётся определением индикатора и может
меняться пользователем. Политика native scale сохраняется при переносе. Доступность записи каталога
определяется реализованным вычислением и renderer, а не наличием названия в snapshot.

Для каждой следующей группы отдельно проверяются официальные formula wrappers/defaults, численные
результаты, прогрев и история, параметры, сохранения, native rendering на обоих SDK и интерфейс.
Pine runtime parity не следует из чтения JavaScript/Pine wrapper или совпадения нескольких чисел.
Смещённые линии, автопостроения, стратегии, фундаментальные показатели и breadth/session studies
могут требовать других контрактов или данных. Их нельзя реализовать переименованием текущей SMA.

Первичный read-only отчёт и manifest находятся в локальных артефактах
`artifacts/indicator-catalog-reference`; они не включаются в публикацию пользовательских данных.
