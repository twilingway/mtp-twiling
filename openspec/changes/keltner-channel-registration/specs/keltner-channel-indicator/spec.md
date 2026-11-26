# Spec Delta

## Purpose

Дать пользователю локальный Keltner Channels с точными typed inputs, независимой готовностью basis и
bands, исходными reviewed результатами и переносимостью существующего формата настроек.

## ADDED Requirements

### Requirement: Единственная новая регистрация

Система SHALL добавлять только Keltner Channels после прежних50 definitions и сохранять все старые
defaults, numeric/history/v1 contracts.

#### Scenario: Default instance

- **WHEN** пользователь создаёт KC
- **THEN** появляется overlay с length20, multiplier2, source close, useExponentialMa true,
  bandsStyle Average True Range и atrLength10

### Requirement: Typed boolean и band choices

KC SHALL принимать настоящий boolean и только три exact band styles; UI SHALL показывать checkbox и
RU/EN select, сохраняя canonical values без coercion.

#### Scenario: SMA с True Range

- **WHEN** пользователь снимает Use Exponential MA и выбирает True Range
- **THEN** сохраняются false и строка True Range; числа0/1, строки true/false, unknown/null/array
  choices отвергаются до записи

### Requirement: Независимые numeric readiness

Runtime SHALL сохранять reviewed basis/upper/lower без общего warmup mask; history SHALL зависеть от
EMA/SMA и bandsStyle.

#### Scenario: Basis раньше ATR

- **WHEN** default KC получает первые девять плотных valid bars
- **THEN** EMA basis готов с первого бара, bands остаются null до десятого, а history остаётся
  recursive

#### Scenario: Finite SMA плюс True Range

- **WHEN** useExponentialMa=false и bandsStyle=True Range
- **THEN** history finite max(length,2); sparse input сохраняет reviewed independent masks,
  неизвестные цены не заменяются нулём

### Requirement: Presentation и переносимость

KC SHALL иметь три price plots и upper/lower fill, native-price policy независимо от pane, сохраняя
params/pane/styles текущим v1.

#### Scenario: Own pane roundtrip

- **WHEN** custom KC проходит JSON или Drive prepare/restore в своей pane
- **THEN** boolean/choices и explicit styles сохраняются точно, runtime metadata/fills/history не
  попадают в instance или backup

### Requirement: Ограничение вычисления

Свыше1M bars KC SHALL возвращать transient calculation-limit с null outputs, сохраняя valid params и
позволяя восстановить расчёт при меньшей истории.

#### Scenario: Recovery

- **WHEN** длина входа снова не превышает лимит
- **THEN** расчёт использует reviewed kernel и возвращает реальные numeric outputs без persisted
  unavailable flag
