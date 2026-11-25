# Tasks

## 1. Публичные данные

- [x] 1.1 Согласовать identity/facade/isolation contract; проверить отражение в design.md.
- [x] 1.2 Подключить MarketClient search/add/history/WS и банковский boundary; проверить
      market-provider-routing tests.
- [x] 1.3 Подключить readiness, подписи продуктов, интервалы и CSP; проверить locale-interface и
      lifecycle tests.

## 2. Переносимые профили

- [x] 2.1 Реализовать atomic локальную миграцию, logical image owner и schema2 refs/flags; проверить
      provider-storage-v2 tests.
- [x] 2.2 Изолировать Drive2, добавить readonly legacy import; проверить drive-v2-migration и
      drive-import-abort tests.
- [x] 2.3 Описать обновление устройств и границы переноса в BYBIT_TERMINAL_INTEGRATION.md.

## 3. Общая проверка

- [x] 3.1 Выполнить полный pnpm check и pnpm spec:validate; проверить итоговые logs и scoped commit.

## Workflow follow-up

- Координатор объединяет TA/drawing ветки и выполняет изолированную браузерную приёмку обоих
  графиков перед публикацией.
- OKX остаётся отдельным scope: только после доказанного отсутствия exact tuple в полном успешном
  Bybit каталоге.
