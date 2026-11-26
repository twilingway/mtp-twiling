# Tasks

## 1. Geometry и palette

- [x] 1.1 Реализовать cross/linebr/indexed fills и shared color resolver; проверить geometry/palette
      сценарии в `node test/ta-render-kline.test.mjs`, описать limits в `docs/TA_RENDER_KLINE.md`.
- [x] 1.2 Реализовать typed columns-base0 через public figure без pseudooutput; проверить actual
      range, paint, tooltip, axis labels, crosshair, collision и all-null/hide/collapse/remove
      сценарии тем же native suite.

## 2. Native ownership и precision

- [x] 2.1 Разделить class-default policy до create/sync, owned companion z-order и bounded slots;
      проверить actual SDK G7 6→8→6, lower-pane move, reorder и disposal тем же suite; записать SPI
      evidence в docs.
- [x] 2.2 Сохранить legacy path/geometry/settlement; проверить
      `native-technical-renderers.test.mjs`, `native-technical-geometry.test.mjs`,
      `kline-technical-settle.test.mjs` напрямую через node.

## 3. Scoped integration

- [x] 3.1 Выполнить source TypeScript noEmit с in-memory version declaration, scoped
      ESLint/Prettier, strict OpenSpec validation: PASS, specs50/50, native+legacy48/48.
- [x] 3.2 Проверить ownership diff: только два production modules и собственные tests/docs/spec, без
      shared/persistence/version changes; `git diff --check` чистый.

## Workflow follow-up

- Заморозить source-only commit; передать full SHA и clean worktree status root интегратору.
- Root интегратор выполняет G2 browser paint: linear/log/inverted, DPR1/2,
  resize/reorder/hidden/collapse, MTP/drawings/cursor; native trace не заменяет этот gate.
- Архивировать после общего contract review и интеграционной проверки metadata definitions.
