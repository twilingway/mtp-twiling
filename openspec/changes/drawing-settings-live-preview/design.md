# Design

## Context

`editing.previewGesture` изменяет state.drawings, который наблюдает Drive. Для модального draft это
нарушает изоляцию. Существующий DrawingSettingsDialog содержит все поля, но подтверждает их только
через updateDrawing.

## Goals / Non-Goals

**Goals:** отдельный transient scope, однократный commit, читаемые inline controls; формы до 500
строк.

**Non-Goals:** defaults, adapters, новые инструменты, изменение правил блокировки и переносимых
схем.

## Decisions

- Optional `drawingSettingsPreview` хранит token, scope, reference оригинала и валидный Drawing.
  `state.drawings` остаётся committed.
- TerminalDrawingPreview предоставляет begin/preview/cancel/commit. Scope включает owner, symbol,
  UID, engine, timeframe и chartRevision. Диалог, выбранный объект и ссылка оригинала также
  проверяются.
- Controller.update очищает невалидный transient до уведомления слушателей. Селектор отрисовки
  повторно проверяет scope; ChartSurface, DrawingAxisLabels и redraw dependencies используют
  transient. Экспорт/Drive/IDB не меняются.
- Commit вызывает existing editing.change ровно один раз; состояние preview исчезает атомарно при
  замене оригинала. Cancel не пишет и не добавляет undo.
- Числовые пустые поля превращаются в NaN, а не 0. Невалидный кандидат не отправляется в renderer;
  valid draft остаётся локальным до исправления.
- Формы координат/видимости вынесены отдельно. OpacityControl повторно используется inline и в
  палитре; LineStylePicker сохраняет существующие preview.

## Risks / Trade-offs

- Изменение committed объекта извне во время диалога → reference guard отменяет preview и commit.
- Viewport и синхронизация могут обновляться во время draft → selector не меняет committed массив,
  Drive digest остаётся прежним.
- Визуальная интеграция требует нового CSS → координатор подключает drawing-opacity.css и выполняет
  QA после общей сборки.
