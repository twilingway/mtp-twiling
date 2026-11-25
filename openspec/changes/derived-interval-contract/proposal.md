# Proposal

## Why

Пользователю нужны 4/6/7/8/9/45 минут и 3 часа, позднее 3/6/12 месяцев. API не имеют этих native
enums; простое округление UTC или расширение Timeframe рискует изменить OHLC и сохранения.

## What Changes

- Исследование [DERIVED_INTERVAL_RESEARCH.md](../../../docs/DERIVED_INTERVAL_RESEARCH.md) фиксирует
  источники, пределы доказательств, source bars, качество данных и test vectors.
- Предлагается отдельный chart interval / provider resolution plan, native-only transport/cache и
  versioned aggregation policy, независимая от пользовательской timezone.
- MOEX остаётся gated до доказанного instrument/session anchor; 3/6/12М — отдельная поздняя фаза.
- Предлагается явный backup schema 2 для derived layout с чтением прежней schema 1. Изменение
  совместимости требует согласования до кода; старые readers не получат молчаливый downgrade.

## Capabilities

### New Capabilities

Нет в текущем docs-only коммите. Будущая реализация должна дополнить capability `candle-intervals`
из активного `interval-menu`, сохранив `display-locale-timezone` и `future-calendar-axis`.

### Modified Capabilities

Нет: production behavior и принятые спецификации не меняются; `skip_specs: true`.

## Impact

Сейчас только docs/OpenSpec. Будущие области владения и граф зависимостей перечислены в design. Нет
production implementation, package/lock, registry35, UI/native adapters, Drive или version changes.
Реализация не авторизована этим исследованием; source/schema/anchor gate требует отдельного решения.
