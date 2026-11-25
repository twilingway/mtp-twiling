# Tasks

## 1. Модель

- [x] 1.1 Реализовать реестр по официальному proto и mapping; проверить node
      test/intervals.test.mjs.
- [x] 1.2 Реализовать календарную и сессионную агрегацию; проверить високосный год, границу года,
      пропуски, неполный бар и неизменность входа.

## 2. Меню

- [x] 2.1 Реализовать callback-компонент, клавиатуру, закрытие, категории, избранное и CSS;
      проверить scoped TypeScript/ESLint/Prettier.
- [x] 2.2 Описать интеграцию и ограничения; проверить spec validate interval-menu --strict.

## 3. Промежуточная интеграция 13 нативных интервалов

- [x] 3.1 Подключить Toolbar, 13 нативных source/live/cache, storage validators, backup, избранное и
      отдельный lookback; проверить pnpm check — все 147 тестов, build, lint и format проходят в
      worktree.
- [ ] 3.2 Проверить видимое меню, клавиатуру, темы и мобильный экран в изолированном визуальном
      агенте.
- [x] 3.3 Добавить реальные календарные деления LW/KLine и календарный 1M; проверить deterministic
      boundary/API-binding/countdown/projection тесты в test/native-intervals.test.mjs.
- [x] 3.4 Описать перенос минимальных календарных изменений в новый root history-view-range.ts;
      проверить integration.md и pnpm spec:validate.
- [x] 3.5 Согласовать с root 2ab4dc3, адаптировать saved-left/monthly warmup/backfill и реальные
      вертикали LW; проверить history-view range/load, primitive binding, полный check и spec.

## 4. Следующий этап полной поддержки 18 интервалов

- [ ] 4.1 Подключить source fetch, session/calendar aggregation и live-пересчёт пяти производных;
      проверить реальные OHLCV и корректную обработку пропусков/неполных исходных баров.
- [ ] 4.2 После подключения расширить persisted Timeframe/backup/cache до производных и снять
      disabled; проверить миграционную совместимость и интеграционные тесты всех 18 интервалов.

## Workflow follow-up

- Архивировать после интеграции и проверки пользователем.
