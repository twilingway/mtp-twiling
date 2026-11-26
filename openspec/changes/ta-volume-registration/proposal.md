# Proposal

## Why

Семь reviewed volume-flow формул пока не подключены к реестру терминала. Нужна строгая интеграция
без изменения предыдущих 35 вычислений и сохранённых экземпляров.

## What Changes

- Добавить семь определений: всего 42 computed, 43 доступных TA с Volume и 47 доступных library
  entries с четырьмя MTP.
- Подключить все 11 numeric outputs, reviewed metadata и проверку наличия положительного объёма
  только для новых индикаторов.
- Добавить точный выбор EMA/SMA, RU/EN labels и строгий JSON/Drive roundtrip.

## Capabilities

### New Capabilities

- `volume-indicator-integration`: реестр, вычисления, параметры и переносимые настройки объёмных
  индикаторов.

### Modified Capabilities

Нет.

## Impact

Registry/types/instances/runtime/catalog, новый volume-definitions, TechnicalIndicatorSettings и
Drive backup allowlist; отдельные тесты и документ. Pure math, native fixtures, build/browser,
package/version и frozen worktrees исключены.
