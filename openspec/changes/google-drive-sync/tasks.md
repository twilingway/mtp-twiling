# Tasks

## 1. Авторизация и безопасный формат

- [x] 1.1 Реализовать GIS prepare/click/expiry/disconnect; проверить fake GIS тестами и описать API.
- [x] 1.2 Реализовать явную проекцию Backup v1 и SHA256 manifests; проверить исключение
      секретов/истории/котировок и corruption tests.

## 2. Транспорт и синхронизация

- [x] 2.1 Реализовать namespaced appDataFolder transport, pagination и resumable/retry; проверить
      fake HTTP тестами и документировать ограничения.
- [x] 2.2 Реализовать DAG inspect/publish/download/resolve; проверить concurrent heads, stale
      parents и целостность зависимостей.

## 3. Интеграция

- [ ] 3.1 Подключить пользовательский UI и локальную привязку профиля; проверить отмену, disconnect,
      конфликты и reload обоими устройствами.
- [ ] 3.2 Проверить настоящий OAuth и Drive API, общий check и OpenSpec strict validation перед
      публикацией.

## Workflow follow-up

- Архивировать после независимого review и реальной интеграционной проверки.
