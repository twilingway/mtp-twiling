# Proposal

## Why

Каталогу нужны проверяемые формулы ещё восьми индикаторов. Их математическая готовность должна быть
отделена от подключения в UI и от неподтверждённого совпадения исполнения Pine.

## What Changes

- Добавить Bollinger %B, BandWidth с двумя extrema, Historical Volatility, AO, BOP, CMO, UO, TRIX.
- Зафиксировать defaults из актуальных публичных built-in и явную annualization для HV.
- Добавить immutable math-only metadata, ручные ledger и проверки граничных условий.

## Capabilities

### New Capabilities

- `volatility-momentum-math`: самостоятельные ряды волатильности и осцилляторов с явным контекстом.

### Modified Capabilities

Нет.

## Impact

Только новый volatility-momentum пакет, его тесты, документы и OpenSpec. Registry, UI, native,
storage, зависимости и общие типы не меняются. Регистрация будет отдельной задачей.
