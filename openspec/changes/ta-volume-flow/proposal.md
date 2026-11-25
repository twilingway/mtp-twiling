# Proposal

## Why

Для следующей регистрации TA нужны проверенные объёмные формулы. Публичный builtin source изменился:
Volume Oscillator теперь выдаёт PVO, signal и histogram; NVI/PVI также требуют EMA.

## What Changes

- Семь source-only расчётов со всеми числовыми выходами, ограниченными параметрами и metadata.
- Ручные числовые ledger, проверки ошибок и документация подтверждённых источников и ограничений.

## Capabilities

### New Capabilities

- `technical-volume-flow`: чистые объёмные расчёты и контракт истории для будущего caller.

### Modified Capabilities

Нет.

## Impact

Только новый volume-flow пакет, отдельный test, документ и этот change. Registry, shared types, UI,
native, Drive, version и зависимости не меняются.
