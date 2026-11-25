# Tasks

## 1. Приветствие

- [x] 1.1 Добавить устройственную IDB preference/model и проверить load/save failures/dismiss/reopen
      тестами.
- [x] 1.2 Добавить RU/EN WelcomeDialog, официальные ссылки, privacy и помощь; проверить
      типы/локализацию.

## 2. Настройки истории

- [x] 2.1 Разделить AccountDialog, добавить StoragePanel/model/preview и проверить owner/session
      races тестами.
- [x] 2.2 Проверить history-only scope на реальном storage модуле с fake IDB boundary, сохранить
      import/recovery guards.

## 3. Интеграция

- [x] 3.1 Выполнить общий check и strict OpenSpec validation в изолированной ветке: 291/291 тест,
      сборка/формат/линтер/типы и 13/13 спецификаций PASS.
- [ ] 3.2 Выполнить отдельный визуальный browser gate координатором после интеграции.
