# ТА: текущая отдельная работа

Основа 6d5fbbf, ветка feat/technical-indicator-integration. Ветка не меняет canonical runtime .16.

Пользователь требует все ТА-индикаторы и поиск, корректное размещение на цене/ниже, перестановку
нескольких индикаторов в панели с сохранением. Он спит и разрешил автономные браузерные проверки в
своей отдельной копии Chrome, без вмешательства в обычный профиль. Ручной вход Google откладывать,
остальные задачи продолжать.

Уже прочитаны: technical-indicators/types/definitions/instances/runtime и docs/contract/integration,
IndicatorLegend, TerminalIndicatorLibrary, indicator-legend/layout, kline-indicators, lightweight,
chart-lifecycle/render-config. Чистое ядро содержит семь computed definitions с pane/order/params.
Оно ещё не подключено к интерфейсу. LW volume сейчас overlay с отдельной шкалой, KLine volume
создаёт volume_pane. Общая сохранённая раскладка пока знает только volume.heightRatio.

Reference: vps/artifacts/indicator-catalog-reference/catalog.json и report.md. Всего 224 записи, но
именно indicators=127; остальное — стратегии/паттерны/профили/options. Это metadata, не готовые
алгоритмы. Не объявлять все 224 вычисленными и не подменять неизвестные расчёты пустыми рядами.

Следующий контракт: optional technicalIndicators:TechnicalIndicatorInstance[] в обеих preferences,
строгое round-trip через JSON/Drive, панели по стабильным pane.id; старые флаги сохраняются.
Существующие instances уже поддерживают order и объединение по pane.id. Разделить engine rendering,
UI settings/order и новые math families, не назначая нескольким writers shared registry/type unions.

Другие writers: drawing_settings_preview (бывший watchlist_details_vertical_resize) изменяет
TerminalState transient preview, ChartSurface drawing selector, chart-lifecycle redraw deps,
DrawingAxisLabels и drawings/_; не пересекать эти изменения без явного слияния. Bybit foundation
пишет только новые services/providers/bybit/_, shared prefs/TA не трогает.

Реализован первоначальный контракт preferences/JSON/Drive и чистая группировка/перестановка
technical-indicator-layout.ts. 7 новых тестов проходят, в том числе реальные storage save/load,
разделение owner, invalid import и неизменность параметров при перестановке. Core+старыйlayout+
новые тесты: 27/27. Strict typecheck/scopedlint проходят. Это ещё не нативное подключение ТА.

ChartOptions содержит optional technicalIndicators, technicalPaneLayout, onTechnicalPaneLayout и
onTechnicalPaneMetrics. ChartAdapter: updateTechnicalIndicators, technicalPaneMetrics, timeAxisTop.
Metric key: price / legacy:volume / pane:<raw id>, top/height/width относительно container.
PlotSize.height должен обозначать ценовую панель; timeAxisTop отдельно — глобальную X-ось. Между
schema1 и будущим schema2 writer ещё нужно выполнить общую интеграцию и проверки.
