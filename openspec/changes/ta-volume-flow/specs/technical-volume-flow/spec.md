# Spec Delta

## Purpose

Предоставить будущим caller проверяемую чистую математику объёмных индикаторов с сохранением
индексов исходных наблюдений и явным описанием истории.

## ADDED Requirements

### Requirement: Complete numeric outputs

Пакет SHALL вычислять CMF, Chaikin Oscillator, EFI, EOM, PVO, NVI и PVI по подтверждённому
публичному builtin source и сохранять число входных наблюдений для каждого выхода.

#### Scenario: Compound indicators

- **WHEN** caller запрашивает NVI/PVI или PVO
- **THEN** результат содержит соответственно index и EMA либо oscillator, signal и histogram; EMA
  NVI/PVI начинается с отображаемого seed 1000.

### Requirement: Safe pure computation

Пакет SHALL не изменять вход, не читать будущие наблюдения, отвергать NaN, Infinity, отрицательный
volume, malformed ranges и параметры вне manifest; отсутствующие и непредставимые результаты
обозначаются null.

#### Scenario: Frozen prefix

- **WHEN** frozen вход расширяется будущими барами
- **THEN** ранее вычисленный префикс каждого ряда сохраняется, timestamps остаются нетронутыми.

#### Scenario: Missing and zero values

- **WHEN** volume равен нулю или null, high равен low либо предыдущий close равен нулю
- **THEN** применяется документированная политика конкретной формулы без Infinity и без подмены
  рыночных данных.

### Requirement: Honest source-only history contract

Manifest SHALL содержать public ID, defaults, bounds, outputs, required data и math-only status.
Metadata SHALL различать минимальное число наблюдений и зависимость накопления/EMA от полной
истории.

#### Scenario: Future registration

- **WHEN** интегратор читает metadata NVI или Chaikin Oscillator
- **THEN** он видит собственный cumulative-plus-EMA контракт, seed и full-input-dependent
  convergence; пакет не заявляет доступность в UI или полную Pine parity.
