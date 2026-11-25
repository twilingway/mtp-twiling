# Tasks

## 1. Контракт камеры

- [x] 1.1 Добавить intent/settled callbacks и observer, проверить before-RAF, debounce,
      quote/restore/resize exclusion тестами.
- [x] 1.2 Подключить native callbacks, capture gestures, navigation/focus/fit и проверить
      cleanup/adapter regressions.

## 2. Controller и Drive

- [x] 2.1 Добавить scoped WeakMap camera helper и отдельную intent revision; проверить pending
      download/commit/owner/retired/save failures.
- [x] 2.2 Проверить no-echo и camera changes across quote/render; документировать X-only scope.

## 3. Интеграция

- [x] 3.1 Выполнить полный check и strict OpenSpec validation в изолированной ветке: первый check
      PASS 325/325, camera scoped 13/13, OpenSpec 18/18; повтор ограничен старым flaky
      debounce-тестом с fixed 1700ms, исправление ожидания принадлежит отдельному агенту.
- [ ] 3.2 Выполнить отдельный browser gate координатором после интеграции.
