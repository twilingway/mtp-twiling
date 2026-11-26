# Proposal

## Why

Для следующего расширения TA нужны проверенные расчёты силы тренда. Различия n+1 окна Aroon, первого
true range и Wilder seed нельзя скрывать за похожими учебными формулами.

## What Changes

- Добавить Aroon Up/Down, Aroon Oscillator, DMI, отдельный ADX, Vortex и Choppiness Index.
- Проверить defaults и формулы по публичным официальным источникам TradingView.
- Добавить immutable math-only metadata, численные ledger и явные gap/overflow/tie ограничения.

## Capabilities

### New Capabilities

- `trend-strength-math`: самостоятельные ряды силы тренда с проверенными seed и окнами.

### Modified Capabilities

Нет.

## Impact

Только новый trend-strength пакет, отдельные tests/docs/OpenSpec. Общие types, registry, runtime,
UI, native, Drive и зависимости не меняются. Регистрация выполняется координатором позднее.
