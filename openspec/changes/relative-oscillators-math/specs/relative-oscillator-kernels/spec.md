# Spec Delta

## Purpose

Предоставить независимо проверяемые чистые численные расчёты пяти осцилляторов, сохраняя входные
свечи, порядок timestamps и прежние индикаторы приложения.

## ADDED Requirements

### Requirement: Complete numeric outputs

Пакет SHALL вычислять K/D Stochastic RSI, value/signal Vigor, value/MA/BB Volatility, один Coppock и
один суммарный Bull/Bear Power по закреплённым primary wrappers.

#### Scenario: Optional volatility smoothing

- **WHEN** выбран None либо SMA + Bollinger Bands
- **THEN** отключённые outputs заполнены null либо вычислены MA и обе BB соответственно без
  сокращения длины ряда

### Requirement: Strict causal input contract

Пакет SHALL принимать плотные свечи с конечными timestamps и finite-or-null потребляемыми полями,
отклонять неверные параметры и сохранять входные данные неизменными.

#### Scenario: Prefix and correction

- **WHEN** добавлены будущие свечи либо исправлена последняя свеча
- **THEN** прежний префикс не зависит от будущего, а пересчёт равен расчёту исправленного входа с
  нуля

### Requirement: Honest undefined and bounded computation

Пакет SHALL возвращать только finite-or-null значения, не подменять неопределённый denominator нулём
или 50, ограничивать размер/периоды и документировать локальные startup/NA правила отдельно от Pine
execution parity.

#### Scenario: Flat and missing observations

- **WHEN** denominator отсутствует либо равен нулю
- **THEN** арифметический результат равен null, а дальнейшие фильтры следуют явно описанной skip-NA
  или позиционной политике

#### Scenario: Excessive input

- **WHEN** превышен локальный cap свечей, периода или оценочных tree visits
- **THEN** расчёт отклоняется до выделения больших промежуточных рядов
