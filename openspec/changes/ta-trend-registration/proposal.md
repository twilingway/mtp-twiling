# Proposal

## Why

Проверенный trend-strength math-пакет нужно подключить к общему runtime без потери прежних 29
определений. CHOP length1 требует честного представления всегда неопределённого результата.

## What Changes

- Добавить шесть computed definitions с точными public IDs, параметрами и численными outputs.
- Расширить только вычислительные metadata: warmupBars допускает null, optional alwaysUndefined
  равен true только для CHOP length1.
- Сохранить старые defaults, порядок и result shapes, а также явный third-argument HV context.
- Проверить golden runtime, seed/history, nullable metadata, strict JSON и границу Drive.

## Capabilities

### New Capabilities

- `trend-strength-runtime`: строгая регистрация шести расчётов с nullable warmup для CHOP.

### Modified Capabilities

Нет.

## Impact

Только TA types/definitions/runtime/catalog, новые definition файлы, tests/docs/OpenSpec.
Native/UI/Drive/version и frozen .19 не меняются. Два новых Drive params key интегрирует root.
