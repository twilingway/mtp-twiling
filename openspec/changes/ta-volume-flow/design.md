# Design

## Context

База c310045 содержит reviewed EMA/SMA и ADL. Shared registry/types принадлежат координатору. См.
proposal.md.

## Goals / Non-Goals

Цель: source-only модуль и собственный history type без фиктивного сопоставления cumulative с EMA.
Исполнение Pine, MTF, UI и сохранение экземпляров вне scope.

## Decisions

- Public source получен 2026-11-26: CMF32, Chaikin32, EFI32, EOM30, PVO33, NVI/PVI4. Источник
  приоритетнее устаревших Charting Library defaults Volume Oscillator5/10.
- EMA/SMA переиспользуются с first-valid seed и na-skipping semantics. CMF использует отношение двух
  SMA той же длины, эквивалентное отношению sums, без переполнения только из-за умножения среднего
  на length.
- Chaikin переиспользует ADL. Накопленный overflow остаётся null; отсутствующий вклад сохраняет
  известную сумму ADL. Это ограничение sparse parity фиксируется явно.
- NVI/PVI считают внутренний seed1 как Pine reference, умножают только выход на1000; close null/0
  сохраняет предыдущее значение, отсутствующий previous volume трактуется как0 для сравнения
  согласно nz в reference. После непредставимого recurrence накопление остаётся null.
- Каждый ряд выровнен по индексам; timestamps caller сохраняет отдельно. Manifest deeply frozen;
  numeric outputs не включают константные hline.
- Линейные проходы, дополнительная память O(N + length). Binary64 overflow переводится в null;
  внутренние ограничения reviewed SMA документируются.

## Risks / Trade-offs

- [Нет исполнения Pine] → формулы подтверждены source, edge cases проверяются локальными ledger;
  полная parity не заявляется.
- [Sparse ADL и экстремальные масштабы] → политика known-contributions и возможная потеря точности
  описаны в документе.
- [Новый общий history contract] → собственный narrow type, согласование при root регистрации.
