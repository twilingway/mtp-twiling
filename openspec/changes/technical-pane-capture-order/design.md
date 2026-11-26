# Design

## Context

Base `f74c33d968d7ca258def096bfc2d731bbdf74b5f`. QA evidence:
`artifacts/ta-render-kline-paint-qa/evidence.json`, actions
paneDragBefore/paneDragAfter/paneDragReconcile. native order size1,size2,size3,size4 после sync стал
size2,size3,size1,size4.

## Goals / Non-Goals

**Goals:** сохранить действительный native order всех lower pane IDs и resized ratios через
capture/persist/reconcile обоих движков.

**Non-Goals:** изменять default grouping sort, native rendering, drawing/camera/data, persistent
schema или owner/import guards.

## Decisions

1. Capture после реального изменения height возвращает полный active pane snapshot, отсортированный
   по фактическому top. Порядок IDs не выводится из названий, orders индикаторов или sparse layout.
2. Ratio изменяется только для pane с height delta>=1. Untouched existing ratio/collapse копируются
   точно; для pane без override материализуется прежний geometry default0.18/collapsed false. Это
   необходимо текущему required ratio shape и не сохраняет viewport-normalized height нетронутой
   панели. Default константа общая для geometry и capture.
3. Runtime context содержит resizedPaneIds и baselineOrder отдельно от полного layout. Writer
   применяет geometry только touched IDs и читает остальные fields из свежих prefs внутри очереди.
   Actual-top order сохраняется, пока относительный порядок baseline saved IDs не изменён предыдущей
   model reorder; тогда выигрывает fresh groups order. Добавленный collapse/height override при
   sparse/empty baseline не является reorder. Removed IDs не восстанавливаются, новые active IDs
   сохраняются. Legacy3arg calls являются partial geometry updates на fresh group order.
4. Typed callback передаёт context вторым аргументом через оба native forwarders и lifecycle;
   WeakMap/hidden array metadata не используются, runtime object не сохраняется в backup.
5. Capture не вызывается при программном resize/restore без completed separator gesture; zero-change
   возвращает null. Event layer не редактируется; native modules получают только forwarding hunks.

## Risks / Trade-offs

- Для untouched panes впервые материализуется уже действовавший default ratio → schema не меняется,
  regression проверяет отсутствие viewport normalization и сохранение pre-existing ratios.
- Native top должен быть coherent после двух frames event gate → source tests проверяют оба
  adapters, actual browser retest выполняет root отдельно.
- Snapshot может устареть при pane remove/move → writer фильтрует по текущим stable IDs;
  routing/import/owner guards не ослабляются.
