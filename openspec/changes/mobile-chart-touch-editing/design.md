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

## KLine SDK evidence

Проверен установленный KLine Charts 9.8.12, первичный исходник
`node_modules/klinecharts/dist/index.esm.js` (только чтение):

- `Event.touchStartEvent`, строка 12708, и `Event.touchMoveEvent`, строка 12760: Y_AXIS передаёт
  события overlay, но не вызывает native масштабирование цены.
- `Event.mouseDownEvent`, строка 12450, сохраняет исходный диапазон и pageY;
  `Event.pressedMouseMoveEvent`, строка 12528, изменяет диапазон Y и вызывает `adjustPaneViewport`.
- `SyntheticEvent._firesTouchEvents`, строка 12280: явно заданный
  `sourceCapabilities.firesTouchEvents` имеет приоритет над фильтром совместимости 500 мс.

Мост использует публичный `getDom("candle_pane", DomPosition.YAxis)` и отправляет новые
синтетические mouse-события в native путь SDK. Только принадлежащий шкале single-touch подавляет
прокрутку страницы; координата X остаётся в исходной полосе шкалы. Второй палец завершает мост и
возвращает дальнейшие события SDK. Отмена, blur и dispose завершают native drag и удаляют
обработчики. Пользовательские trusted-события не изменяются.

`test/kline-axis-touch.test.mjs` исполняет методы установленного SDK: воспроизводит отсутствие
масштабирования в touch пути, затем проверяет реальное изменение native диапазона через мост,
координаты и флаги событий, фильтр совместимости, второй палец, отмену и очистку.
