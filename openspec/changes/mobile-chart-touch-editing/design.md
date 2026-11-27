# Design

## Context

См. proposal.md. React обрабатывает PointerEvent, а Lightweight Charts отдельно использует
TouchEvent. Его ценовая шкала читает тот же vertTouchDrag, что и область свечей.

## Goals / Non-Goals

**Goals:** отделить принадлежащие рисунку touch от native chart, сохранить отмену и настольное
поведение.

**Non-Goals:** новый controller API, изменение хранения рисунков, изменение OHLC inspection.

## Decisions

- Вынести создание рисунка и определение источника contextmenu в helper. Pointer capture удерживает
  жест, touchstart/touchmove с passive:false блокируются только для принадлежащего рисунку жеста.
- Подавлять contextmenu по последнему фактическому pointer source, включая MouseEvent без
  pointerType. Правый pointerdown мыши сразу снимает suppression.
- Передавать размеры plot в workspace-touch: touchstart на цене временно включает vertTouchDrag,
  завершение возвращает настройку workspace. Определение по координатам не зависит от приватной DOM
  структуры библиотеки.
- Render получает явный размер маркера; hit-test получает явный touch размер. Математическая модель
  не читает DOM.

## Risks / Trade-offs

- Порядок native touch и pointer событий зависит от браузера → нужны scoped gesture tests и
  последующая браузерная/телефонная проверка координатором.
- Pointer cancellation не должен завершать рисунок → отмена очищает preview до записи.
