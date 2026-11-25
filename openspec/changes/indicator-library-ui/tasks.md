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

- Проверить реальный диалог и split controls в свободном QA-браузере, затем архивировать change.

## 4. Подключение к терминалу и collapse

- [x] 4.1 Подключить основную кнопку, TerminalDialog/App и CSS; проверить split action handlers и
      реальный каталог из семи записей.
- [x] 4.2 Подключить quick dropdown с поглощением outside pointer/click и Escape; проверить
      маршрутизацию обработчиков.
- [x] 4.3 Сохранить MTP collapse и enable-only добавление через guarded controller preferences;
      проверить owner/import bounce, ручной backup, Drive, render key и camera identity.
- [x] 4.4 Выполнить полный check и spec:validate после интеграции; сохранить результаты (375/375 и
      21/21).
