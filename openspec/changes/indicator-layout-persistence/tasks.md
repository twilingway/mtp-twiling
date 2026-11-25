# Tasks

## 1. Данные и хранение

- [x] 1.1 Добавить optional layout/collapse поля и validators; проверить model, profile и backup
      roundtrip.
- [x] 1.2 Защитить сохранение source lease после await; проверить same-owner import/revision/retired
      и смену владельца.

## 2. Адаптер и интерфейс

- [x] 2.1 Инициализировать native indicators один раз, измерять реальные drag и восстанавливать
      ratio; проверить native lifecycle/history/hide-show/resize tests.
- [x] 2.2 Добавить отдельный collapse chevron и компактный счётчик; проверить callbacks,
      неизменность flags и render-key.

## 3. Общие проверки

- [x] 3.1 Выполнить полный check, spec:validate и зафиксировать изменения только в isolated
      worktree.

## Workflow follow-up

- Провести визуальный QA после интеграции; в этом этапе браузер и скриншоты не запускать.
- Архивировать после принятия интеграции.
