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

- [x] 3.1 Подключить RU/EN UI, локальную привязку и ручную/автоматическую синхронизацию; проверить
      coordinator fake-store tests с owner/session abort, no echo, preview и concurrent edits.
- [x] 3.2 Добавить атомарный portable replace через controller queue/barrier/recovery; проверить
      merge regression, удаления/обновления, rollback, guard/saveView и postcommit recovery тестами.
- [x] 3.3 Добавить публичную privacy и необходимые GIS/Drive CSP/COOP, проверить типы/линтер/формат.
- [ ] 3.4 Проверить настоящий OAuth, Drive API и reload/изменения на двух реальных устройствах.
- [x] 3.5 Выполнить общий check и OpenSpec strict validation: 280 тестов, формат/линтер/типы/сборка
      и 12/12 спецификаций прошли в изолированной ветке.
- [ ] 3.6 Выполнить отдельный browser UI gate координатором на общей сборке перед публикацией.
- [x] 3.7 Подтвердить повторную привязку при исчезновении принятой вершины. Проверить пустое и
      несвязанное непустое облако, явный выбор и автоматическое применение известного потомка через
      `node --test test/drive-coordinator.test.mjs`.

## Workflow follow-up

- Архивировать после независимого review и реальной интеграционной проверки.
