## Purpose

Предоставлять три проверенные ценовые формулы с честным временным статусом ресурсного ограничения и
сохранением пользовательских настроек.

## ADDED Requirements

### Requirement: Три точные регистрации

Библиотека SHALL добавлять ALMA, LSMA и Chandelier Exit после SAR/ST с reviewed defaults, полными
inputs и solid native-price lines. ALMA SHALL иметь fixed close без floor input; LSMA SHALL явно
ограничивать local length минимумом2; CE SHALL иметь только две exit lines.

#### Scenario: Новые defaults и исключения

- **WHEN** пользователь добавляет ALMA, LSMA или CE
- **THEN** доступны соответственно9/.85/6,25/0/close и22/22/3; KC/DC остаются недоступны, Everget
  signals не создаются

### Requirement: Временное ограничение расчёта

Расчёт SHALL возвращать runtime-only calculation-limit при превышении reviewed bar/work cap,
сохраняя все timestamps и null outputs. Терминал SHALL объяснять уменьшение периода или глубины
истории; параметры и котировки MUST оставаться неизменными.

#### Scenario: Дорогая комбинация и восстановление

- **WHEN** max(0,N-L+1)*L превышает50000000 для ALMA/LSMA, затем история или период становятся
  допустимыми
- **THEN** первая попытка не запускает kernel и показывает временную недоступность; следующая
  возвращает настоящие значения и снимает статус

### Requirement: Совместимость сохранений

Новые instances SHALL использовать прежний schemaVersion1 и строгие keys params/styles. Transient
statuses/outputs MUST не попадать в backup; прежние47 definitions/results/cache/history и v1
projection SHALL сохраняться.

#### Scenario: Перенос настроек

- **WHEN** пользователь сохраняет и импортирует новые экземпляры с собственными styles и pane
- **THEN** параметры и оформление совпадают, runtime-only fields отклоняются и предыдущие экземпляры
  остаются byte-equivalent
