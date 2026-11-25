# Design

## Context

Новый math-only пакет следует после отдельной регистрации предыдущих 21 индикатора. Общие модули
принадлежат координатору и не меняются.

## Goals / Non-Goals

Цель: восемь самостоятельных вычислений, источники, численные тесты и metadata. Подключение UI,
native, registry, таймфрейм-диспетчера и реальное исполнение Pine вне задачи.

## Decisions

- %B и BBW используют нормализованные rolling central moments с population divisor n. BBW возвращает
  также extrema последних 125 баров; для extrema достаточно первого non-null BBW.
- HV принимает явный periodsPerYear. Default built-in: annual=365, per=1 для intraday/1D, иначе 7.
- AO фиксирован на SMA(HL2,5)−SMA(HL2,34); BOP использует OHLC без сглаживания.
- CMO/UO требуют полные окна соседних вкладов и сбрасывают прогрев после неизвестного вклада. Это
  консервативный локальный sparse контракт, не заявление о Pine na execution.
- TRIX использует first-value EMA chain над log(source), затем 10000×соседнее изменение. EMA state
  на log gap удерживается и промежуточные стадии продолжаются, финальный output masked.
- Windows используют ring buffer и monotonic deques, периодический rebase и защитный rebase при
  потере масштаба. Обычная сложность O(N), крайний scale fallback может стоить O(Nn).

## Risks / Trade-offs

Источники last меняются. Формулы и параметры проверены, но execution parity не измерена. Нулевые
логарифмические цены неизвестны, отрицательные цены допустимы только для нелогарифмических рядов.
Крайние underflow/overflow binary64 не заменяются фиктивными числами. Данные и timestamps
выравнивает caller. Дополнительные alert/color side effects built-in не входят в численное ядро.

## Validation

Ручные рациональные и логарифмические ledger, dense defaults, zero, gap, invalid input, frozen
input, extreme scales, causality, windows100000/10000; scoped lint/format, TypeScript, OpenSpec.
