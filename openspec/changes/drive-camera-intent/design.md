# Design

## Context

X-вид уже входит в Backup1. LWC setters завершаются через RAF; KLine и LWC посылают native events
также при программных действиях. Поэтому raw getView polling или любое visibleRange событие не
являются пользовательской правкой. Y bounds не входят в текущий переносимый формат.

## Goals / Non-Goals

**Goals:** защитить pan/zoom до RAF/commit; сохранять доказанную пользовательскую X-камеру.
**Non-Goals:** Y-sync, новая schema, изменение истории/банка/общего runtime.

## Decisions

- Optional `ChartOptions.onCameraIntent` вызывается синхронно до native действия; `onCameraChange`
  получает готовый изменённый ChartView после settle. Adapter begin/endViewInteraction отделяют
  input start от настоящего движения; start без изменения отменяет stale incoming без autosave.
  `onCameraIdle` завершает no-change/cancel/unavailable путь без фиктивного сохранения.
- Capture pointer/wheel/double-click и навигационные команды отмечают intent до library/RAF.
  Focus/fit — явные user actions. Перемещение crosshair без нажатия не является intent.
- Общий observer объединяет native Zoom/Scroll/visibleRange с активным user epoch и сравнивает
  камеру до/после. Programmatic setData/updateBar/setView/resize не открывают user epoch и сами
  никогда не сохраняются. Timers/RAF bounded и отменяются при destroy.
- Новый WeakMap helper проверяет bank session, owner, UID/viewKey, chartRevision, owned adapter,
  retired/persistView/historyViewReady/import/recovery. Он копирует готовый ChartView до async
  работы, сериализует scoped saveChartView и публикует changed только после успешного локального
  сохранения. Сбой даёт одно RU/EN уведомление и держит синхронизацию камеры до следующего успешного
  изменения.
- Drive получает intent revision немедленно без upload. Settled changed запускает прежний debounce.
  Уже существующий valid проверяет эту revision после network/queue/saveView и в IDB transaction.
- Pending scoped intent блокирует начало новой Drive операции до settle/durable save. Это закрывает
  случай, когда poll начался уже после intent, но раньше 250 мс debounce. Старый scope не блокирует
  новый owner/canvas; destroy очищает callbacks/timers и permanently retires wrapper.
- Drive export сначала ждёт pending camera writes, затем использует существующую transfer queue с
  `captureView:false`: flush editing/client/storage сохранён, повторного чтения live chart нет.
  Иначе periodic/focus export сам сохранял quote-shifted anchor/from/to и создавал ложный digest.
  Manual JSON, pagehide и штатный flush по умолчанию сохраняют live view. В controller изменены
  только optional export/flush options; setPreferences и depth carry не меняются.

## Risks / Trade-offs

- Начало клика без pan консервативно отменяет stale incoming, но не создаёт снимок.
- Недоступный getView повторяется ограниченно; retired/сменившийся источник не сохраняется.
- Незавершённый import/recovery блокирует native input в capture до применения canvas mutation;
  recovery/account controls остаются доступны.
- Вид ограничен существующим X camera/UTC anchor. Вертикальная шкала не обещается
  синхронизированной.

## Migration Plan

Нет миграции. После unit/integration checks координатор делает отдельный browser gate обоих charts.
