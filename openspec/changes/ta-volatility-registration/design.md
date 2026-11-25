# Design

## Context

База 6d33e1d, математический пакет перенесён отдельным commit. Этот change владеет только TA
registry/types/runtime/catalog и проверками; renderer adapters, UI и Drive принадлежат координатору.

## Goals / Non-Goals

Цель: вычисляемые 29 определений, строгие переносимые параметры и проверяемая граница HV context.
Native paint, browser, release/version и storage миграции не входят в source change.

## Decisions

- Новые definitions вынесены в отдельный registry модуль и добавлены после прежних 21: старые
  defaults и порядок не меняются.
- TechnicalCalculationContext содержит обязательный historicalVolatilityPeriodsPerYear. Сам аргумент
  runtime optional для обратной совместимости остальных 28 индикаторов; HV без него отклоняется.
  Контекст не является частью JSON instance.
- Для BBW используются точные expansionLength/contractionLength; для UO middleLength. Никаких ложных
  aliases к прежним signalLength/smoothK ради обхода Drive allowlist.
- Чистые math-функции и их metadata используются напрямую. BBW возвращает три независимые series, AO
  — histogram, остальные новые выходы — line. Common output contract позволяет renderer интеграции
  обойтись без отдельных формул.

## Risks / Trade-offs

Координатор передаёт явный HV context от текущего timeframe в оба renderers. Он же добавляет ровно
три новых Drive keys, сохраняя строгую schema validation. До этих шагов source commit не является
готовой native/Drive интеграцией. Math source gaps/overflow и отсутствие Pine execution parity
остаются такими, как описано в TECHNICAL_VOLATILITY_MOMENTUM.md.

## Validation

Golden numerics всех восьми, BBW extrema/warmup, HV context guards и повторное использование
instance, strict bounds, source selection, immutable definitions, JSON и старые defaults. Manual
JSON проверяется для всех восьми, текущий Drive sanitizer — для шести shapes без новых keys. Полная
Drive/native проверка выполняется координатором после wiring.
