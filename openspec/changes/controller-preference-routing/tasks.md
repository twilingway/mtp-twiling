# Tasks

## 1. Контракт и реализация

- [x] 1.1 Зафиксировать root-reviewed critical ordering и pending-depth compatibility; проверить
      design.
- [x] 1.2 Реализовать scoped routing coordination, committed generation и atomic history staging;
      проверить actual-controller regression suite без build/version preparation.

## 2. Границы и проверка

- [x] 2.1 Проверить independent/same-field intents, invalid depth/forceReload, sticky owner/import/
      revision/dispose, network вне очереди, camera origin и nonrouting edits во время carry.
- [x] 2.2 Выполнить прежние lifecycle/history-depth/camera suites, source-only strict typecheck,
      scoped ESLint/Prettier и strict OpenSpec; записать результаты/ограничения в docs.
- [x] 2.3 Source-only commit, full SHA и clean worktree; передать root для интеграции без
      merge/publish.
