# Spec Delta

## Purpose

Сохранять пользовательский выбор между автоматическим оформлением и явно указанным стилем каждого
выхода ТА при редактировании параметров и размещения без изменения формата сохранений.

## ADDED Requirements

### Requirement: Untouched output styles preserve their stored shape

Settings SHALL сохранять отсутствие styles, пустую map и точный набор полей существующих записей,
если пользователь меняет только параметры или размещение. Untouched outputs MUST не получать
defaults.

#### Scenario: Automatic output and period edit

- **WHEN** у экземпляра отсутствует styles и пользователь сохраняет новый период или панель
- **THEN** styles остаётся отсутствующим в сохранённом экземпляре

#### Scenario: Sparse legacy manual style

- **WHEN** только один выход имеет ручной цвет/толщину/видимость без opacity/lineStyle
- **THEN** после правки периода запись сохраняет прежние поля, а соседний выход остаётся без стиля

### Requirement: Only edited output becomes explicit

Изменение оформления SHALL сохранять полный стиль только изменённого выхода. Явный ручной цвет,
равный текущему default, MUST оставаться явным; изменение с возвратом значения может остаться явным.

#### Scenario: Default-colored manual edit

- **WHEN** пользователь выбирает для автоматического выхода цвет, равный default
- **THEN** этот выход получает явный стиль, а остальные отсутствующие outputs остаются
  отсутствующими

### Requirement: Existing settings boundaries remain effective

Submit MUST не сохранять правки в другой профиль, инструмент, сессию или во время
импорта/восстановления.

#### Scenario: Boundary crossed before submit

- **WHEN** после открытия настроек меняется owner, chart revision, selection или начинается импорт
- **THEN** submit не выполняет запись изменённого экземпляра
