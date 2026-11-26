# Spec Delta

## Purpose

Разрешить пользователю настраивать и сохранять три проверенных осциллятора через общий registry без
изменения результатов прежних индикаторов или скрытой потери параметров.

## ADDED Requirements

### Requirement: Append-only computed registration

Registry SHALL содержать45 computed с TSI/KST/Fisher после прежних42, exact public IDs, lower pane и
двумя line outputs. Старые defaults/order/result shapes/history SHALL сохраняться.

#### Scenario: Frozen42 contract

- **WHEN** вычисляется Git-derived frozen42 fixture после регистрации
- **THEN** definitions/default instances/history/results имеют прежний SHA256

### Requirement: Exact flat parameters and styles

Instances SHALL хранить TSI long/short/signal, KST четыре ROC/четыре SMA/signal, Fisher length как
scalar integer1..10000. Null/unknown/arrays/extras и неверные styles SHALL отклоняться.

#### Scenario: Invalid KST tuple persistence

- **WHEN** входной params содержит rocLengths array вместо flat keys либо extra ключ
- **THEN** root validator отклоняет instance до runtime или persistence projection

### Requirement: Reviewed history and undefined Fisher

Runtime SHALL сохранять reviewed numeric outputs и literal history contracts. Fisher length1 SHALL
возвращать all-null, warmup=null, recursive seedBars=null и result-only alwaysUndefined=true.

#### Scenario: Fisher1 roundtrip

- **WHEN** сохраняется Fisher length1 и затем восстанавливается
- **THEN** сохраняется только instance, а undefined flags/history заново вычисляются и не попадают в
  persisted schema

### Requirement: Human settings and persistence

Settings SHALL показывать RU/EN human labels и сохранять проверенные численные параметры. JSON и
production Drive roundtrip SHALL сохранять все три custom instances/styles без metadata.

#### Scenario: Custom KST settings save

- **WHEN** пользователь меняет все девять KST lengths в settings и сохраняет
- **THEN** actual submit передаёт проверенный flat instance, JSON/Drive сохраняют все значения

### Requirement: Deferred renderer boundary

Catalog SHALL оставлять Supertrend/SAR unavailable math-only и DPO unresolved. Новая регистрация
SHALL не менять версии/build/native fixtures и не заявлять Pine execution parity.

#### Scenario: Catalog lookup

- **WHEN** consumer ищет STD;Supertrend, STD;PSAR или STD;DPO
- **THEN** они не имеют computed mapping
