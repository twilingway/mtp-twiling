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

## 3. Runtime queue intent follow-up

- [x] 3.1 Разделить full order и resized geometry явным callback context; проверить original8 и
      actual lifecycle forwarding2, без persistent metadata и hidden array properties.
- [x] 3.2 Проверить queued collapse/height на full/partial/empty baseline, queued reorder и new IDs;
      current race9/9 PASS, read-only git-show d5 writer8 FAIL/1 PASS.
- [x] 3.3 Повторить scoped baseline suites:65/65 PASS; source noEmit/lint/format PASS, strict
      OpenSpec51/51 PASS. Передать follow-up frozen SHA/clean WT для независимого review.

## Workflow follow-up

- Frozen commit/full SHA/clean WT передать root; native/browser retest остаётся root gate.
- Архивировать после review, без изменения frozen R worktree.
