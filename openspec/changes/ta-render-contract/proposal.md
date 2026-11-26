# Proposal

## Why

Числовой контракт 42 TA не описывает crosses, разрывы линий, скрытые fill anchors и переменные цвета
публичных встроенных TradingView TA. До регистрации SAR/Supertrend нужен проверяемый проект
отображения поверх установленных библиотек с сохранением числовой и пользовательской совместимости.

## What Changes

- Предлагается versioned render-only descriptor: cross, linebr, columns, отдельные fills и palette.
- SAR: синие несоединённые crosses. Supertrend: две линии с разрывами, скрытый bodyMiddle,
  направленные fills выше grid и ниже price; direction не влияет на ось.
- MACD/PVO получают четырёхцветные default columns, AO — два цвета по изменению значения.
- Явный старый custom color сохраняет solid; возврат к palette требует явного reset.
- Автор рекомендует narrow instance2: сохранённый legacy styles bag + discriminated presentation
  outputs/fills с auto/solid modes и point settings. V1 не хранит auto+width/opacity без потери
  намерения; period-only edit не материализует style/color. Reset-to-auto сохраняет patches в v2.
- **BREAKING**, только после root contract review: предлагается envelope3 при наличии instance2;
  старые v1 не переписываются на read/import/period/sync. Unknown newer отклоняется до write/sync,
  без lossy projection/downgrade. Это конкретный compatibility trade-off, не внедрённая миграция.
- KLine companion наследует effective owner/native Series.Price precision policy с первого
  create/sync, не вводит default4/min/max/shouldOhlc; native range equality — обязательный gate.
- Числовые результаты/params/persisted v1 существующих 42 сохраняются. Изменение render metadata
  намеренное и проверяется отдельно от frozen numeric fixtures.

Research commits содержали только исследование и OpenSpec. В отдельной implementation ветке принят
runtime contract и добавлен source-only compiler с тестами; см.
`docs/TA_RENDER_IMPLEMENTATION_DECISIONS.md`. Adapters/registry ещё не подключены. Persistent G5
остаётся proposal: никакая миграция/новый writer не запускаются этим этапом.

## Capabilities

### New Capabilities

- `ta-plot-presentation`: согласованное отображение TA, слои, оформление и совместимость сохранений.

### Modified Capabilities

Нет. Текущий основной inventory содержит только drawing-editing; его поведение не меняется.

## Impact

Будущие владельцы: общий numeric/render integrator, persistence/UI integrator, два native renderer,
registry integrator и integration reviewer. Точные пути, зависимости и gates:
[исследование](../../../docs/TA_RENDER_CONTRACT_RESEARCH.md), разделы 3–7. Новые зависимости не
нужны. Исходная база `5d569c394ee3d8730af12c665aa956f290b3245e`, LW5.0.9/KLine9.8.12.
Build/version/server/cache/Drive runtime и пользовательский Chrome в этой работе не затрагиваются.
