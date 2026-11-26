# Tasks

## 1. Registry и runtime

- [x] 1.1 Добавить definitions/types/catalog и reviewed metadata dispatch; проверить
      counts/order/defaults и числовые ledger в source-only tests, описать контракт в документе.
- [x] 1.2 Добавить volume gate только для новых7; проверить null/zero/positive history,
      timestamps/gaps/frozen input и legacy result shapes в tests и документе.

## 2. Настройки и перенос

- [x] 2.1 Добавить strict choice и UI labels/select; проверить source-only React save, invalid
      choice/null/extra params/styles tests и документировать labels.
- [x] 2.2 Расширить Drive allowlist ровно4keys и pre-project validation; проверить JSON/Drive custom
      roundtrip и отсутствие runtime metadata, описать import policy.

## 3. Проверки

- [x] 3.1 Выполнить focused source tests, tsc noEmit, scoped ESLint/Prettier, strict OpenSpec;
      проверить clean WT и source-only commit без forbidden changes.

## Workflow follow-up

- Координатор выполняет независимое review, native/browser и интеграционный cut.
- Архивировать change после принятия координатором.
