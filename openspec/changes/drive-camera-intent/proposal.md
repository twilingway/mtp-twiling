# Proposal

## Why

Пользовательская камера меняется внутри chart library и не увеличивает portable revision. Удалённый
Drive-снимок может затереть pan/zoom, начатый после экспорта или до ближайшего RAF.

## What Changes

- Синхронно инвалидировать pending incoming при начале/продолжении пользовательского действия
  камеры.
- После фактического изменения сохранять готовую X-камеру с debounce и запускать обычную Drive sync.
- Исключить котировки, программное восстановление, начальный fit и resize из источников dirty.

## Capabilities

### New Capabilities

- `portable-camera-intent`: пользовательская камера, сохранение и защита входящего переноса.

### Modified Capabilities

Нет.

## Impact

Chart callbacks/adapters, ChartGestures/Navigation, новый controller-camera helper и Drive revision.
Схема Backup/Y scale, история, банковский клиент и сервер не меняются.
