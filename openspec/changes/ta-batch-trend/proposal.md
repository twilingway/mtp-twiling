# Proposal

## Why

Каталог MTP содержит восемь недоступных индикаторов тренда и риска, для которых известны входы и
методы расчёта. Их вычисления нужны для последующей регистрации в терминале.

## What Changes

- Добавить расчёты Linear Regression Channel, RCI, RCI Ribbon, Trend Strength Index, Mass Index,
  Ulcer Index, Pring’s Special K и Chop Zone.
- Зафиксировать минимальную историю, обработку пропусков и контракт для будущей отрисовки.

## Capabilities

### New Capabilities

- `trend-window-math` — выровненные по исходным барам вычисления канала регрессии, ранговой
  корреляции, тренда и риска.

### Modified Capabilities

## Impact

Чистые модули TypeScript и числовые тесты. Регистрация и визуальные сценарии относятся к следующему
этапу.
