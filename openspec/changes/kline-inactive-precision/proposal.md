# Proposal

## Why

Скрытый current KC оставляет native Price owner/companion и меняет диапазон/формат активного
fixed6/8 соседа через metadata KLine9.8.12. Требуется восстановить принятую нейтральность hidden
plots и декоративного fill перед публикацией.24.

## What Changes

- Разделить active native members и data-free inactive layout/level/fill roles с neutral metadata.
- Заимствовать precision только у настоящих текущих contributors, сохраняя empty pane и уровни.
- Синхронно обновлять metadata после price precision change; viewport refresh без формул/rows.
- Добавить native matrix/race/pane tests и source evidence. Numeric/persistent/version/build не
  менять.

## Capabilities

### New Capabilities

- `kline-native-membership`: нейтральность неактивных members относительно текущего native domain.

### Modified Capabilities

Нет; сохраняется include-when-visible/fill:none из принятых render contracts.

## Impact

Ownership: K technical manager, focused member/domain helpers, один callback в kline.ts, собственные
tests/docs/spec. Нет новых quotes, registry, math, schema/Drive, LW или публикации. Fresh PRODUCT
gate после независимого review остаётся отдельным.
