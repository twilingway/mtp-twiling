# Design

## Context

ChartAdapter владеет камерой; ChartGestures владеет рисованием и жестами. LW 5.0.9 имеет публичные
logical range, spacing и resetTimeScale. KLine 9.8.12 имеет zoomAtCoordinate с множителем,
scrollByDistance и setBarSpace; его границы ширины свечи 1..50 пикселей проверены по установленному
исходнику.

## Goals / Non-Goals

**Goals:** единая семантика пяти действий без пересоздания canvas и изменения данных.

**Non-Goals:** новые горячие клавиши, изменения загрузки истории и сохранений, изменение
существующего fit.

## Decisions

- Необязательные методы zoom/scroll/resetView адаптера; новые маленькие модули вызывают только
  публичные API.
- Прокрутка равна четверти ширины области и ограничена пересечением с загруженными данными. Цена
  фиксируется тем же существующим мостом, что при перемещении мышью.
- LW применяет ширину свечи и rightOffset вместе, сохраняя центр без чтения ещё не применённых
  RAF-записей. KLine вызывает zoomAtCoordinate с явным центром.
- LW reset явно применяет barSpacing 6/rightOffset 8 и scrollToPosition(8,false), включая autoScale
  Y. Установленный 5.0.9 restoreDefault читает текущие mutable options после zoom/setView, а
  scrollToRealTime анимирует текущий options.rightOffset; эти методы не возвращают initial camera.
  Reset проверяет ready/nonempty независимо от координат; geometry guard остаётся у zoom/scroll.
- Панель — сосед ChartGestures. События указателя, клика и колеса останавливаются; обычная
  фокусировка кнопок сохраняется.
- Только older/newer поддерживают hold: pointer capture и Enter/Space, порог 180 ms, RAF с долей
  quarter-step dt/300 (dt ограничен 50 ms). Все шаги проверяют исходную камеру,
  owner/session/revision и import/loading guard. Release/cancel/lost capture/blur/hidden/unmount
  удаляют RAF и capture.
- Hold открывает один camera intent и фиксирует Y через beginPan. Fractional native scroll не
  повторяет freeze; UserCameraEvents held-режим не допускает settle до end. Click после hold
  подавляется, короткое нажатие сохраняет одиночную команду.
- Локализация находится в отдельном модуле, чтобы независимые изменения общего каталога не
  конфликтовали.

## Risks / Trade-offs

- KLine не имеет публичного переключателя autoscale → повторно используется существующий мост
  нативных событий оси, без обращения к приватным полям.
- Создание адаптера асинхронное → компонент проверяет готовность и идентичность исходного контекста,
  не разрешая действие устаревшему экземпляру.
- Визуальная проверка требует общей интеграционной сборки → координатор выполняет её после переноса
  коммита.
