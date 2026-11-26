# Proposal

## Why

Reviewed Keltner math уже доступен отдельно, но его boolean/three-choice inputs ещё не поддержаны
регистрацией и формой. Нужен один локально computed KC после прежних50 без изменения их контрактов.

## What Changes

- Append KC с шестью exact params и динамическим history/readiness contract.
- Boolean ParameterDefinition и generic nonempty string choices с exact instance validation.
- RU/EN checkbox/select controls, текущие v1 styles/JSON/Drive и transient calculation-limit.
- Source-confirmed blue lines и5% blue fill через существующий presentation compiler.

## Capabilities

### New Capabilities

- `keltner-channel-indicator`: локальный KC, его параметры, результаты и переносимость.

### Modified Capabilities

Нет.

## Impact

Только shared registration/parameter parser/settings/Drive allowlist, собственные tests/docs/spec.
Без math/native/compiler/camera/build/version edits, Donchian, новых persistent schemas и advanced
fill UI. Центральный pinned expectation helper и старые fixtures root обновляет после review.
