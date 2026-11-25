# Публичные криптоданные для mtp.twiling.ru

Проверено 25.11.2026. Только исследование: проект, .env, аккаунты и настройки не менялись. Источники
— официальная документация/соглашения и малые GET/WS handshake к указанным в ней доменам.

**Bybit, BingX и OKX технически предоставляют котировки, каталог инструментов и свечи без логина/API
key.** Для личной статической PWA прямые REST/WS возможны; секреты и сервер котировок не нужны.
Public API не означает свободную лицензию на публичный агрегатор: особенно существенны ограничения
OKX §9.4.

| Биржа | REST production              | Прямой браузерный доступ: наблюдение                                                                                                    | Порядок подключения                                                |
| ----- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Bybit | `https://api.bybit.com`      | Каталог spot/linear и старые свечи: HTTP 200, code 0, `Access-Control-Allow-Origin: https://mtp.twiling.ru`; оба WS — 101 с этим Origin | 1: наиболее простой первый адаптер                                 |
| OKX   | `https://openapi.okx.com`    | Аналогично для spot/swap; public/business WS — 101                                                                                      | 2: личное использование, учитывать условия данных                  |
| BingX | `https://open-api.bingx.com` | Оба REST каталога: 403 без CORS; WS spot/swap — 101                                                                                     | 3: сначала выяснить REST-доступ с реального клиентского соединения |

Это проверка заголовков и WS Upgrade из текущей сети с TLS verification и системными CA, **не
браузерная визуальная проверка и не полноценная подписка на котировки**. 403 BingX не доказывает
глобальную недоступность или её причину. Гарантия CORS для всех методов/регионов и постоянный Origin
allowlist в проверенных документах не обнаружены. Существующие 200/101 — снимок, не SLA. Артефакты:
`cors-probe.json`, `ws-origin-probe.json`, `year-1m-probe.json`.

## Bybit

| Назначение | Путь / параметры                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| Каталог    | `GET /v5/market/instruments-info?category=spot`; отдельно `category=linear&limit=1000`, пройти `nextPageCursor`          |
| Снимок цен | `GET /v5/market/tickers?category=spot` / `category=linear`; без symbol — все, локально выбрать watchlist                 |
| История    | `GET /v5/market/kline?category=spot&symbol=BTCUSDT&interval=1&start=...&end=...&limit=1000`; linear — отдельная серия    |
| WS         | `wss://stream.bybit.com/v5/public/spot`, `wss://stream.bybit.com/v5/public/linear`; `tickers.BTCUSDT`, `kline.1.BTCUSDT` |

