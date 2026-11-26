# Каталог индикаторов: источник и готовность

`reference/tradingview-indicators/catalog.json` — снимок публичных builtin metadata открытого
TradingView selector от 25.11.2026: 127 индикаторов, 23 стратегии, 64 паттерна, 8 профилей и 2
options. RU/EN имена, IDs, версии и категории взяты из загруженного объекта, включая невидимые
строки. Каталог может отличаться между версиями и тарифами. Приватные, купленные и community scripts
в снимок не включены. Metadata каталога сама по себе не содержит формулы и input defaults.

В кандидате 0.3.24 реализован **51 вычисляемый TA-индикатор**, объём и четыре пользовательских
MTP-скрипта. Это 52 доступных встроенных индикатора и 56 доступных записей всей библиотеки.
Вычисляемые IDs закреплены в `test/technical-registry-expectation.mjs`: ожидания меняются только
после приёмки новой регистрации, а исторические witnesses сохраняются.

Доступны средние SMA/EMA/WMA/VWMA/DEMA/TEMA/HMA/SMMA/ALMA/LSMA; RSI, Stochastic, MACD, Momentum,
ROC, CCI, Williams %R, CMO, Ultimate Oscillator, TRIX, Awesome Oscillator, Balance of Power, TSI,
KST и Fisher Transform; ATR, Bollinger Bands/%B/Bandwidth, Historical Volatility, Keltner Channels;
Aroon/Aroon Oscillator, DMI/ADX, Vortex, Choppiness, Parabolic SAR, Supertrend и Chandelier Exit;
MFI, OBV, ADL, PVT, CMF, Chaikin Oscillator, EFI, EOM, Volume Oscillator, NVI и PVI.

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
