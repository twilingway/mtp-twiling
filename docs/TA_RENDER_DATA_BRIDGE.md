# Runtime bridge для двух chart adapters

26.11.2026. Отдельная ветка `feat/ta-render-integration`. Base compiler
`9bc5cdd5c1e819f0d4d09c9dbc5b28f1acf8923a` независимо проверен; sparse style fix8138 интегрирован
отдельно. Этот этап не включает регистрацию SAR/ST или подключение palette к существующим TA.

`TechnicalIndicatorDefinition.presentation` — необязательный typed renderVersion2 descriptor.
Definition остаётся data-only. Instance/backup/schema1, params и numeric result не расширяются.
Definitions без metadata проходят старый путь и сохраняют прежний output shape.

`TechnicalRenderData.compile()` теперь возвращает `{groups, outputs, fills}`. Числовой result cache
по definition/params сохранён; style/layout changes повторно компилируют presentation без повторного
расчёта формулы. Никаких зависимостей от видимого диапазона или camera нет.

- `TechnicalRenderOutput.presentation` присутствует только для metadata-aware definitions. `values`
  соответствуют descriptor.seriesKey с исходными null; style использует resolved defaults и explicit
  legacy override. `kind` остаётся line/histogram для существующих native paths; metadata columns
  требует histogram, line/cross требует line.
- Visible definition.outputs и presentation.plots обязаны иметь одинаковые IDs/count. Hidden anchors
  не создают additional outputs и не входят в figure/scale lists.
- `TechnicalRenderFill` содержит stable `key`, instanceId/paneKey/order/timestamps, две исходные
  numeric arrays, color/opacity/visibility и scale:none. `scalePlotKey` предпочитает plot с
  seriesKey=toSeries, затем fromSeries, затем первый plot того же instance. Это coordinate carrier
  на общей шкале, **не** дополнительный scale input. Fill без owning plot отклоняется. Native код не
  создаёт carrier для hidden body/direction.
- Descriptor.precisionPolicy задаёт native-price либо legacy-fixed-6; отсутствие означает
  legacy-fixed-6. Resolved policy одинакова у owner plots и decorative fills. Она не выводится из
  текущего pane/glyph/ID: SAR/ST сохраняет native price sync после перемещения в нижнюю панель.
  Legacy metadata/новые histogram palettes сохраняют прежний fixed6 путь. Это native semantic
  metadata, не новое persisted поле.
- Fill visibility независима от отдельного stroke visibility. Hide/collapse instance скрывает все
  fills; снятие visible у одного stroke не записывает изменения в fill. Этот runtime contract
  проверяется source tests; actual native visibility/scale ещё требует gate.
- Legacy adapters пока не читают дополнительные поля. Новые renderers должны использовать
  presentation.geometry/color policy, shared indexed runs и owned lifecycle. Fills рисуются в
  заданных background layers; display metadata не может попасть в persistence.

Проверки: 5 bridge tests с controlled numeric result, 9 compiler tests и 6 style tests —20/20.
Отдельно настоящий SMA length1 без metadata сохраняет exact legacy output. Проверены cache reuse,
stable keys, hidden anchors, collapse/manual style, declaration/geometry mismatch, отсутствие
presentation в instance JSON и strict instance rejection этого лишнего поля. Typecheck host strict
PASS с единственным виртуальным baseline version module; ESLint/Prettier PASS. Фальшивые numeric
result в bridge unit fixture не используются как market data или browser evidence.

После precision/direction follow-up прежние native renderer/geometry/settlement suites33/33
сохранили PASS для всех45 существующих формул и legacy camera/lifecycle. Новые SAR/ST create/scale и
paint этим не проверены. Typecheck/lint/scoped format повторены после изменения общего контракта.

Pending: независимый bridge review, native implementations/LW+KLine paint/precision/lifecycle,
согласование G5 перед новым persistent форматом, registration и public release acceptance.
