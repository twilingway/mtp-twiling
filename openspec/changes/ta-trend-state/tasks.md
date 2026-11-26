# Tasks

## 1. Источники и контракт

- [x] 1.1 Проверить шесть catalog IDs, official sources/version/hash, сохранить research checkpoint
      и DPO unresolved evidence.
- [x] 1.2 Зафиксировать pure API и metadata/defaults/history в docs и проверить metadata тестами.

## 2. Вычисления

- [x] 2.1 Реализовать Supertrend/SAR и независимые seed/reversal/AF/clamp ledgers, source-only
      focused tests.
- [x] 2.2 Реализовать TSI/KST/Fisher и ручные ratio/log ledgers, flat/gap/overflow tests.
- [x] 2.3 Проверить readonly/prefix causality/timestamps, invalid inputs/resource caps и large
      fixture.

## 3. Проверка source cut

- [x] 3.1 Выполнить direct tsc (baseline missing module), полный source-only compiler host с ровно
      одним виртуальным module, scoped ESLint/Prettier, focused Node и strict OpenSpec; записать
      evidence.
- [x] 3.2 Зафиксировать ограниченный source commit и clean worktree без registration/build/version
      side effects.

## Workflow follow-up

- DPO fractional offset остаётся unresolved до первичного conversion evidence или отдельного Pine
  execution.
- Координатор выполняет review, регистрацию и последующую архивацию отдельно.
