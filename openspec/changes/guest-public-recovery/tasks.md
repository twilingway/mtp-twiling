# Tasks

## 1. Хранилище

- [x] 1.1 Реализовать scoped reads, atomic copy/decision и export; проверить actual DB
      empty/occupied/repeat/abort/quota/secret boundaries.
- [x] 1.2 Подключить public bootstrap; проверить actual session fences и отсутствие банковского
      переноса.

## 2. Recovery UI

- [x] 2.1 Добавить офлайн RU/EN recovery export с download guard и предупреждением; проверить
      controller/event tests.

## 3. Проверки

- [x] 3.1 Выполнить source type/lint/format/spec и focused regressions, сохранить отчёт.
- [x] 3.2 Координатор проверяет UI offline/mobile/themes и реальный download в свежем изолированном
      browser QA.

## Workflow follow-up

- Source commit передать координатору без build/publish/merge.
