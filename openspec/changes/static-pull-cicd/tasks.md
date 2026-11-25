# Tasks

## 1. CI и версия

- [x] 1.1 Реализовать hosted CI и PR version gate; проверить сценарии deploy-тестами.

## 2. Публикация и откат

- [x] 2.1 Реализовать exact-SHA watcher, allowlist упаковку и public health; проверить отказ CI,
      traversal, symlink, checksum и rollback тестами.
- [x] 2.2 Добавить Linux systemd/nginx и runbook; проверить bash syntax и контракты файлов.

## 3. Интеграционные проверки

- [x] 3.1 Выполнить deploy-тесты, pnpm check и pnpm spec:validate; зафиксировать ограничения.

## Workflow follow-up

- Создать remote/private GitHub repository и настроить доступ после интеграции.
- Проверить VDS DNS/TLS/routes, установить watcher и выполнить публичный SHA smoke.
- Проверить обновление PWA отдельным визуальным reviewer до объявления deploy завершённым.
- Архивировать change после независимого review и подтверждённой публикации.
