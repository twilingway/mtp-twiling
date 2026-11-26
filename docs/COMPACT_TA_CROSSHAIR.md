# Compact TA crosshair

Source-only fix от `f889aebb14b9b330913a73595aed11c39b7e5fcd`, tree base совпадает с frozenffc13bb.
Own WT `artifacts/compact-ta-crosshair`; root QA/source не менялись. Пользовательский bug: product
screenshots17-linear-lw-settled/22-kline-collapsed-crosshair показывали horizontal price box в30px
collapsed RSI при уже скрытых static ticks. Прочитан только текстовый metadata
`artifacts/release-0323-product-qa/collapsed-crosshair-kline.json`; изображения/browser в этом
author context не открывались.

## Поведение

Helper `technical-compact-crosshair.ts` принадлежит одному technical manager. Compact — живой lower
TA pane key `pane:*`, actual height>0 и<=30 CSSpx. Учитывается также manual native resize до30 без
collapsed preference. Height31 и выше, main/candle, legacy volume и foreign panes сохраняют исходную
horizontal label policy. Persistent layout/schema/data не меняются.

LW использует public MouseEventParams.paneIndex, pane identity map manager и sourceEvent.clientY.
KLine public OnCrosshairChange содержит top-level paneId и pane-local y; technical prefix
переводится в стабильный pane key. Pointer clientY в capture phase сохраняет физический hover при
stationary expand/remove/reorder; если coordinate отсутствует, используется только известный native
pane key, без выдуманной midpoint/price координаты. Событие leave и pointerleave восстанавливают
policy. При наведении на axis вне plot pointer handler не подавляет label.

Меняется только horizontal label flag: LW `crosshair.horzLine.labelVisible`; KLine
`crosshair.horizontal.text.show`. Horizontal line, vertical line/time label, глобальный mode/Show и
user cursor prefs не записываются. Original disabled horizontal label сохраняется. Current
CrosshairMode.Hidden / K crosshair.show=false не включаются обратно при restore.

## Геометрия и ownership

LW5.0.9 PriceAxisWidget.optimalWidth учитывает horizontal crosshair label reserve. Поэтому toggle
без width hold способен сжать plot. Helper в одной public applyOptions операции сохраняет текущие
widths visible global axes через temporary minimumWidth. При restore возвращает original minima
только если current value всё ещё равно его собственному held value. Observable external
minimumWidth update сохраняется.

KLine9.8.12 YAxis.getAutoSize также учитывает horizontal text. В auto-режиме temporary public
yAxis.size удерживает текущую width и возвращается вauto при restore, если приложение не заменило
held size. Actual app fixed numeric yAxis.size не записывается вообще; новая external fixed size
сохраняется. Native axis visibility не выключается. Опасный LW multi-pane visible=false/widget-null
путь не используется.

Baseline и ownership state записываются до applyOptions/setStyles; reentrant native events во время
записи игнорируются. Повторный hover внутри той же compact strip не делает новых options writes.
Native subscription один на manager, плюс два owned pointer listeners. Geometry читается на hover и
existing metrics/settlement hooks, без RAF polling/per-series listeners/повторного расчёта формул.
Dispose сначала снимает listeners, затем восстанавливает свои options, если chart owner ещё alive.
После retired/dispose события не применяют options и не читают geometry.

Production diff только helper и точечные hooks/imports в
lightweight-technical.ts/kline-technical.ts. Base adapters, camera, quotes, numeric arrays, scale
ranges/precision, pane heights/order, static tick policies и old50 registry/witnesses не менялись.
Same-dimensions hover не требует new min/max anchors/zero data или priceScale visible=false.

## Source evidence

Installed SDK files проверены SHA256:

- LW5.0.9 development.mjs `dec157fcccf103e2d152cce52b29204a66ab3a7df713af4132e6bb70e22233b9`.
- KLine9.8.12 index.esm.js `313a26786af901e2b5b93c16ac002c6ceeebb54ecc9b6a55e386f1b31805ca5d`.

`test/technical-compact-crosshair.test.mjs`13/13 PASS: реальные source manager hooks, public style
flags/subscription counters, bounded reentry, compact/manual30/main/legacy/expanded/leave,
stationary expand/remove/reorder, dispose/late event, current Hidden mode, external minima/size,
actual app fixed width. Whole installed bundles исполняются вVM с controlled DOM/chart boundaries:
actual LW CrosshairPriceAxisView и PriceAxisWidget.optimalWidth, actual K
CrosshairHorizontalLabelView draw и YAxis.getAutoSize. K arbitrary empty-strip text получается из
actual YAxis.calcRange/convertFromPixel, не inserted quote. Эти units проверяют native label paths и
sizing reserve, не browser pixels.

Baseline source suites75/75 PASS: native renderers22, K render15, LW render17, K settle7, static
compact axis2, capture order8, native geometry4. Whole-source strict compilerhost PASS с virtual
version strings только если generated module отсутствует; scoped ESLint/Prettier и strict
OpenSpec57/57 PASS. Полный app build/version/browser/full product suite не запускались.

## Следующий gate

После frozen commit root интегрирует fix и новый fresh isolated worker повторяет actual PRODUCT
hover: collapsed RSI box отсутствует, horizontal line/time cursor и current mode сохранены;
leave/main/legacy/expand/remove/reorder и mobile/DPR проверяются отдельно. Source tests не заменяют
этот actual-paint gate; release/merge до него здесь не утверждаются.
