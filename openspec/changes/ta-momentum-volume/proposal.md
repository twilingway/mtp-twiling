# Proposal

## Why

Для расширения каталога нужны независимые проверяемые расчёты восьми осцилляторов и объёмных рядов.
Наличие математического пакета должно быть отделено от подключения UI и native движков.

## What Changes

- Добавить Momentum, ROC, CCI, Williams %R, MFI, OBV, ADL и PVT.
- Зафиксировать источники TradingView, defaults, seed, gaps и численные ограничения.
- Добавить immutable metadata со статусом math-only и ручные численные проверки.

## Capabilities

### New Capabilities

- `momentum-volume-math`: чистые численные ряды осцилляторов и накопительного объёма.

### Modified Capabilities

Нет.

## Impact

Только новый пакет momentum-volume, его тесты и документы. Общий registry, runtime, UI, storage,
зависимости и исходные типы не меняются. Публикация и Pine execution parity не входят в пакет.
