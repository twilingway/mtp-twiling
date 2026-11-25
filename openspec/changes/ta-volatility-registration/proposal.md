# Proposal

## Why

Проверенный math-only пакет восьми индикаторов пока не участвует в общем runtime. Нужна строгая
регистрация с переносимыми параметрами и явным контекстом годового масштаба HV.

## What Changes

- Расширить computed registry с 21 до 29 определений и подключить точные public ID каталога.
- Сохранить три выхода BBW и log EMA delta×10000 TRIX.
- Добавить явный третий runtime argument TechnicalCalculationContext для HV; не сохранять factor в
  параметрах instance и не угадывать таймфрейм.
- Проверить defaults, старые instances, новые JSON instances, bounds, outputs, warmup и gaps.

## Capabilities

### New Capabilities

- `volatility-indicator-runtime`: регистрация волатильности и осцилляторов с явным контекстом HV.

### Modified Capabilities

Нет.

## Impact

Общие TA types/definitions/runtime/catalog и новые registry файлы, тесты, документы. Native
adapters, UI, model/types, terminal/state, versions и Drive allowlist принадлежат координатору.
Renderer context wiring и три новых Drive params key остаются интеграционными шагами координатора.
