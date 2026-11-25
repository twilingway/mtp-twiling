# Design

## Context

Восемь функций используют NumericSeries и TechnicalBar. Импорт из нового локального index; общие
типы и registry принадлежат координатору.

## Goals / Non-Goals

Цель: проверяемая математика и metadata. UI, native, дополнительные сглаживающие линии встроенных
скриптов и исполнение Pine вне scope.

## Decisions

- Momentum/ROC используют точные индексы баров. CCI использует n валидных наблюдений, оставляя gap
  на текущем null; O(NL), период ограничен 10000.
- Williams использует полные окна баров и monotonic deques; окно с отсутствующим high/low
  недоступно. MFI требует n соседних изменений, период 1..2000 как в built-in.
- OBV/PVT начинают с первого доступного соседнего изменения; ADL с первого вклада. Missing вклад
  выводит null и сохраняет известную сумму; после overflow накопление остаётся null.
- Переполнение промежуточного потока MFI недоступно до выпадения из окна. Rolling суммы
  перестраиваются периодически и после overflow для восстановления.
- Metadata накопления использует собственный narrow history type: shared enum seed не содержит
  cumulative policy. Никакого фиктивного соответствия EMA seed.

## Risks / Trade-offs

Sparse политика консервативна и не подтверждена исполнением Pine. После missing вклада накопленная
сумма учитывает только известные вклады, что явно задокументировано. CCI built-in использует HLC3,
хотя Help Center указывает Close. На экстремальных масштабах binary64 возможны underflow и потеря
точности; конечные входы не означают представимость произведений.

## Validation

Ручные рациональные ledger, flat, zero, gaps, frozen input, rejected input, overflow recovery,
default metadata, scoped lint/format/TypeScript и strict OpenSpec validation.
