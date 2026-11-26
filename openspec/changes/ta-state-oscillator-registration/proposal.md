# Proposal

## Why

Независимый math review завершён без blockers. TSI/KST/Fisher используют уже поддерживаемые line
plots и могут стать доступны через существующие настройки/сохранения без нового renderer contract.

## What Changes

- Append-only три computed definitions после frozen42, flat persisted inputs, exact catalog IDs.
- Typed узкий history union сохраняет reviewed seeds/convergence и Fisher1 null warmup/seed без
  сохранения metadata.
- RU/EN settings labels и ровно10 новых Drive parameter keys.
- Source-only numeric/legacy/JSON/Drive/UI-save проверки; Supertrend/SAR math-only, DPO unresolved.

## Capabilities

### New Capabilities

- `technical-state-oscillator-registration`: доступные TSI/KST/Fisher с проверяемыми настройками и
  persistence contract.

### Modified Capabilities

Нет.

## Impact

Types/definitions/catalog/runtime, новые узкие helpers, settings labels, Drive allowlist. Pure49,
native fixtures, версии, build/browser и публикация не меняются.
