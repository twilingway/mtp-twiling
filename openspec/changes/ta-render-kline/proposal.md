# Proposal

## Why

Общий TA compiler уже выдаёт presentation metadata, но KLine renderer использует только line/bar.
Нужен отдельный native consumer для SAR, Supertrend и стандартных histogram palettes без изменения
результатов расчёта.

## What Changes

- Cross glyphs, линии с разрывами и парные заливки по исходным индексам.
- Общий per-bar palette resolver, отдельный scale-only baseline нуля для columns.
- Владение owner/companion, native price precision до создания и bounded registry.
- Native SDK regression suite; browser paint остаётся отдельным интеграционным gate.

## Capabilities

### New Capabilities

- `kline-ta-presentation`: KLine presentation metadata, оси и жизненный цикл native TA.

### Modified Capabilities

Нет.

## Impact

Только KLine TA renderer, отдельный geometry helper, собственные тесты и документация. Compiler,
определения индикаторов, UI, форматы JSON/Drive, кэш и numeric results не меняются. Новых
зависимостей нет. Метаданные ещё не включены в production definitions.
