# Proposal

## Why

Actual KLine separator drag сохраняет новые высоты, но следующий reconcile переставляет незатронутую
панель: sparse capture содержит только resized IDs. Capture writer также удерживает старый sparse
order при сохранении полного нового snapshot.

## What Changes

- Capture сохраняет все фактические lower pane IDs в порядке native top.
- Только resized ratios меняются; untouched saved ratios/collapse либо прежний default0.18
  сохраняются.
- Shared writer сохраняет captured order с прежними owner/import/session guards и фильтрует
  удалённые IDs.
- Общий regression проверяет callback→persist→reconcile для обоих engines.

## Capabilities

### New Capabilities

Нет.

### Modified Capabilities

Нет новых требований: восстановлено уже принятое поведение `Durable layout and portable state` из
`technical-indicator-panels/specs/technical-indicator-layout/spec.md`. `skip_specs` относится к
implementation bugfix, новый параллельный contract не вводится.

## Impact

Только shared capture и его persistence hunk, собственные tests/docs. Без native source edits, новых
полей/миграции, controller guard changes, сборки, браузера, version и Google API.
