# Design

## Context

См. proposal. Existing static tick suppression не скрывает crosshair overlay. LW global labelVisible
участвует в axis optimalWidth; axis visible=false опасен для installed5.0.9 multi-pane widgets.
KLine actual action несёт top-level paneId и pane-local y.

## Goals / Non-Goals

Owned helper с одним SDK crosshair subscription на manager и pointer position cache. Нет per-series
listeners, RAF polling, data/scale/pane writes, persistent fields или изменения default cursor mode.

## Decisions

- Живые measured bounds и actualheight<=30 определяют compact TA strip, включая manual resize.
  Public native pane ID/index переводится в stable manager key; DOM pointer clientY сохраняет
  physical hover при stationary reorder.
- Меняются только horizontal label flags. Baseline capture/ownership state устанавливается до SDK
  write; reentrant events во время write игнорируются. Clear/restore идёт тем же guard.
- Public axis width hold предотвращает shrink от исчезновения label reserve: LW temporary
  minimumWidth для visible global axes; KLine auto size временно получает прежнюю width. Restore
  возвращает original sizing options вместе с flags. Native axis visibility не выключается.
- Existing metrics/settlement hooks вызывают refresh; dispose снимает listeners до restore.
  Недостающий SDK surface в controlled legacy fixtures получает no-op capability boundary.

## Risks / Trade-offs

Hover меняет global horizontal overlay flags на время нахождения в одной панели → vertical и mode не
записываются, source tests проверяют restoration. Native paint требует отдельного fresh browser
worker после frozen commit.
