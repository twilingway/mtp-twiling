# Spec Delta

## Purpose

Сохранять диапазон, формат осей и существование KLine панелей, когда декоративные или неактивные
технические members не имеют собственных текущих видимых числовых contributors.

## ADDED Requirements

### Requirement: Inactive members are domain neutral

Система MUST сохранять точный native range и axis format активных peers при hide/collapse и при
отсутствии finite visible public plots в текущем viewport. Декоративные роли MUST NOT создавать
numeric figures, цены или отдельный scale domain.

#### Scenario: Mixed precision peer

- **WHEN** рядом с fixed6/8 peer скрыт KC при price precision2/6/8
- **THEN** range и axis format совпадают с baseline peer без KC
- **AND** remove восстанавливает тот же baseline без изменения peer data/precision

#### Scenario: Offscreen and empty viewport

- **WHEN** visible outputs переходят finite→all-null/offscreen→finite при pan
- **THEN** inactive metadata становится нейтральной и active metadata возвращается без изменения
  rows

### Requirement: Active plot semantics and decorative paint persist

Система SHALL считать opacity0 visible plot настоящим contributor и сохранять прежнее native-price
inheritance активных studies. Неактивные plot roles SHALL сохранять уровни и отдельный fill на
законной шкале других sources с прежним порядком слоёв.

#### Scenario: Transparent ink

- **WHEN** plot visible=true и opacity=0
- **THEN** его реальные finite values участвуют в scale, а independent fill остаётся доступным

#### Scenario: Levels without local finite plot

- **WHEN** study не имеет finite plot в viewport, но другой peer даёт domain
- **THEN** его разрешённые reference levels/fill сохраняют paint eligibility без своего scale input

### Requirement: Metadata refresh preserves lifecycle

Система MUST синхронно нейтрализовать inactive metadata после price precision change и сохранять
pane identity/layout при role replacement. Retired/disposed callbacks MUST NOT возвращать members
или менять metadata/prefs/camera.

#### Scenario: Native sync and role replacement

- **WHEN** price precision меняется2→8→2, а hidden study затем раскрывается
- **THEN** inactive peers нейтральны, active native-price наследует precision, pane сохраняется

#### Scenario: Late callback

- **WHEN** после hide/remove/dispose завершается старый native calc или queued viewport callback
- **THEN** retired member не воссоздаётся и не влияет на axis metadata
