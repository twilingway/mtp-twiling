# Валюты в поиске

Каталог `Currencies(INSTRUMENT_STATUS_ALL)` дополняет акции, фьючерсы и индексы. Пустой optional
`currencies: []` означает успешно загруженный пустой каталог; отсутствие поля — старый кэш либо
неуспешный запрос. Свежий старый кэш немедленно дозагружает только валюты. При ошибке валют прежние
данные и сессия сохраняются; следующий запуск повторяет попытку. Версия IndexedDB и backup
schemaVersion 1 не меняются.

«Валюты»/Currencies и «Валюта»/Currency работают как для каталога, так и для fallback
`instrumentType=currency` или `instrumentKind=INSTRUMENT_TYPE_CURRENCY`. Это подтверждено live
FindInstrument 25.11.2026 для USD000UTSTOM/CETS.

Поисковые алиасы:

| Запросы                                    | Целевые реальные тикеры |
| ------------------------------------------ | ----------------------- |
| USDRUB_TOM, USD/RUB, USD RUB, доллар рубль | USD000UTSTOM, USDRUB    |
| EURRUB_TOM, EUR/RUB, евро рубль            | EUR_RUB__TOM, EURRUB    |

Алиасы не записываются в ticker/symbol и не меняют UID, ключи камер или истории. Например,
USD000UTSTOM/CETS и USD000UTSTOM/CNGDOTC сохраняются разными строками с разными UID. Каталог
сохраняет classCode/exchange/realExchange; эти optional публичные поля строки проходят нормализацию,
JSON и Drive backup. `moex_close` отображается как «MOEX · данные закрытия», `dealer_fx_otc` —
«Дилер · внебиржевой». Эти подписи не обещают поток текущих биржевых сделок.

## Проверки

- `node test/currency-search.test.mjs`: 8 тестов; локальные алиасы и идентичность,
  fallback/enum/cancel, кэш и отказ Currencies, запуск реального клиента и добавление двух
  одинаковых тикеров с разными UID, actual storage/JSON/Drive, компонент и RU/EN подписи.
- Регрессия: 79 тестов (currency-search, watchlist-layout, watchlist-order, fx-symbol-recovery,
  lifecycle, drive-sync).
- Typecheck, lint, format и `pnpm spec:validate` выполняются в worktree. Сервер, браузер и
  production build не запускаются; общую сборку и визуальную проверку выполняет координатор.

## Интеграция

База ветки — `4ea5efc`. `Watchlist.tsx`, `ChartPanel.tsx`, public/index, global CSS и версия не
изменены. Координатор добавляет ветку `row.type === "currency" ? t("Валюта")` в подписи
Watchlist/ChartPanel. Криптовалютная категория появится отдельным изменением с реальным поставщиком.

Live audit остаётся вне Git в `D:/MySource/ReactJS/vps/artifacts/usdrub-tickers-audit/`: шесть
успешных публичных read-only запросов, каталоги/UID/источники/времена и цены. Аккаунты, заявки и
портфель не запрашивались. Файлы не содержат токен.

Т‑Банк документирует
[Currencies и поля FindInstrument](https://developer.tbank.ru/invest/services/instruments/methods).
[MOEX описывает беспоставочные USD/RUB](https://www.moex.com/s3933); это не доказывает, что
конкретная серия T‑Bank moex_close является новым потоком сделок MOEX 2026 года.
