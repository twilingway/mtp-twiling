## ADDED Requirements

### Requirement: Current heads require readable payloads

Reader SHALL проверять payload всех актуальных heads до accept, portable import или публикации
дочернего снимка независимо от persisted baseHeads.

#### Scenario: Same unknown head

- **WHEN** сохранённый baseHeads совпадает с head неизвестного envelope, TA instance или style
- **THEN** clean/dirty/manual/automatic sync отклоняется без import, acceptance checkpoint и upload
- **AND** bytes и association heads сохраняются

#### Scenario: Standalone writer

- **WHEN** publish или resolve вызван непосредственно с неподдерживаемым родительским payload
- **THEN** ни blob, ни snapshot не публикуется

### Requirement: Reads remain bound to immutable snapshots

Reader SHALL сверять identity manifests и heads после чтения payload и перед публикацией; изменение
содержимого уже наблюдавшегося node ID SHALL блокировать операцию.

#### Scenario: Download race

- **WHEN** между inspection и завершением download появились другие heads или изменился manifest
  существующего node
- **THEN** прежний payload не принимается как проверка нового состояния и новый snapshot не
  публикуется на основании этой проверки

### Requirement: Unsupported local association is preserved

Loader SHALL создавать association только при её отсутствии. Неизвестная версия или неизвестные поля
существующей association SHALL отклоняться до любых fallback writes.

#### Scenario: Newer association on restore

- **WHEN** профиль содержит неизвестную association
- **THEN** её bytes, marker, heads и automatic сохраняются
- **AND** статус показывает остановку с предложением обновить приложение, без connected и autosync

### Requirement: Unsupported pause retains saved Google credentials

Reader SHALL сохранять действующие Google credentials при unsupported pause через non-destructive
auth suspension. Format guard SHALL прерывать handles без изменения ciphertext/generation/expiresAt.

#### Scenario: Saved authorization meets unsupported data

- **WHEN** automatic restore или явный connect обнаруживает unsupported remote/local формат
- **THEN** handles прерываются и autosync останавливается без guard-induced vault writes/removal
- **AND** совместимый reader восстанавливает credential без Google prompt до исходного expiry

#### Scenario: Actual expiry after compatible reopen

- **WHEN** восстановленный credential достигает исходного expiresAt
- **THEN** штатный conditional expiry удаляет только свою generation, сохраняя другой owner и более
  новую generation

### Requirement: Supported data retains existing behavior

Reader SHALL сохранять текущие envelope1/2 и TA instance1 flows, epoch/revision/connection guards и
отсутствие переноса ключей/котировок.

#### Scenario: Supported same head

- **WHEN** текущий payload поддерживается
- **THEN** clean sync принимает checkpoint, а dirty sync публикует текущий формат после проверки
  родителя
