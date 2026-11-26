# Design

## Context

База de0f42d — замороженная source .19. Этот пакет не меняет общие типы, registry, renderers, UI,
Drive или version. Формулы проверены по актуальным публичным built-in и официальной справке.

## Goals / Non-Goals

Цель: Aroon/oscillator, DMI/ADX, Vortex и CHOP с numerical ledgers и data-only metadata. Не цели:
Pine execution, renderer offsets/colors/alerts, browser и общая регистрация.

## Decisions

- Aroon использует monotonic deques по позициям баров и окно n+1; холодная история частичная, ties
  выбирают последний экстремум. Последняя tie деталь не установлена первичным reference текстом и
  помечена как локальная политика.
- DMI/ADX используют существующий RMA primitive, но отдельный строгий TR. DM требует совместно
  известных соседних high/low. fixnan держит только ранее известный DI; до него нулевой TR остаётся
  неизвестным. DX на внутренних held значениях продолжает Wilder рекурсию.
- Vortex использует отдельные na-skipping окна VM и ATR1; эквивалентные SMA отношения избегают
  overflow сумм. CHOP использует log суммы через log среднего плюс log(n), positional extrema.
- Финальная source mask возвращает null на missing текущего HLC или непредставимом raw TR. DMI
  требует также известного текущего adjacent DM, Vortex маскирует неизвестный текущий VM. Aroon
  маскирует high/low независимо. Внутренние state не получают нулевых замен missing значений.

## Risks / Trade-offs

Pine sparse execution и Aroon ties не проверялись. На частично missing OHLC локальный совместный DM
guard и финальная mask могут отличаться от буквальных отдельных na ветвей Pine. Extreme binary64
overflow превращает вклад в null; при recursive state это не равно точному восстановлению
неизвестной истории. CHOP может выходить за 0..100 на ценовых gaps: output не обрезается.

## Validation

Ручные rational/log ledgers, полный и частичный прогрев, ties, first TR, DM competition,
zero/fixnan, missing, overflow, causal/frozen input, price-scale/translation invariants и линейный
большой вход. Source-only TypeScript, scoped lint/format и strict OpenSpec validation.
