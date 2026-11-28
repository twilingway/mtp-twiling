# Tasks

## 1. Контейнеры и точный план

- [x] 1.1 Реализовать v3 generation, optional previous, prunedPeers и совместимость reader;
      проверить codec/model и old-reader regression.
- [ ] 1.2 Реализовать immutable plan, проверку current, CAS delete/readback/retry; проверить
      частичный сбой, поздний writer и изменённые файлы в core source-тестах.

## 2. Журнал и пользовательское действие

- [x] 2.1 Сохранять exact scoped maintenance до сети и возобновлять только явным действием;
      проверить account/generation/device guards и сохранность upload/apply/local данных.
- [ ] 2.2 Добавить capability/reason, подтверждение выбранной версии, отмену, retry и обновление
      списка; проверить SSR/behavior и отдельный визуальный smoke координатором.

## 3. Общая проверка

- [x] 3.1 Выполнить source unit tests, typecheck, lint/format и spec validation; общую сборку и
      выпуск выполняет координатор.
