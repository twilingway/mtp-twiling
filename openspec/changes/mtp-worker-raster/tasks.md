# Tasks

## 1. Исходный замер

- [x] 1.1 Измерить actual draw/reset/update и long tasks на baseline; сохранить dataset/camera/build
      и отчёт в artifacts/mtp-worker-raster-benchmark.

## 2. Растровый протокол

- [x] 2.1 Реализовать pure snapshot/paint и проверить эквивалентность команд, стили и sampling
      тестами.
- [x] 2.2 Реализовать ограниченную очередь, актуальность и cleanup; тестировать stale/revision,
      destroy, worker error, bitmap.close и fallback.
- [x] 2.3 Подключить LW кеш и dev A/B выбор; проверить camera modes и неизменность исходного prefix.

## 3. Сборка и сравнение

- [x] 3.7 Сохранить безопасный clipped preview при открытии новых свечей; ограниченно дорисовывать
      длительный held pan в фоне, проверить отсутствие исчезновения слоя и сохранение hard guards.

- [x] 3.5 Включить ленивый auto для тяжёлого слоя; unit проверяет отсутствие Worker без МТП, на
      лёгком слое и с native override. Браузерный smoke проверяет обычный URL и 1/6/16 окон.
- [x] 3.8 Сохранить проверенный soft-tail preview между жестами до нового exact, без мигания на
      котировках и без ослабления hard guards.
- [x] 3.9 Обработать скачок тачпада за все готовые bitmap лёгким bounded coarse preview; измерить
      его стоимость отдельно и проверить реальный fast-wheel burst без исчезновения МА.
- [x] 3.6 Повторить полный локальный check и strict spec после окончательного исправления.

- [x] 3.4 Сохранить безопасный held tail-preview при same-close и changed-close update; 27 worker
      unit и независимая проверка hard guards/ленивого ключа проходят, точный кадр нужен после idle.

- [x] 3.0 Исправить измеренную регрессию snapshot/redraw: unit проверяет покрытый кешем жест без
      полных snapshot/job каждый кадр, точный результат после idle и дешёвый unchanged/in-flight
      путь.

- [x] 3.1 Добавить module entry и same-origin dev CSP; проверить build/manifest и URL в браузере.
- [x] 3.2 Выполнить typecheck/lint/scoped unit/spec и независимое ревью второй итерации.
- [x] 3.3 Повторить замер на одинаковых данных/камере, проверить итоговые пиксели, светлую/тёмную
      темы и нижние индикаторы; опубликовать измеренные результаты и ограничения.

## Workflow follow-up

- Общий check и включение по умолчанию — после подтверждённого результата эксперимента.
- Перед merge/release обязателен зелёный CI exact head; актуальное состояние фиксируется в PR.
