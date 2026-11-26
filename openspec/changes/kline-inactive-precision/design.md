# Design

## Context

Readonly8case report находится в sibling ta-kline-inactive-precision-review. Native calcRange берёт
minprecision, optimalTicks/max format берут maxprecision всех instances без visible/figures guard.
Удаление только owner либо fill недостаточно. Explicit precision ставит native precision-lock;
реактивация native-price поэтому требует fresh active member.

## Decisions

- Active означает visible public plot с finite value в actual realFrom<=index<realTo viewport;
  opacity0 остаётся active. Используются public getVisibleRange/getIndicatorByPaneId/price
  precision.
- Active original owner/companion families и native inheritance сохраняются. Inactive роли имеют
  separate Normal registration, calc=[], figures=[], precision внутри действующего min..max peers.
  При отсутствии domain contributors используют Normal0, без numeric prices/figures.
- Все собственные members исключены из foreign candidate scan. Eligible owned sources планируются из
  текущих compiled public plots; никакого заимствования из other decorators/hidden internals. Main
  candle использует реальный current native candle/area data и price precision.
- Levels остаются на positive primary draw, fill на прежнем negative companion. Они используют
  законную проекцию другого источника, не создавая независимого domain. Whole hide/collapse
  сохраняют маски compiler.
- Replacement создаёт новые roles до удаления старых, сохраняя native pane. Старые contexts retired;
  callbacks epoch/liveness guarded. Same-role metadata writes только при изменениях.
- Price format forwarding вызывает synchronous refreshNativeMetadata до setStyles. Owned coalesced
  visible-range/data-ready listener обновляет eligibility/metadata, не формулы/полные
  rows/prefs/camera.
- Source partial fixtures без необходимой public API сохраняют прежнюю controlled surface; новые
  tests предоставляют полную actual native boundary и доказывают fix.

## Risks

SDK удаляет pane при remove последнего indicator. Create-before-remove и native liveness tests
обязательны. Late async native calc не должен повторно публиковать retired contexts. Foreign public
API changes вне приложения требуют явного refresh entrypoint; текущие app lifecycle callbacks
покрываются update/data/range/price forwarding. Visible scans ограничены actual viewport, не имеют
искусственного work cap/подмены eligibility; стоимость фиксируется в отчёте.

## Open Questions

Материальных product decisions нет: root принял A и этот bounded runtime scope. Browser pixels и
интеграция релиза выполняются отдельными свежими workers после frozen commit.
