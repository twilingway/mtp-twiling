# Tasks

## 1. Локальное разрешение

- [x] 1.1 Добавить reuse/atomic device-key и encrypted owner/client/scope vault; проверить
      encryption/tamper/expiry unit fixtures.
- [x] 1.2 Добавить restore/suspend/delete lifecycle DriveAuth; проверить reload без popup, 401,
      logout и поздние ответы.
- [x] 1.3 Обновить RU/EN privacy и прежнюю memory-only спецификацию; проверить отсутствие обещания
      бессрочного входа.

## 2. Автоматизация и пауза

- [x] 2.1 Восстанавливать auth/automatic после bank authentication с owner/session guard; проверить
      restore с закрытыми настройками и stale restore.
- [x] 2.2 Проверять сеть/expiry до export/API, сохранять pendingChanges/успешные отметки,
      возобновлять по online/focus; проверить source tests.
- [x] 2.3 Передать root безопасные поля UI и текст ошибки persistence; проверить согласованность
      типов.

## 3. Интеграция

- [x] 3.1 Выполнить source tsc/eslint, целевые node tests и strict OpenSpec validation без canonical
      сборки.
- [x] 3.2 Зафиксировать только scoped source/docs/spec/tests и передать commit, ограничения и
      результаты root.

## Workflow follow-up

- Browser/PWA reload/reopen/expiry QA и архивирование выполняются после интеграции общей сборки
  координатором.
