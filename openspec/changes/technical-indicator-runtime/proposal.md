# Proposal

## Why

Каталог индикаторов требует настоящих общих расчётов, чтобы оба движка получали одинаковые значения,
а недоступные пункты не создавали фиктивные линии.

## What Changes

Чистое ядро RSI, MACD, Bollinger Bands, ATR, Stochastic, общие SMA/EMA/RMA и сериализуемые
определения/экземпляры. Все выходы выровнены с входом, пропуски представлены null. Проверка
параметров и metadata недоступности отделены от исполнения.

## Capabilities

### New Capabilities

- `technical-indicator-runtime`: расчёт и безопасный контракт экземпляров технических индикаторов.

### Modified Capabilities

Нет.

## Impact

Только новые model/technical-indicators модули, тесты и документация. Без зависимостей, UI, native
renderer, изменения MTP, старых flags, backup и controller.
