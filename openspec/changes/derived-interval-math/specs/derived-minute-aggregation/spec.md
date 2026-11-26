# Spec Delta

## Purpose

Вычислять производные intraday OHLCV из подтверждённых caller минутных снимков, сохраняя явные
временные границы, отсутствие данных и доказательства полноты отдельно от цен.

## ADDED Requirements

### Requirement: Strict minute source

Движок SHALL принимать только уникальные строго возрастающие минутные timestamps, finite корректные
OHLC и неотрицательный volume. Неподдерживаемый source, нарушения порядка и overflow MUST
отвергаться.

#### Scenario: Duplicate is rejected

- **WHEN** caller передаёт два снимка одной минуты, даже одинаковых
- **THEN** агрегация завершается явной ошибкой без сортировки или двойного volume

#### Scenario: Overflow is rejected

- **WHEN** сумма finite volumes становится Infinity
- **THEN** движок возвращает ошибку, а не Infinity или ноль

### Requirement: Explicit temporal policy

Движок SHALL требовать supplied sessions с anchor и открытыми окнами, а также asOf. Границы SHALL
иметь минутное выравнивание. Неизвестная session MUST давать явную ошибку; будущие снимки запрещены.

#### Scenario: Session break preserves anchor

- **WHEN** supplied session имеет перерыв внутри 45-минутного bucket
- **THEN** bucket сохраняет исходный anchor и ожидает только минуты пересечения с открытыми окнами

#### Scenario: Chosen day boundary

- **WHEN** caller задаёт сутки UTC как session и 7 минут как target
- **THEN** последний bucket обрезан концом этих суток, без утверждения о provider policy

#### Scenario: Future final bar

- **WHEN** final source minute заканчивается позже asOf
- **THEN** движок отвергает противоречивый снимок

### Requirement: Actual OHLCV only

Движок SHALL создавать bucket только при наличии реальных source bars: первое O, max H, min L,
последнее C, сумма V. Timestamp SHALL быть supplied-grid boundary. Входы MUST оставаться
неизменными.

#### Scenario: Empty bucket

- **WHEN** открытое окно не содержит source bars
- **THEN** свеча не создаётся и пропуск не заполняется предыдущей ценой

#### Scenario: History correction

- **WHEN** caller заменяет старый source snapshot и повторяет расчёт
- **THEN** результат детерминированно отражает исправление без добавления прежнего volume

### Requirement: Evidence based completeness

Движок SHALL возвращать отдельно ожидаемые, реальные, отсутствующие и покрытые минуты и finality.
Complete MUST требовать закрытый bucket, все ожидаемые минуты, exhaustive coverage и final bars.
Неизвестная полнота MUST оставаться unknown; пропущенная минута MUST оставаться incomplete.

#### Scenario: Unknown coverage

- **WHEN** все реальные минуты final, но coverage отсутствует
- **THEN** закрытый bucket имеет unknown status

#### Scenario: Missing minute with exhaustive response

- **WHEN** exhaustive coverage содержит минуту без source bar
- **THEN** bucket остаётся incomplete, поскольку no-trades evidence не задан

#### Scenario: Forming snapshot

- **WHEN** asOf находится внутри bucket и текущая минута дана как forming snapshot
- **THEN** OHLCV включает этот снимок, status остаётся open, финальность не предполагается
