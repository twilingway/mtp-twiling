# Proposal

## Why

Терминалу нужны проверяемые расчёты ещё для шести индикаторов и готовое описание вывода Donchian.
Подготовка общего входа и выходов упрощает регистрацию на обоих графиках.

## What Changes

- Переиспользовать расчёт Donchian Channels с явным сдвигом отрисовки.
- Добавить расчёты Envelope, Median, Chande Kroll Stop, Volatility Stop и BBTrend.
- Подготовить цветовые роли и геометрию Bollinger Bars из OHLC.

## Capabilities

### New Capabilities

- `technical-price-bands`: расчёт каналов, уровней стопа, тенденции BBTrend и частей свечи Bollinger
  Bars.

## Impact

Расчётные модули и проверки. Интеграция с каталогом и адаптерами графиков предусмотрена следующей
задачей.
