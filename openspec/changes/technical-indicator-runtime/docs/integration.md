# Передача интеграции

- Основа `ffc41fe`, ветка `feat/technical-indicator-core`, отдельный
  `artifacts/technical-indicator-core-worktree`.
- Production-изменения только в новых `src/model/technical-indicators/*`; barrel `index.ts`.
  Existing IndicatorKey/flags/backup/controller/native/MTP не изменены. Нет новых зависимостей.
- Реально работают RSI, MACD, Bollinger Bands, ATR и Stochastic плюс SMA/EMA primitives/definitions
  и общий Wilder RMA. Не заявляется реализация всего reference каталога.
- Registry data-only, immutable, 7 computed definitions и отдельная честная unsupported breadth
  metadata. JSON instances проверяются отдельно от исполнения, нескольким instance одного ID не
  нужен общий singleton state.
- `calculateTechnicalIndicator` возвращает aligned timestamps/number|null series, minimum warmupBars
  и отдельную сериализуемую historyRequirement. Finite Stoch default lookback18, а minimum5.
  Recursive lookback=null/convergence=full-input-dependent, seed policy указан явно; общий RMA имеет
  `rmaHistoryRequirement`.
- Передавать весь подтверждённый вход; не использовать minimum1 как padding EMA/MACD. Разный левый
  seed меняет рекурсивную серию; битовая parity с TV на обрезанной истории не обещается.
- Runtime маскирует реальные отсутствующие source поля null; no-na observations сохраняют state MA.
  Никаких искусственных свечей/нулевых цен/фиктивного volume. Gap и seed semantics подробно в
  contract.md, первичные formula pointers в sources.md.
- Scoped: 15/15 новых тестов, tsc и ESLint. Полный `pnpm check`: 379/379,
  format/lint/typecheck/build проходят. `pnpm spec:validate`: 21/21. `git diff --check` чистый. Все
  новые модули меньше500 nonblank строк.
- Нативная интеграция, UI catalog/legend/settings, storage/Drive projection и отдельная визуальная
  проверка остаются root/следующим workers. Сам расчёт ничего не публикует и не подключает к экрану.
- Каноническая сборка/сервер 5210 и профиль не затронуты; браузер не открывался, публикация не
  выполнялась. Текстовые запросы читали только публичные первичные Pine Reference/builtin ресурсы.
