# Spec Delta

## Purpose

Сохранять намерения пользователя при быстрых независимых изменениях маршрута графика, не позволяя
отклонённой операции отменить загрузку уже сохранённых настроек или перенести данные между scopes.

## ADDED Requirements

### Requirement: Независимые partial routing intents

Система SHALL сохранять независимые поля быстрых routing requests, принятых в одной действующей
scope. Для одного поля итог SHALL соответствовать последнему valid intent; отдельное поле не
теряется из-за ожидания сохранения камеры или рисунков.

#### Scenario: TF и engine во время storage ожидания

- **WHEN** пользователь выбирает TF1h, затем engine KLine до завершения old-camera save/flush
- **THEN** итоговые preferences содержат TF1h и KLine, а не прежний TF1d

### Requirement: Отклонённый request не отменяет committed reload

Система MUST отменять history предыдущего routing commit только новым actual routing commit или
существующей owner/import/session границей. Rejected depth/valid request не считается commit.

#### Scenario: Invalid depth во время preferences persistence

- **WHEN** TF уже committed, savePreferences ожидается, а depth request отклонён camera/ready guard
- **THEN** TF history запускается после persistence и не остаётся пустой из-за rejected request

#### Scenario: Depth и независимый force при indicator refresh

- **WHEN** depth и отдельный forced sidebar intent ожидают camera save, а indicator refresh отменяет
  depth
- **THEN** depth record отклоняется целиком, отдельный valid force/sidebar применяется
- **AND** transient loading/ready bounce не активирует уже отменённый depth record заново

### Requirement: Атомарный staged reload

Система SHALL устанавливать historyViewReady=false в том же update, который меняет reload
preferences и очищает candles. История MUST запускаться только после успешного persistence; ожидание
старой сети не блокирует следующий preference commit.

#### Scenario: Окно await savePreferences

- **WHEN** reload preferences опубликованы, но storage write ещё не завершён
- **THEN** depth UI заблокирован ready flag и новый history request ещё не начался

### Requirement: Сохранение исходной scope и camera guards

Система MUST сохранять old-camera key до изменения preferences, original valid/forceReload и sticky
owner/client/revision/import cancellation. Stale intents не переносятся через bounce, а nonrouting
изменения во время carry не перезаписываются.

#### Scenario: Import bounce и изменение оформления

- **WHEN** routing request ждёт camera copy, затем происходит import start/end в той же owner scope
- **THEN** старый request не применяется после bounce
- **AND** без bounce новое nonrouting оформление сохраняется при завершении valid routing carry
