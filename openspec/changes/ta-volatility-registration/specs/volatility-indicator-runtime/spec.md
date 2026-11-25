# Spec Delta

## Purpose

Подключать проверенные ряды волатильности и импульса к общим сериализуемым определениям, сохраняя
ранее сохранённые экземпляры и явный контекст расчёта Historical Volatility.

## ADDED Requirements

### Requirement: Проверенная регистрация численных выходов

Общий runtime SHALL вычислять восемь новых определений с точными public ID, defaults и bounds.
BandWidth SHALL возвращать value, highestExpansion и lowestContraction. TRIX SHALL сохранять масштаб
log EMA delta×10000. Новый каталог SHALL содержать 29 computed определений без фиктивных реализаций
оставшихся пунктов.

#### Scenario: Три выхода BandWidth

- **WHEN** цены равны 1,3,5,9, length=2, multiplier=1 и периоды extrema равны 2
- **THEN** value равен null,100,50,400/7; highestExpansion равен null,100,100,400/7;
  lowestContraction равен null,100,50,50

### Requirement: Обязательный внешний контекст HV

Расчёт HV SHALL требовать явный конечный положительный historicalVolatilityPeriodsPerYear в третьем
аргументе TechnicalCalculationContext. Параметры instance SHALL содержать только length. Runtime
SHALL не угадывать таймфрейм и не записывать annualization в переносимый instance.

#### Scenario: Контекст не передан

- **WHEN** запрошен HV без корректного годового масштаба
- **THEN** runtime бросает RangeError с причиной об обязательном явном контексте

#### Scenario: Один instance на двух таймфреймах

- **WHEN** тот же HV instance рассчитан с масштабами 365 и 365/7
- **THEN** результаты отличаются множителем sqrt(7), а сериализуемый instance остаётся прежним

### Requirement: Совместимость и строгие параметры

Регистрация SHALL сохранять порядок и defaults прежних 21 определений. Валидаторы SHALL принимать
новые точные параметры и output styles, отклонять неизвестные поля, code, неверные source и bounds.
Все восемь новых instances SHALL проходить строгую source JSON roundtrip проверку.

#### Scenario: Старый профиль

- **WHEN** JSON со старыми 21 instances загружен после расширения registry
- **THEN** все instances и их прежние параметры остаются валидными без миграции defaults

### Requirement: Честная граница интеграции

Пакет SHALL документировать передачу HV context из renderers и новые Drive keys как внешние
интеграционные шаги. Source-проверки SHALL не объявляться доказательством native или browser parity.

#### Scenario: Передача координатору

- **WHEN** source commit передан для интеграции
- **THEN** перечислены pending renderer context wiring и
  expansionLength/contractionLength/middleLength
