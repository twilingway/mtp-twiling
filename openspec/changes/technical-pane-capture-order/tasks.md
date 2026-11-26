# Tasks

## 1. Capture и writer

- [x] 1.1 Воспроизвести loss порядка на frozen source в собственном regression, сохранить exact QA
      evidence paths в docs.
- [x] 1.2 Сохранить полный native order и только touched ratios; проверить stable IDs/nondefault
      order/hidden/collapsed/stacked/max100/no-op.
- [x] 1.3 Исправить shared capture writer без изменения guards; проверить persist/reconcile, pending
      remove/move и transient owner/import cancellation.

## 2. Scoped integration

- [x] 2.1 Выполнить оба adapter regressions, прежние layout/actions/geometry/settlement suites,
      virtual-version source noEmit, scoped lint/format и strict spec; записать результаты.

## Workflow follow-up

- Frozen commit/full SHA/clean WT передать root; native/browser retest остаётся root gate.
- Архивировать после review, без изменения frozen R worktree.
