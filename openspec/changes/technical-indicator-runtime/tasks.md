# Tasks

## 1. Контракт

- [x] 1.1 Создать сериализуемые definitions/instances, параметры и validators; проверить roundtrip,
      многократные instances и отклонение небезопасных/неизвестных данных тестами.
- [x] 1.2 Зафиксировать primary formula pointers, seed/gaps/flat правила и shape для следующих
      UI/native workers в docs.

## 2. Расчёты

- [x] 2.1 Реализовать SMA/EMA/RMA и пять TA; проверить независимые hand-calculated vectors, warmup,
      gaps, константы, замену последней свечи и неизменность входа.
- [x] 2.2 Выполнить scoped tests/typecheck/lint, pnpm check и pnpm spec:validate в отдельном
      worktree.

## Workflow follow-up

- Root назначает отдельные UI/native integration и visual QA.
- Архивировать после интеграционного подтверждения.
