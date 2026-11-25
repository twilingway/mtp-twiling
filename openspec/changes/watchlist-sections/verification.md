# Verification

## Происхождение и границы

- База: `b4689e17f8d48a49a26472184916739b02c983c8` (`feat/technical-indicator-integration`).
- Ветка: `feat/watchlist-sections-0319`.
- Source-only пакет для 0.3.19. `package.json`, lock, версия, main и publish не менялись.
- Никакие серверы, браузеры, профили пользователя, runtime или API сервисов не запускались.
- В worktree используется junction `node_modules` на установленные зависимости canonical проекта.
  Установка и изменение зависимостей не выполнялись. Ignored app-version подготовлен штатным
  `scripts/prepare-version.mjs` при typecheck; build не выполнялся.

## Проверки исходников

- `pnpm.cmd typecheck` — успешно.
- `node node_modules/eslint/bin/eslint.js src --max-warnings 0` — успешно.
- Prettier check `src`, нового CSS/index и OpenSpec change — успешно.
- `node scripts/spec.mjs validate --all --strict` — 36/36.
- `git diff --check` — успешно.
- Новые production-модули не превышают 500 непустых строк. Controller после добавления display
  fallback короче исходного.

## Поведенческие проверки

Команда source-only suite:

```text
node --test --experimental-test-isolation=none test/watchlist-sections*.test.mjs test/watchlist-order.test.mjs test/watchlist-flags.test.mjs test/watchlist-layout.test.mjs test/portable-import.test.mjs test/provider-storage-v2.test.mjs test/technical-provider-portability.test.mjs test/drive-v2-migration.test.mjs test/market-provider-routing.test.mjs
```

Итог совместного запуска: 82/82. После уточнения запрета захвата верхнего уровня при переносе header
добавлен отдельный перебор всех header targets и повторён sections suite: 21/21.

Стандартный Node runner в sandbox возвращает `spawn EPERM`. Отключение process isolation касается
только тестового запуска; production код и тестируемые source modules не подменялись. На границах
заменены хранилище/транспорт или React hooks для отдельных event tests.

Покрыты реальные TerminalController/MarketClient и storage ports: serial queue,
owner/session/import/ profileTransition/route bounce, optimistic rejection с CAS rollback,
сохранение чужих поздних prefs и более нового ledger, неизменность canonical
rows/UID/providerRef/TA/выбора/камеры и отсутствие новых TBank/Bybit запросов. Native-boundary
IndexedDB helper проверяет JSON import/export, перенос точного display order, owner isolation и
отказ до записи. Drive v2 payload round-trip сохраняет разделы и пустые заголовки. Pure ledger tests
проверяют insert/delete/drag/assign, same-symbol разные UID, точные дубли occurrence,
add/remove/foreign reconcile и сортировку внутри групп.

SSR/component/event проверки подтверждают отдельные header rows, скрытые collapsed members, пустые
разделы, рабочие меню, mobile destination select, Alt+стрелки и RU/EN подписи. Это не визуальная QA.

## Осталось координатору

- Интеграция source-пакета и отдельная установка версии 0.3.19.
- Build и свежая изолированная desktop/mobile визуальная проверка светлой/тёмной темы, реального
  drag, long-press/контекстного меню, размеров и отсутствия горизонтального overflow.
- После визуальной проверки — закрытие task 3.2 и дальнейшие разрешённые release-действия.
