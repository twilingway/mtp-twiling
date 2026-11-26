# Spec Delta

## Purpose

Подключить проверенные объёмные индикаторы к общему реестру и переносимым настройкам терминала с
явной доступностью рыночного объёма и сохранением совместимости.

## ADDED Requirements

### Requirement: Append-only definitions and result compatibility

Реестр SHALL добавлять семь volume-flow определений после прежних 35, сохраняя их defaults, порядок
и result shapes. Библиотека SHALL предоставлять 42 computed, 43 доступных TA с Volume и 47 доступных
entries с четырьмя MTP.

#### Scenario: Existing instances

- **WHEN** рассчитывается прежний экземпляр, включая вход без volume
- **THEN** его результат и metadata сохраняются, поле unavailableReason отсутствует.

### Requirement: Reviewed numeric outputs and history

Runtime SHALL вызывать reviewed math без изменения формул, сохранять все 11 output keys, реальные
timestamps и отдельный cumulative-plus-EMA history contract.

#### Scenario: PVO and volume indices

- **WHEN** вычисляются PVO или NVI/PVI
- **THEN** результат содержит явно сопоставленные oscillator/signal/histogram либо index/average и
  reviewed seed/convergence metadata.

### Requirement: Real volume availability

Семь новых индикаторов SHALL требовать хотя бы один конечный положительный volume во всём входе. Без
него все их выходы SHALL содержать null и unavailableReason volume-unavailable.

#### Scenario: Missing and zero volume

- **WHEN** вход пуст либо volume каждого бара равен null или0
- **THEN** ни один из 11 рядов не показывает математический seed как рыночное значение; timestamps и
  длины сохранены.

### Requirement: Strict portable parameters

Новые parameters и styles SHALL проходить точную проверку ключей, bounds и типов. Choice SHALL
принимать только строки EMA/SMA. JSON/Drive SHALL отвергать null, unknown values и лишние TA keys до
нормализации.

#### Scenario: Custom roundtrip

- **WHEN** допустимые пользовательские параметры и стили проходят JSON и Drive backup
- **THEN** они сохраняются точно, а runtime history/availability metadata не сохраняется.

#### Scenario: Corrupt parameters

- **WHEN** imported choice равен null, неизвестной строке или params содержат extra key
- **THEN** импорт отвергается без permissive fallback.

### Requirement: Choice settings input

Настройки SHALL показывать choice как select с точными EMA/SMA options, сохранять его строкой и
предоставлять читаемые RU/EN labels новых keys. Numeric/source controls SHALL сохранять прежнее
поведение.

#### Scenario: Save SMA selection

- **WHEN** пользователь выбирает SMA для oscillator или signal average
- **THEN** settings candidate содержит строку SMA и проходит строгий instance validator.
