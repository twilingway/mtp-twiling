# Proposal

## Why

Принятая математика ALMA, LSMA и Chandelier Exit пока недоступна в библиотеке. Прямые ALMA/LSMA
kernels имеют явный resource cap, который при регистрации должен давать понятную временную
недоступность вместо падения графика.

## What Changes

- Добавить только ALMA9/.85/6 fixed-close, LSMA25/offset0/sourceclose и Chandelier22/ATR22/mult3
  после SAR/ST; solid native-price outputs.
- Сохранить v1 params/styles/backup и предыдущие47 definitions/results без изменений.
- Обрабатывать calculation-limit runtime-only: полные timestamps, null outputs, RU/EN status и
  восстановление после снижения нагрузки; без усечения/подмены цен.
- KC/DC оставить math-only до отдельных input/presentation gates.

## Capabilities

### New Capabilities

- `channel-average-registration`: три зарегистрированные формулы и временный resource-limit status.

### Modified Capabilities

Нет.

## Impact

Shared TA contracts/runtime/catalog, settings/legend status, Drive allowlist существующих params,
scoped tests/docs. Математика всех пяти функций переносится byte-identical из780e9c5. Нет новых
зависимостей, версии, build, публикации или persistent schema.
