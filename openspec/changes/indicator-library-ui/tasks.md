# Tasks

## 1. Модель и контракт

- [x] 1.1 Добавить тип entries и чистые фильтрацию/проверку добавления; проверить aliases, category,
      substring и disabled в unit-тестах.
- [x] 1.2 Описать onAdd/available/activeIds и границы интеграции в docs/INDICATOR_LIBRARY_UI.md;
      проверить согласованность ID с заданием.

## 2. Диалог

- [x] 2.1 Добавить Modal-композицию и локализованные labels; проверить SSR двух разделов, active
      badge и disabled reason.
- [x] 2.2 Добавить начальный фокус и клавиатурную маршрутизацию; проверить обработчики
      ArrowDown/Escape и enabled-only focus.
- [x] 2.3 Добавить scoped CSS 840px/mobile fullscreen; проверить CSS синтаксис и сохранить
      визуальную проверку как интеграционный follow-up.

## 3. Проверки

- [x] 3.1 Выполнить pnpm check, pnpm build и pnpm spec:validate; зафиксировать результаты и
      ограничения интеграции.

## Workflow follow-up

- Интегратор подключает Toolbar, quick dropdown и CSS; проверяет реальный диалог в свободном
  QA-браузере, затем архивирует change.
