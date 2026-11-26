# Spec Delta

## ADDED Requirements

### Requirement: Causal aligned calculations

Пакет SHALL вычислять пять подтверждённых builtin формул по readonly данным, сохраняя длину серий и
исходный порядок. LSMA offset SHALL менять координату регрессии внутри текущего окна; Donchian
displayOffset SHALL оставаться presentation metadata.

#### Scenario: Prefix extension and offsets

- **WHEN** к истории добавлены будущие свечи и выбран ненулевой offset
- **THEN** прежний расчётный префикс сохраняется, timestamps не смещаются и будущие наблюдения не
  читаются

### Requirement: Exact builtin identity

Metadata SHALL сохранять exact public IDs, actual source versions/hashes/defaults и все численные
outputs. Builtin Chandelier SHALL публиковать две exit-линии без несуществующих direction,
sourceClose и reversal signals.

#### Scenario: Chandelier identity

- **WHEN** рассчитан builtin Chandelier из текущего каталога
- **THEN** обе exit-линии доступны одновременно после ATR seed, без direction masking или ratchet

### Requirement: Explicit local data policy

Пакет SHALL отклонять sparse/malformed consumed inputs и параметры вне локальных bounds, различать
null и zero, возвращать null при непредставимом результате. Metadata SHALL описывать warmup, seed,
gap и convergence policies отдельно от недоказанной Pine parity.

#### Scenario: Missing data and overflow

- **WHEN** consumed observation неизвестно или вычисление переполняется
- **THEN** результат null и recursive segment пересеивается согласно опубликованной policy, без
  искусственной цены

### Requirement: Bounded pure math

Пакет SHALL ограничивать размер входа, периоды и операции прямой ALMA convolution; оставаться без
DOM, часов, сети и persisted schema.

#### Scenario: Excessive convolution

- **WHEN** произведение количества окон и ALMA length превышает локальный лимит
- **THEN** вызов отклоняется до выделения kernel и вычисления окон

### Requirement: Math-only delivery

Пакет SHALL оставлять регистрацию, fill/offset rendering, multi-timeframe execution и native
acceptance отдельными gates.

#### Scenario: Source delivery

- **WHEN** source проверки завершены
- **THEN** статус остаётся math-only, без обещания chart или Pine runtime parity
