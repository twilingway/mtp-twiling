# Spec Delta

## Purpose

Дать пользователю локально вычисляемые Parabolic SAR и Supertrend с проверенными параметрами,
исходными численными рядами и переносимостью существующего формата настроек.

## ADDED Requirements

### Requirement: Локальная регистрация

Система SHALL добавлять SAR и Supertrend после прежних45 определений, сохраняя старые defaults,
порядок, numeric results, history и формат v1.

#### Scenario: Создание по умолчанию

- **WHEN** пользователь выбирает SAR или Supertrend из библиотеки
- **THEN** создаётся overlay с SAR0.02/0.02/0.2 либо Supertrend ATR10/factor3; прежние instances не
  изменяются

### Requirement: Численный контракт

Расчёт SHALL сохранять reviewed null/seed/gap semantics и все raw series; служебные ряды SHALL
отсутствовать в instance params и UI outputs.

#### Scenario: Отсутствующие цены

- **WHEN** вход содержит unknown HLC или неполный seed после gap
- **THEN** price output остаётся null до готовности reviewed recurrence, без подстановки нуля, а
  direction/bodyMiddle сохраняют собственные reviewed masks

### Requirement: Presentation и расположение

SAR SHALL объявлять отдельные cross, а Supertrend SHALL объявлять up/down break-линии и две
directional заливки; precision policy SHALL оставаться native-price после переноса в lower pane.

#### Scenario: Смена pane

- **WHEN** пользователь сохраняет собственную pane для любого из двух индикаторов
- **THEN** расположение сохраняется как v1 pane, presentation policy остаётся прежней, hidden
  anchors не становятся UI outputs

### Requirement: Строгие переносимые параметры

Система SHALL принимать только точные конечные scalar params в reviewed bounds, отвергать
unknown/missing/null/array keys до записи и сохранять v1 styles без преобразования.

#### Scenario: JSON и Drive roundtrip

- **WHEN** валидный custom instance проходит JSON либо Drive prepare/restore
- **THEN** параметры, pane, видимость и styles сохраняются точно, runtime results/anchors не
  попадают в backup

### Requirement: Настройки точек

Форма SHALL показывать RU/EN inputs, Size вместо Width для cross и скрывать бессмысленный Line
selector, сохраняя импортированный lineStyle.

#### Scenario: Только параметры

- **WHEN** пользователь меняет параметр без редактирования стиля
- **THEN** styles undefined остаются undefined, а существующие explicit styles и imported lineStyle
  остаются точными
