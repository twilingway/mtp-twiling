# Proposal

## Why

На .22 подтверждены потеря independent routing patch при ожидании camera/editing и отмена загрузки
уже committed TF отклонённым depth request. Оба сценария используют доступные UI controls и реальные
controller/history/camera методы; это blocker до merge.

## What Changes

- Согласовать concurrent routing preferences без потери независимых полей; для одного поля latest
  valid intent определяет итог.
- Отделить pending intents от actual reload commit generation: rejected depth не отменяет history.
- Устанавливать historyViewReady=false атомарно с reload commit до await preferences persistence.
- Сохранить old-camera capture до изменения preferences, original valid/forceReload и sticky
  owner/client/revision/import fences. Network не блокирует следующий critical preference commit.
- Добавить actual-controller regressions и сохранить существующие depth/camera tests.

## Capabilities

### New Capabilities

- `terminal-preference-routing`: согласованные частичные routing intents и безопасная история.

### Modified Capabilities

Нет. UI/schema/native/backup format не расширяются.

## Impact

Владение: controller.ts, новый controller-preference-routing helper при необходимости, routing
regression tests/fixture и собственные docs/OpenSpec. База
`d3575934cb5c0ef051714eeeb20edad987ac72ac`.
Build/prepare-version/browser/credentials/push/merge/deploy не входят в worktree scope.
