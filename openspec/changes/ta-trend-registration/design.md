# Design

## Context

База dc98e37 — .19 source. Проверенный math commit перенесён отдельно. Source регистрация не меняет
frozen .19, native/UI/Drive/version; другие guest recovery изменения не затрагиваются.

## Goals / Non-Goals

Цель: 35 вычисляемых определений и строгий контракт null warmup для CHOP length1. Native paint,
browser, release и расширение Drive выполняются координатором после принятия source commit.

## Decisions

- Новый definition модуль добавлен после прежних 29. Все старые parameters/defaults/history dispatch
  остаются в прежних ветвях.
- TechnicalIndicatorResult.warmupBars допускает null; optional alwaysUndefined?:true добавляется
  только при null warmup. Это metadata расчёта, не поле persisted instance. Единственный такой
  текущий случай — CHOP length1; его допустимый min1 сохранён.
- Aroon сохраняет независимые Up/Down masks из math API: общая HLC mask не должна уничтожить
  известный Down при missing high. Остальные outputs используют уже проверенные math masks.
- DMI/ADX получают diLength/adxSmoothing напрямую. History использует reviewed
  adjacent-change-wilder seed policy, полный input и строгий TR/fixnan pipeline; EMA seed не
  подставляется.
- Два новых ключа Drive не подменяются неоднозначными прежними aliases. Сам allowlist принадлежит
  root; локально проверяются manual JSON всех шести и Drive четырёх shapes с существующим length.

## Risks / Trade-offs

Aroon tie/cold и sparse/overflow пределы math-пакета сохраняются и не объявляются Pine execution
parity. Native35 fixtures и полный Drive roundtrip DMI/ADX требуют последующей интеграции root.
Nullable warmup разрешён контрактом, но существующие 29 results не получают дополнительных полей.

## Validation

Независимые golden runtime ledgers, старые29 order/default/result shape checks, CHOP1 all-null
list/JSON/metadata, history/warmup, strict bounds/keys/styles, search aliases, source
gaps/causality. Source TypeScript, scoped lint/format, strict OpenSpec и focused regression tests
без build.
