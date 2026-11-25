# Bybit public provider foundation

Код в `src/services/providers/bybit/` готовит публичный источник для последующей интеграции. Он пока
не подключён к UI/TerminalController, общим MarketRow/Catalog, storage, drawings/camera, flags,
backup или Drive. Криптовалюты в работающем терминале этим change не включены. OKX fallback также не
реализован; сетевой отказ Bybit не означает отсутствия пары.

## Контракты

`InstrumentRef = { provider: "bybit", category: "spot" | "linear", symbol: nativeSymbol }`.
`seriesId(ref)` возвращает `bybit:spot:BTCUSDT` либо `bybit:linear:BTCUSDT`. Display ticker
`BTC/USDT` хранится отдельно, банковские UID/FIGI не создаются. Native symbol проверяется, не
угадывается из тикера базового актива.

`BybitHttp` использует только GET `/v5/market/*` на `https://api.bybit.com`, bound global fetch,
`credentials: omit`, без ключей, auth headers и автоматических retries. Timeout по умолчанию15с,
допустимый диапазон1–60000мс. Владелец передаёт AbortSignal. `BybitError.kind` различает
forbidden403, rate-limit429/API10006, network, timeout, http, api, protocol и pagination.
Retry-After сохраняется для будущего facade; ошибки не преобразуются в пустой каталог.

`loadCatalog(http, signal)` читает весь spot и все страницы linear с limit1000 до пустого cursor.
Повтор cursor и предел100 страниц отклоняются. Только весь успешный результат имеет
`complete: true`; это полнота перечисления текущего V5 default status set за время загрузки, не
транзакционный снимок и не обещание наличия исторических/закрытых инструментов.

Каждый инструмент сохраняет assetClass, native symbolType/status/contractType, base/quote/settle,
fullName, шаги, launchTime, marketRegion/underlyingTicker и xstockMultiplier. Crypto eligibility:
Trading spot либо Trading LinearPerpetual с settle USDT, исключая stock/ETF/forex/commodity,
xstocks/mstocks и неизвестные symbolType. TradFi metadata доступны через общий результат и
`searchCatalog(..., { cryptoOnly: false })`, но это не владение акциями и не биржевая цена акции.
Multiplier хранится только как metadata: raw token candles не превращаются в adjusted stock history.
LaunchTime не доказывает начало доступной истории; marketRegion не заменяет полный session calendar.

`searchCatalog` по умолчанию ищет только cryptoEligible. Поиск локальный: NFKC/case-normalized
substring по native symbol, display ticker, base, quote, fullName и явным aliases с ключом seriesId.
Spot fullName обогащается из linear только при точном base и единственном различном названии.
Цифровые множители/суффиксы не отбрасываются; ambiguous base не обогащается.

## История и quotes

`loadHistory(http, ref, interval, { from, to, maxPages? }, signal)` загружает inclusive UTC ms range
назад страницами до1000 свечей, следующий end равен самому старому timestamp−1. Предел по
умолчанию1000 страниц; исчерпание бюджета или неверная граница страницы означает ошибку, а не
обещание полного покрытия. Пустая страница завершает загрузку, пробелы не заполняются.

Свечи отсортированы, без duplicate timestamp, с open/high/low/close, baseVolume и quoteTurnover.
Пустые, boolean, exponent/hex и нечисловые значения не превращаются в нули. Невалидная свеча
отклоняет страницу. REST confirmed равен null: время получения не доказывает закрытие текущего бара.

Явные интервалы: 1m/3m/5m/15m/30m/1h/2h/4h/6h/12h/1d/1w/1M. 2m,10m и остальные неподдерживаемые
значения отклоняются до запроса; агрегации здесь нет. Месяц передаётся как native M, не30дней.

`loadQuotes(http, category, symbol?, signal)` сохраняет last/mark/index отдельно, previousPrice24h,
changePercent24h и `comparisonBasis: rolling-24h`. baseVolume24h и quoteTurnover24h остаются объёмом
Bybit base и оборотом в quote. Это не банковский previousClose и не MOEX session day. Валюта и
единицы берутся из metadata инструмента; USDT не переименовывается в USD.

## WebSocket lifecycle

`BybitStream` — отдельный владелец одного spot или linear public socket. Конструктор инертен.
`setSubscriptions({ tickers: [...nativeSymbols], candles: [{ symbol, interval }] })` проверяет и
устраняет дубликаты; максимум1000 topics. `start(signal?)` начинает подключение. При open все
подписки отправляются пачками по10; обновление отправляет unsubscribe/subscribe различий. Пустой
набор освобождает socket/timers. `dispose()` идемпотентно закрывает только свой socket, снимает
abort listener и отменяет все свои таймеры. После dispose instance не переиспользуется.

`onEvent` получает quote/candles/ack/pong. Derivatives delta применяется к полученному snapshot;
пропущенные поля сохраняются, explicit empty становится null. До первого snapshot delta
игнорируется. Spot принимает snapshot. Старые timestamp и callback прежнего socket игнорируются. WS
candles сохраняют confirm. На reconnect protocol state сбрасывается и подписки восстанавливаются;
будущий facade должен сам backfill пропущенный диапазон и отменять его при смене инструмента.

По умолчанию connect timeout10с, heartbeat20с, ожидание pong10с, reconnect1с с exponential backoff
до30с и максимум5 последовательных reconnect без data event. После исчерпания onState сообщает
exhausted и таймеров нет; новый явный start начинает новую ограниченную попытку. onState open
позволяет будущему facade инициировать backfill, но не доказывает получение цены. Listener callbacks
должны завершаться без исключений. Socket factory и clock внедряются для тестов; реальные долгие
соединения не запускались в этой задаче.

## Пример для будущего facade

```ts
const http = new BybitHttp();
const owner = new AbortController();
const catalog = await loadCatalog(http, owner.signal);
const results = searchCatalog(catalog, "bitcoin");
const stream = new BybitStream("spot", { onEvent: handleProviderEvent });
stream.setSubscriptions({ tickers: ["BTCUSDT"], candles: [{ symbol: "BTCUSDT", interval: "1m" }] });
stream.start(owner.signal);
// On owner change: owner.abort(); stream.dispose();
```

## Проверка и границы

`node --test test/bybit-rest.test.mjs test/bybit-websocket.test.mjs` проверяет реальные модули через
TS transpilation, fake fetch/socket/clock. Тесты не обращаются в сеть и не используют аккаунт.
`pnpm typecheck`, scoped ESLint, Prettier и strict OpenSpec обязательны. Browser/CORS/реальные
подписки, UI, CSP-разрешение доменов, storage identity и восстановление backup остаются
интеграционным этапом. Version package не менялся в изолированном foundation; новые src inputs
меняют content buildId, и при общей публикации потребуется соответствующий release bump по правилам
проекта.

Контракты сверены с официальными
[instrument metadata](https://bybit-exchange.github.io/docs/v5/market/instrument),
[tickers](https://bybit-exchange.github.io/docs/v5/market/tickers),
[kline](https://bybit-exchange.github.io/docs/v5/market/kline),
[WS connect](https://bybit-exchange.github.io/docs/v5/ws/connect),
[WS ticker](https://bybit-exchange.github.io/docs/v5/websocket/public/ticker) и
[WS kline](https://bybit-exchange.github.io/docs/v5/websocket/public/kline).
