# Tasks

## 1. Touch рисунков

- [x] 1.1 Реализовать один drag, отмену и фильтр native contextmenu; проверить scoped gesture tests.
- [x] 1.2 Увеличить только touch handles и hit targets; проверить drawing hit/render tests.

## 2. Навигация

- [x] 2.1 Удалить compact navigation pad, сохранить mouse controls; проверить scoped navigation
      test.
- [x] 2.2 Отделить axis touch от workspace scroll; проверить workspace-touch tests.

## 3. Проверки

- [x] 3.1 Выполнить scoped lint, format и OpenSpec validation.

## Workflow follow-up

- Координатор выполняет общую проверку и браузерный smoke перед архивированием.

## Verification evidence

- Scoped tests: 46 passed, 0 failed
  (`node --test --experimental-test-isolation=none test/chart-drawing-touch.test.mjs test/workspace-touch.test.mjs test/chart-navigation-controls.test.mjs test/ohlc-legend.test.mjs`).
- Scoped ESLint and Prettier: passed.
- `pnpm spec:validate`: 116 passed, 0 failed.
- Browser and physical phone validation are pending coordinator integration; no phone result
  claimed.
