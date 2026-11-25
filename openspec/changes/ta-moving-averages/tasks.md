# Tasks

## 1. Контракт и формулы

- [x] 1.1 Проверить первичные формулы, seed, gaps и HMA rounding; записать ссылки и пределы
      проверки.
- [x] 1.2 Реализовать шесть функций и data-only metadata; проверить ручными рациональными fixtures,
      constant/ramp/zero/null, n=1/2/odd, high magnitude и frozen input.
- [x] 1.3 Проверить rolling WMA/VWMA deterministic budget на 100000 барах/период10000, ручные
      значения после rebase и восстановление малого масштаба после выпадения доминирующего значения.

## 2. Проверка пакета

- [x] 2.1 Выполнить focused tests, scoped ESLint/Prettier, source TypeScript и strict spec
      validation.
- [x] 2.2 Проверить diff на соблюдение ownership и зафиксировать scoped commit.

## Workflow follow-up

- Координатор подключает функции в общий registry/runtime и отдельно проверяет native/UI
  availability.
- Архивировать change после review пакета и принятия интеграционного контракта.
