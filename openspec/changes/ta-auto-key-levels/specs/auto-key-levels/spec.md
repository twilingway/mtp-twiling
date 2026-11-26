# Spec Delta

## ADDED Requirements

### Requirement: Key levels use observed period prices

Индикатор SHALL показывать реальные OHLC для выбранных периодов и отделять завершённый период от
развивающегося.

#### Scenario: A new candle starts the next period

- **WHEN** текущий календарный период сменился
- **THEN** его прежние подтверждённые значения переходят в предыдущий период
- **AND** новые OHLC вычисляются по свечам нового периода

#### Scenario: The chart starts partway through a period

- **WHEN** начало выбранного периода отсутствует и независимая свеча периода недоступна
- **THEN** индикатор пропускает его OHLC

### Requirement: Volume levels require proved trade coverage

POC, VAH и VAL SHALL вычисляться по фактическим строкам объёма с покрытием нужного интервала.

#### Scenario: A capped request returns a partial trade window

- **WHEN** пагинация подтвердила сделки только с середины дня
- **THEN** профиль дня отсутствует
- **AND** OHLC дня по подтверждённым свечам остаются доступны

#### Scenario: Market data crosses a period boundary

- **WHEN** сделка имеет время, равное концу запрошенного периода
- **THEN** она участвует только в следующем периоде
