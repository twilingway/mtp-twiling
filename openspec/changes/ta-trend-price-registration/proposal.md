# Proposal

## Why

Reviewed SAR/Supertrend math и оба presentation consumers готовы отдельно. Нужно подключить только
эти два индикатора к общей модели, библиотеке и форме без изменения прежних45 definitions и формата
v1.

## What Changes

- Append SAR/Supertrend с точными scalar params и literal history contracts.
- Runtime использует неизменённые reviewed функции и сохраняет все raw numeric series.
- Presentation объявляет cross/linebr/fills и native-price policy независимо от pane.
- RU/EN inputs, Size для cross и portable JSON/Drive scalar allowlist.

## Capabilities

### New Capabilities

- `trend-price-indicators`: локальная регистрация, настройки и переносимость SAR/Supertrend.

### Modified Capabilities

Нет.

## Impact

Только owned shared model registration/types/catalog, settings form, пять Drive numeric keys, новые
tests/docs/spec. Без изменения math, native adapters/compiler, persistence schema, DB, version,
MACD/PVO/AO metadata и без browser/build/release. G2 остаётся отдельным gate.
