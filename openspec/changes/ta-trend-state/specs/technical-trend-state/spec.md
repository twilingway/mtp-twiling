# Spec Delta

## Purpose

Дать последующим chart adapters проверяемые чистые state/trend вычисления без скрытой подмены
неизвестных цен, регистрации и недоказанных обещаний Pine parity.

## ADDED Requirements

### Requirement: Aligned causal math

Пакет SHALL вычислять Supertrend, SAR, TSI, KST и Fisher по readonly свечам, возвращая серии длины
входа, без изменения входа и будущих наблюдений.

#### Scenario: Prefix extension

- **WHEN** к истории добавлены новые свечи
- **THEN** вычисленные значения существующего префикса остаются прежними, исходные timestamps не
  меняются

### Requirement: Explicit state boundaries

Пакет SHALL публиковать seeds, warmup и full-input-dependent history для recursive формул. SAR и
Supertrend SHALL разрывать сегмент при неизвестном HLC или непредставимом state, повторяя seed после
восстановления данных.

#### Scenario: SAR reversal and recovery

- **WHEN** рассчитанный SAR пересекает текущий противоположный экстремум либо встречает неизвестную
  свечу
- **THEN** reversal использует прежний EP и AF reset, а неизвестная свеча даёт null и требует нового
  двухбарного seed

### Requirement: Undefined and invalid data

Пакет SHALL отличать null от 0, выдавать null при нулевом denominator или overflow, отклонять
malformed consumed fields, sparse bars и параметры вне опубликованных локальных bounds.

#### Scenario: Flat Fisher and TSI

- **WHEN** все цены неизменны и denominator равен нулю
- **THEN** соответствующие значения остаются null, без искусственного нулевого осциллятора

### Requirement: Research status and presentation causality

Metadata SHALL сохранять actual public IDs, версии и source hashes. DPO SHALL оставаться unresolved
при недоказанном fractional offset; документация SHALL явно отделять calculation timestamp от
centered negative display offset.

#### Scenario: Odd DPO length

- **WHEN** official source использует default21 и Pine v6 fractional division без подтверждённого
  conversion
- **THEN** пакет не публикует готовую DPO функцию и не выбирает floor/round молча

### Requirement: Math-only integration boundary

Пакет SHALL оставаться самостоятельным source-only модулем с metadata, без изменения runtime
registry, сохранений, UI, версии и поставляемых assets.

#### Scenario: Import package

- **WHEN** consumer импортирует математические exports
- **THEN** импорт не обращается к DOM, сети, часам, аккаунтам или продуктовым данным
