# Proposal

## Why

Для запрошенных 4/6/7/8/9/45 минут и 3 часов нужен отдельно проверяемый математический контракт.
Существующая агрегация не доказывает финальность и coverage, а её включение требует других
изменений.

## What Changes

- Чистая агрегация строго нормализованных реальных минутных OHLCV.
- Явные supplied anchor, session boundaries, открытые окна, asOf и evidence полноты.
- Проверки порядка, значений, причин неполноты и ограничений ресурсов.
- Независимые ручные ledger fixtures и документация будущих integration gates.

## Capabilities

### New Capabilities

- `derived-minute-aggregation`: детерминированная агрегация минутных снимков с явными границами и
  качеством.

### Modified Capabilities

Нет.

## Impact

Только новый `src/model/derived-intervals`, отдельные source tests и документы. Timeframe,
transport, cache, UI, schema, Drive, зависимости и версия приложения не меняются. Нет обещания
TradingView parity.
