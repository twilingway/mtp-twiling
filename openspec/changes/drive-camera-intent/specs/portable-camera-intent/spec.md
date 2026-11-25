## ADDED Requirements

### Requirement: Немедленная защита пользовательской камеры

Приложение SHALL увеличивать local portable revision синхронно до native pan/zoom/navigation/focus,
включая промежуток до RAF. Pending incoming MUST NOT применяться после такого intent без новой
проверки.

#### Scenario: Pan во время download

- **WHEN** устройство начало pan после исходящего snapshot и до завершения remote.download
- **THEN** удалённый вид не применяется поверх новой пользовательской камеры

#### Scenario: Навигация до ближайшего кадра или commit

- **WHEN** пользователь нажал zoom/reset или начал жест перед RAF/IDB write
- **THEN** guard уже видит новую revision, даже если native geometry ещё прежняя

### Requirement: Сохранение только пользовательского изменения

Приложение SHALL сохранять settled X ChartView с debounce после доказанного изменения user epoch.
Quote/updateBar, initial fit, restore, resize и hover MUST NOT создавать dirty или echo
самостоятельно.

#### Scenario: Поток котировок и программное восстановление

- **WHEN** приходят котировки, меняется размер или применяется сохранённый вид без user gesture
- **THEN** autosave/Drive snapshot не создаётся

#### Scenario: Пользовательский pan пересекается с котировками

- **WHEN** пользовательский вид изменяется одновременно с market render/updateBar
- **THEN** готовая камера сохраняется без потери intent и без сохранения каждого тика

### Requirement: Владение и завершение

Сохранение SHALL проверять owner/session/UID/viewKey/revision/adapter и import guards до записи.
Уничтожение adapter или смена источника MUST отменять его delayed callbacks.

#### Scenario: Профиль сменился до settle

- **WHEN** старый adapter завершает жест после смены владельца или retire
- **THEN** ни локальный вид нового профиля, ни его Drive revision не изменяются
