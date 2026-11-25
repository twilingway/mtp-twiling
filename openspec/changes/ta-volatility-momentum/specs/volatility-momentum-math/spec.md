# Spec Delta

## Purpose

Предоставлять независимые проверяемые ряды волатильности и импульса с явными правилами прогрева,
логарифмического домена, пропусков и необходимого внешнего контекста.

## ADDED Requirements

### Requirement: Проверенные формулы и масштабы

Пакет SHALL рассчитывать %B, BandWidth с highest expansion и lowest contraction, HV, AO, BOP, CMO,
UO и TRIX по проверенным публичным формулам. TRIX SHALL использовать изменение тройной EMA логарифма
цены с множителем 10000. HV SHALL требовать явный положительный periodsPerYear.

#### Scenario: Масштаб TRIX

- **WHEN** length равен 1, цены равны 1 и e
- **THEN** TRIX равен null и 10000, без подмены процентным изменением цены

#### Scenario: Не задана annualization

- **WHEN** HV вызван без явного periodsPerYear
- **THEN** расчёт отклоняется, таймфрейм не угадывается

### Requirement: Чистые серии и неизвестные значения

Пакет SHALL сохранять длину, не изменять вход и выдавать только конечные числа либо null. Missing
данные, неполный прогрев и нулевые делители SHALL сохранять неизвестность. Неположительные цены
SHALL давать gap в логарифмических расчётах. Неконечные входы и неверные параметры SHALL
отклоняться.

#### Scenario: Плоские цены

- **WHEN** постоянные ненулевые цены прогреты
- **THEN** %B и CMO равны null, BandWidth и HV равны 0, TRIX равен 0

#### Scenario: Отсутствующий предыдущий close

- **WHEN** предыдущий close для UO отсутствует
- **THEN** изменение неизвестно и полное окно не заменяется вымышленным high-low вкладом

### Requirement: Честная самостоятельная готовность

Пакет SHALL иметь immutable сериализуемые math-only metadata с public ID, defaults, limits,
численными outputs, явным контекстом HV и history/seed. Он SHALL не расширять общий registry и не
обещать Pine execution parity.

#### Scenario: Metadata BandWidth

- **WHEN** запрошены defaults BandWidth
- **THEN** заданы length20, multiplier2, expansion125, contraction125 и все три численных выхода
