# Проверка цен результатов поиска

28.11.2026, отдельный worktree `artifacts/mtp-search-result-quotes`, база `180cba5`.

Причина: `bankSearchQuoteUid` разрешал только `kind=share`. Фьючерсы VBZ6/VBH7 не получали
наблюдаемый UID, поэтому не попадали в дополнительный GetLastPrices. Публичные инструменты также
исключались, а guest-сессия вообще не запускала helper.

## Offline-проверки

- `node --experimental-test-isolation=none --test test/instrument-search-prices.test.mjs test/instrument-search-ranking.test.mjs test/instrument-search-actions.test.mjs`:
  VTBR из списка рядом с новыми futures; exact UID, precision0.001, missing/zero quotes;
  ограниченный batch, offscreen exclusion, cache isolation, rapid query abort/stale completion;
  публичные spot/linear/OKX запросы без банковского ключа и частичный отказ источника.
- `pnpm typecheck`: генерация version metadata и проверка strict типов без полной сборки.
- Scoped ESLint/Prettier для изменённых production-модулей и тестов.
- Результат:18/18 search tests и17/17 дополнительных currency-search/okx-provider-rest tests
  проходят; typecheck, scoped ESLint, strict validation этого change и `git diff --check` проходят.

Обычный Node test isolation в sandbox выдавал `spawn EPERM`; проверка запущена без дочерних
процессов через поддерживаемый Node22 флаг. Полная сборка и браузер переданы координатору. Тестовые
ответы — fixtures; доступность реальных котировок конкретных контрактов этим не доказана.

## Контракт публичного API

- Bybit: существующие BybitHttp/loadQuotes, `/v5/market/tickers?category=...&symbol=...`.
- OKX:
  [официальный GET Ticker](https://my.okx.com/docs-v5/en/#order-book-trading-market-data-get-ticker),
  `/api/v5/market/ticker?instId=...`,20 запросов за2 секунды. Ответ проверяется существующим
  normaliseOkxQuote по instType/instId и timestamp; polling всего рынка не используется.

## Интеграционный smoke

В кандидате0.3.45 (`73bad7663c27cbc6`) изолированный Chrome получил настоящие BTC/ETH цены Bybit и
OKX. Показаны exact provider/UID; геометрия строк до и после цены не изменилась. Desktop1440 и
mobile392/320 просмотрены в обеих темах. Это не доказывает доступность банковских цен каждого
найденного фьючерса: их маршрутизация дополнительно покрыта offline batch/UID тестами.
