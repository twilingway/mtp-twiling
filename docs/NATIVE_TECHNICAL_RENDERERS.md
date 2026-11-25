# Нативная отрисовка экземпляров ТА

Исходная база: `949d752`. Расчёты и расширенный OutputStyle взяты из утверждённых `1b060f8` и
`096a8f3`; рендерер универсален для 13 computed definitions.

## Граница интеграции

- `lightweight.ts` и `kline.ts` подключают отдельные native renderer modules к замороженному
  ChartAdapter. `updateTechnicalIndicators` не пересоздаёт chart, свечи или legacy presets, не
  запрашивает историю и не вызывает fit.
- `TechnicalRenderData` использует только общий `calculateTechnicalIndicator`, полный реальный
  Candle-вход и cache по definition/params. После prepend/correction cache сбрасывается. На future
  timestamps данные не создаются. Прогрев передаётся LW как whitespace, KLine как отсутствующее
  числовое значение. Уровни — декоративные price lines/draw callbacks.
- LW использует public pane API 5.0.9: addPane, getPane/moveToPane, moveTo, setStretchFactor. KLine
  сохраняет именованный индикатор при правках параметров/оформления. При изменении порядка нижних
  панелей пересоздаются только принадлежащие renderer нижние TA indicators. Свечи, legacy
  индикаторы, chart и overlay instances сохраняются.
- `plotSize().height` относится к цене. `timeAxisTop()` — общий X внизу внутреннего canvas. Метрики
  отсчитываются от внутреннего контейнера, поэтому внешнее прокручивание двигает их вместе.
  Projection использует шкалу цены, hit conversion отвергает нижние панели.

## Геометрия и сохранение

Root scrollhost должен задать minimum height внутреннего контейнера через
`technicalMinimumCanvasHeight(lowerCount, legacyVolume, actualTimeAxisHeight)`:
`160 + actualTimeAxisHeight + 31 × (lowerCount + Number(legacyVolume))`. Каждая нижняя панель
получает минимум 30 px, разделитель — 1 px; цена — минимум 160 px. Для LW legacy VOL остаётся
overlay и не увеличивает число нижних панелей. Для KLine VOL учитывается. Обычные панели помещаются
в viewport, переполнение прокручивается внешним host.

Нормализация saved ratios выполняется только для отображения. ResizeObserver и программное
восстановление не вызывают `onTechnicalPaneLayout`. Только завершённый pointer resize публикует
полный новый массив preferences, меняя записи действительно изменённых нижних панелей (до 100).
Cancel, blur, viewport resize, новая конфигурация и dispose отменяют незавершённый захват.
`onTechnicalPaneMetrics` сообщает изменившиеся фактические границы для legends/overlays.

Hidden-all панель сохраняет геометрию и metric: легенда позволяет снова включить выходы. Удаление
всех экземпляров либо перенос в другую панель удаляет пустую группу. Collapsed панель сохраняется
высотой 30 px и скрывает выходы без изменения сохранённого ratio.

## Владение и cleanup

KLine использует до 100 переиспользуемых имён TA. Глобальные calc/draw callbacks читают только
переданный native instance.extendData; они не захватывают chart, owner, data или callbacks UI.
Legacy MTP/DRAWINGS перенесены на такой же механизм. Dispose очищает их локальный context. Calendar
XAxis callback захватывает собственный WeakRef; после dispose он не может читать контекст нового
графика даже при повторной регистрации того же имени. Динамические TA canvas подключаются к
существующему KLine resize recovery, удалённые освобождаются.

## Проверка

`native-technical-renderers.test.mjs` и `native-technical-geometry.test.mjs` запускают реальные
adapter factories с fakeNative public API. Проверяются общий core, 13 definitions, два RSI в одной
панели, styles/opacity/dashes, histogram, warmup, reference levels, corrections/prepend, identity,
камера с отрицательным историческим offset, manual LW price range, bounds, 100 instances/панелей,
сохранение hidden/collapsed geometry, user-only callbacks и stale owner cleanup.
`kline-canvas-resize.test.mjs` дополнительно использует установленный native Canvas.

Это source-only пакет. UI/state/backup/lifecycle/ChartPanel/ChartSurface, CSS scrollhost,
index/version, сборка, сервер и браузерная приёмка принадлежат координатору интеграции. Native
browser QA обоих движков ещё требуется после общей сборки.
