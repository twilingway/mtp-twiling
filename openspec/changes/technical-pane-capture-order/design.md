# Design

## Context

Base `f74c33d968d7ca258def096bfc2d731bbdf74b5f`. QA evidence:
`artifacts/ta-render-kline-paint-qa/evidence.json`, actions
paneDragBefore/paneDragAfter/paneDragReconcile. native order size1,size2,size3,size4 после sync стал
size2,size3,size1,size4.

## Goals / Non-Goals

**Goals:** сохранить действительный native order всех lower pane IDs и resized ratios через
capture/persist/reconcile обоих движков.

**Non-Goals:** изменять default grouping sort, native adapters, drawing/camera/data, persistent
schema или owner/import guards.

## Decisions

1. Capture после реального изменения height возвращает полный active pane snapshot, отсортированный
   по фактическому top. Порядок IDs не выводится из названий, orders индикаторов или sparse layout.
2. Ratio изменяется только для pane с height delta>=1. Untouched existing ratio/collapse копируются
   точно; для pane без override материализуется прежний geometry default0.18/collapsed false. Это
   необходимо текущему required ratio shape и не сохраняет viewport-normalized height нетронутой
   панели. Default константа общая для geometry и capture.
3. Writer принимает порядок capture как authoritative для актуальных IDs. Прежние active IDs,
   отсутствующие в snapshot, сохраняются следом в свежем persisted order; removed IDs не
   восстанавливаются. Existing TA write serialization/valid callback/owner/import/session guards
   остаются прежними.
4. Capture не вызывается при программном resize/restore без completed separator gesture; zero-change
   возвращает null. Event layer и native modules не редактируются.

## Risks / Trade-offs

- Для untouched panes впервые материализуется уже действовавший default ratio → schema не меняется,
  regression проверяет отсутствие viewport normalization и сохранение pre-existing ratios.
- Native top должен быть coherent после двух frames event gate → source tests проверяют оба
  adapters, actual browser retest выполняет root отдельно.
- Snapshot может устареть при pane remove/move → writer фильтрует по текущим stable IDs;
  routing/import/owner guards не ослабляются.
