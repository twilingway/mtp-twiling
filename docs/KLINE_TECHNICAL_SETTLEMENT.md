# KLine: завершение асинхронного создания панелей

Исправление от source cut `f639c19e067c9bd8479dcc0066029ced54863f56`.

## Подтверждённая причина

В установленном KLine 9.8.12 `IndicatorImp.calcIndicator` и `IndicatorStore.addInstance` используют
await даже при синхронном массиве общего ТА-ядра. `ChartImp.createIndicator` имеет два разных пути:

- Для новой панели сначала создаются bounds, затем после calc вызывается полная разметка и публичный
  completion callback.
- Для существующей панели после calc повторно вызывается `_setPaneOptions(paneOptions)`. Переданный
  `height` меняет высоту панели на этом позднем шаге. Completion callback в этой ветке 9.8.12 не
  вызывается.

Рендерер передавал `height:80` каждому экземпляру. Добавление второго RSI в общую панель позднее
сбрасывало уже нормализованную высоту. Синхронные fakeNative тесты не моделировали этот шаг. Кроме
того, метрики сообщались до native DOM paint, а передний canvas цены не получал собственного repaint
после окончательной геометрии. Он мог временно сохранять старую высоту.

Контролируемое browser QA на замороженном 13-TA source cut не подтвердило постоянный дефект нативных
bounds: они совпали immediately/250 ms/1 s/reload. Подтверждён transient overlay height 378.39 → 537
к 1 s. Причинная связь раннего постоянного gap после LW crash не установлена. Это исправление
устраняет воспроизводимые source races; общий browser gate остаётся открытым.

## Изменение

- Только первый экземпляр задаёт initial pane height/minHeight/dragEnabled. Stacked экземпляры
  передают `{id}` и не могут переиграть высоту после calc.
- Completion создания/override объединяется в bounded settlement. В первом native frame повторно
  применяется сохранённая геометрия и обновляются canvas observers. Следующий frame ждёт вызванный
  этим native paint, сообщает согласованные метрики и перерисовывает передний canvas.
- Callback хранит только WeakRef на локальный gate и номер ревизии. Устаревшая конфигурация и
  disposed owner не публикуют метрики и не рисуют. Dispose отменяет ожидающий frame и очищает
  callback, удерживающий chart.
- Публичный ChartAdapter не меняется. Внутренний `klineTechnical` получает `paintFront`.
  Programmatic settlement не вызывает callback сохранения layout.

Remount, замена данных, fit, восстановление камеры, UI/state/storage/LW не затронуты.

## Проверка

`kline-async-fixture.mjs` исполняет реальные установленные методы `ChartImp.createIndicator`,
`_setPaneOptions`, `_measurePaneHeight`, `adjustPaneViewport` и `overrideIndicator`. Управляемыми
остаются calc promise, public fakeNative storage и DOM paint. На исходном source cut новые тесты
воспроизводят сброс 348.4 → 80 px и stale foreground canvas.

Сценарии: второй RSI в общей панели; add/group/reorder/remove; фактическая высота X 23 px;
сохранение data/chart identity и X camera; отсутствие persist callbacks; устаревшая конфигурация;
late completion после dispose. Native browser QA выполняется отдельно владельцем браузера.

Дополнительные проверки не воспроизвели отдельный blank-axis/drawings blocker: static DRAWINGS через
текущий extendData рисует line/Fib stroke и fill; installed Canvas recovery оставляет нарисованное
содержимое после каждого backingstore reset при initial/TA/viewport resize. В installed
`_overrideInstance` новая extendData wrapper вызывает calc даже при прежнем context; adapter готовит
rows до native applyNewData. Production-код этих механизмов не менялся. Причина наблюдавшихся в
браузере неполных свечей/RSI и пустой оси 0..10 пока не установлена.
