# Исправление KLine native settlement

См. `docs/KLINE_TECHNICAL_SETTLEMENT.md`.

Существующие требования Explicit pane placement, Durable layout, Real-data calculation boundaries и
Scoped asynchronous edits уточнены regression-сценариями без расширения публичного контракта:

1. Добавление второго RSI в существующую панель сохраняет её высоту после завершения native calc.
2. Add/group/reorder/remove обновляют согласованные DOM/native metrics и передний canvas без reload,
   remount, замены свечей, fit или сброса камеры.
3. Программная переразметка не сохраняет layout. Завершение старой конфигурации либо disposed owner
   не публикует геометрию и не вызывает repaint.
4. Сохранённые дробные ratios преобразуются в целочисленные KLine pane bounds с сохранением общей
   высоты. Установленный Canvas воспроизводит stale paint при fractional bounds даже со здоровыми
   buffers; целочисленные bounds позволяют обычный repaint без viewport resize/fit.

Installed-method source fixture воспроизводит две ошибки на исходном `f639c19` и проходит после
исправления. Общая browser приёмка и задачи 2.3/5 остаются ответственностью координатора.
