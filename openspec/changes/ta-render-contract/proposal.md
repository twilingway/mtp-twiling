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
- Предлагается отдельная версия persistent instance для явных default/custom modes и fill styles.
  **BREAKING**, только если позднее утверждено: старые readers не понимают новую instance version;
  миграция и backup envelope version требуют отдельного решения.
- Числовые результаты/params/persisted v1 существующих 42 сохраняются. Изменение render metadata
  намеренное и проверяется отдельно от frozen numeric fixtures.

Этот commit содержит только исследование и OpenSpec. Открытые G-gates из исследования не считаются
разрешёнными. Реализация и миграция не запускаются этим proposal.

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