У spot каталог без пагинации; linear содержит также USDC и срочные контракты: для USDT perpetual
выбирать `contractType=LinearPerpetual`, `settleCoin=USDT`, активный статус. `BTCUSDT` spot и linear
имеют одинаковый текстовый symbol, но это разные инструменты.
[Каталог](https://bybit-exchange.github.io/docs/v5/market/instrument),
[REST tickers](https://bybit-exchange.github.io/docs/v5/market/tickers).

WS public без auth; spot ticker snapshot 50 мс, derivatives snapshot/delta 100 мс: отсутствующие
поля delta сохранять. Для 100 spot тикеров отправлять 10 subscription requests по ≤10 topics; linear
не имеет такого лимита количества args, общий размер args ≤21 000 символов. Heartbeat рекомендован
каждые 20 с. [WS connect](https://bybit-exchange.github.io/docs/v5/ws/connect),
[ticker](https://bybit-exchange.github.io/docs/v5/websocket/public/ticker).

HTTP: 600 запросов/5 с/IP; WS: ≤500 новых соединений/5 мин и ≤1000 одновременно/IP для каждого типа
рынка. Общий NAT делит IP-лимит. [Лимиты](https://bybit-exchange.github.io/docs/v5/rate-limit).

Kline максимум 1000, интервал 1 мин доступен, start/end — ms, выдача назад по времени. Точную самую
раннюю дату и сплошное покрытие всех symbols документация не обещает. Для BTC spot/linear фактически
получена свеча 25.11.2025 00:00 UTC.
[История](https://bybit-exchange.github.io/docs/v5/market/kline). API-запросы с IP США/материкового
Китая документированно получают 403; существуют отдельные региональные домены.
[Guidance](https://bybit-exchange.github.io/docs/v5/guide).

## BingX

| Назначение                   | Текущий путь                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Каталог spot / perpetual     | `GET /openApi/spot/v1/common/symbols` / `GET /openApi/swap/v2/quote/contracts`                 |
| Все tickers spot / perpetual | `GET /openApi/spot/v2/quote/ticker` / `GET /openApi/swap/v2/quote/ticker`, symbol необязателен |
| Spot свечи / старая история  | `GET /openApi/spot/v2/quote/klines` / `GET /openApi/spot/v2/quote/historicalKlines`            |
| Perpetual свечи              | `GET /openApi/swap/v3/quote/klines`                                                            |
| Spot / perpetual WS          | `wss://open-api-ws.bingx.com/market` / `wss://open-api-swap.bingx.com/swap-market`             |

Все перечисленные REST определения текущей [docs-v3](https://bingx-api.github.io/docs-v3/#/en/info)
имеют `requiresAuth:false`, без подписи; лимит IP 1/с. Новые quote-пути важны: официальный
[api-ai-skills spot reference](https://github.com/BingX-API/api-ai-skills/blob/main/skills/spot-market/api-reference.md)
предупреждает о legacy mapping для части своих старых путей. Проверенные актуальные определения
сохранены в `bingxCurrentExtract.json` и `bingxOtherExtract.json` из JS официального сайта.

Везде symbol `BTC-USDT`, namespace spot/swap обязателен. Свечи: `symbol`, `interval=1m`,
startTime/endTime ms; обычные klines max1440, historical spot max1000. Полная глубина истории,
гарантированный год минуток и отдельный массовый архив BingX не подтверждены.

WS: `BTC-USDT@lastPrice` или `BTC-USDT@ticker` (ticker раз в 1 с); свечи spot `@kline_1min`, swap
`@kline_1m`. GZIP надо распаковывать в клиенте; серверный Ping/Pong поддерживать. Swap ≤200
topics/сокет и ≤60 сокетов/IP по текущему англ. разделу; spot ≤200 подписок по
[официальному объявлению](https://bingxservice.zendesk.com/hc/en-001/articles/11258500424975-Adjustment-of-Websocket-Subscription-Limits-for-Spot-Trading).
100 тикеров + свечи одного открытого графика укладываются. Дополнительный гарантированный лимит
частоты subscribe не найден.
[Официальное подтверждение public market WS без auth](https://github.com/BingX-API/api-ai-skills/blob/main/AGENTS.md).

## OKX

| Назначение     | Путь / параметры                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Каталог        | `GET /api/v5/public/instruments?instType=SPOT`; отдельно `instType=SWAP`, `settleCcy=USDT`, `ctType=linear`, `state=live` фильтровать по данным |
| Все tickers    | `GET /api/v5/market/tickers?instType=SPOT` / `SWAP`                                                                                             |
| Свечи          | `GET /api/v5/market/candles?instId=BTC-USDT&bar=1m&limit=300`                                                                                   |
| Старая история | `GET /api/v5/market/history-candles?instId=BTC-USDT-SWAP&bar=1m&after=...&limit=300`                                                            |
| WS             | `wss://ws.okx.com/ws/v5/public`: `tickers`; `wss://ws.okx.com/ws/v5/business`: `candle1m`, оба с `instId`                                       |

`BTC-USDT` — spot, `BTC-USDT-SWAP` — perpetual. Market Data без auth. Tickers ≤100 мс; пачка из 100
args меньше предела 64KB. Connect ≤3/с/IP; subscribe/unsubscribe/login ≤480/час/соединение. Не
переносить лимит 30 private connections/subaccount на public. Нет данных 30 с — ping/pong.
[Официальная API v5](https://www.okx.com/docs-v5/en/).

Свечи max300/страницу; latest candles — последние1440, history — последние годы (только 1s
ограничены 3 месяцами). REST tickers 20/2с, candles40/2с, history20/2с, IP. `after` возвращает более
старые записи. BTC spot/swap 1m за 25.11.2025 реально получены.
[Свечи/history](https://www.okx.com/docs-v5/en/#order-book-trading-market-data-get-candlesticks-history).

Для архива есть `GET /api/v5/public/market-data-history`, module2 — 1m, SPOT/SWAP, daily/monthly
ссылки; 5/2с/IP, покрытие ещё дополняется. На
[официальной странице архива](https://www.okx.com/historical-data) OHLC обозначен с июля2023. CORS
самих zip-файлов отдельно не проверен. В актуальных docs production REST — `openapi.okx.com`, WS без
порта8443; региональные US/AU/EU имеют свои домены.

## История, единый поиск и права

Расчёт, не сетевой замер: 365 дней ×1440 =525600 минутных свечей на инструмент; при max1000 это
минимум526 запросов, max1440 —365, max300 —1752. Для 100 инструментов —52,56 млн свечей. Загружать
видимый диапазон, старые страницы по запросу, кешировать в IndexedDB; год 1m не нужен при каждом
запуске. Одна старая свеча не доказывает непрерывность всего года; недавно добавленный инструмент
года истории не имеет.

Поиск подстроки выполнять локально по загруженным каталогам, uppercase + нормализация
пробелов/разделителей; индексировать symbol/base/quote и доступное название. Нативный server
substring search не нужен. Не обещать полные названия каждой монеты из этих каталогов. Рекомендуемая
идентичность: `market:provider:instrumentType:nativeId`, например `crypto:bybit:spot:BTCUSDT` и
`crypto:bybit:usdt_perpetual:BTCUSDT`.

В общем поиске РФ+Crypto: фильтры «Рынок», «Источник», «Биржа», «Брокер», «Тип инструмента», «Валюта
котировки»; типы «Спот» и «Бессрочный USDT-контракт». У криптоисточника broker пустой; российский
брокер не равен бирже. Результат: `BTC/USDT · Bybit · Спот` и отдельный
`BTC/USDT · Bybit · Бессрочный USDT`. USDT не переименовывать в USD. Последняя сделка, mark и index
— разные цены; источник/тип/свежесть показывать явно. В криптобиржевых каталогах встречаются
TradFi/токенизированные активы; не выдавать их за реальные бумаги РФ.

По лицензии:
[Bybit API Terms](https://www.bybit.com/common-static/compliance/legal/BYBIT/df1923006718fbba8ba70d7d762b9866.pdf)
§6.5–6.9 ограничивают копирование сервиса, перепаковку/перепродажу и коммерческое использование.
[OKX API Agreement](https://www.okx.com/en-gb/help/okx-api-agreement) §9.4 ограничивает данные
личными некоммерческими целями, запрещает показ/передачу третьим лицам без письменного согласия,
прямо включая unauth public endpoints.
[BingX Customer Agreement](https://bingx.com/en/support/articles/360033286474-user-agreement)
требует официальный API и запрещает злоупотребление/обход лимитов; однозначная лицензия на публичную
перераздачу и специальное требование attribution не найдены. Отображение источника полезно, но не
заменяет лицензию. Публичную многопользовательскую PWA нельзя автоматически считать разрешённой для
любого из трёх только потому, что каждый браузер скачивает данные сам.

Вывод: **для личной PWA — начать Bybit, затем OKX; BingX добавить после решения REST403 в нужной
сети.** Для публичного агрегатора отдельно прояснить права данных. Backend остаётся только
статическим; REST/WS идут непосредственно с устройства пользователя. Недоступность источника
показывать отдельно, без скрытой подмены биржи у сохранённого инструмента.
