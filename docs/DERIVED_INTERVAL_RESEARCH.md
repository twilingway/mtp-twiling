# Производные интервалы: исследование

Проверено 26.11.2026, исходный код `dc98e376af8c0f2c5988ee1d18c06c0011399088`. Это предложение
контракта, без включения интервалов и без доказательства совпадения с TradingView. Предыдущий план
`feefd45` полезен как контекст; ниже уточнены provider capabilities и совместимость.

## Что уже есть

`model/intervals/registry.ts` объявляет 13 native T‑Invest и заготовки `45m/3h/3M/6M/12M`.
`aggregate.ts` умеет UTC calendar months и требует явную session для intraday; простой подсчёт
отсутствующих слотов сейчас не отличает отсутствие сделок от недогруженной истории.
`Timeframe = NativeIntervalId`; clients, axis/projection/countdown и JSON guards ещё native.
`favorites.ts` ограничивает список 18 значениями: будущие 23 ID требуют отдельного решения лимита.

`history-codec.ts` хранит шесть Float64 (`ohlcv-f64-v1`); `Candle` не содержит полноту/источник.
`storage-history.ts` группирует native bars по UTC-дню, ключ `owner:uid:timeframe:day`, отдельно
хранит покрытие запрошенных диапазонов. T‑Invest/Bybit clients перезапрашивают хвост последних двух
native баров; successful response сохраняет coverage, live snapshots заменяются по timestamp. Bybit
`confirmed` и T‑Invest raw `isComplete/candleSourceType` до общего `Candle` не доходят. Эту
эвристику нельзя объявить доказательством полноты derived bucket.

## Реальные native и выбор исходников

[T‑Invest GetCandles](https://developer.tbank.ru/invest/api/market-data-service-get-candles):
1/2/3/5/10/15/30м, 1/2/4ч, день/неделя/месяц; также 5/10/30 секунд истории.
[Bybit REST Kline](https://bybit-exchange.github.io/docs/v5/market/kline): 1/3/5/15/30м,
1/2/4/6/12ч, D/W/M. Все запрошенные ниже интервалы производные у обоих API. Наличие custom
resolution в TradingView не означает наличие API enum у поставщика.

| Target ID            | Безопасный initial source            | Более крупный кандидат T‑Invest / Bybit |
| -------------------- | ------------------------------------ | --------------------------------------- |
| `4m`                 | `1m`                                 | `2m` / `1m`                             |
| `6m`                 | `1m`                                 | `3m` / `3m`                             |
| `7m`                 | `1m`                                 | `1m` / `1m`                             |
| `8m`                 | `1m`                                 | `2m` / `1m`                             |
| `9m`                 | `1m`                                 | `3m` / `3m`                             |
| `45m`                | `1m`                                 | `15m` / `15m`                           |
| `3h`                 | `1m`                                 | `1h` / `1h`                             |
| `3M/6M/12M`, позднее | `1M`, после проверки calendar labels | `1M` / `1M`                             |

Крупный кандидат экономит запросы только после проверки: каждый source bar целиком внутри target,
его anchor и состав торгов совпадают. Делимость длительностей недостаточна. Не разрезать OHLCV
часовой свечи на два bucket; при несовпадении использовать 1м или честную недоступность. Native
`2m/10m` T‑Invest нельзя отправлять Bybit. Для месяцев нет подмены на 90/180/365 дней или недели.

## Anchor, календарь и зона

[TradingView sessions](https://www.tradingview.com/charting-library-docs/latest/connecting_data/Trading-Sessions/)
задают биржевую зону и session open; правая граница исключена.
[Pine Time](https://www.tradingview.com/pine-script-docs/concepts/time/) показывает отсчёт intraday
от открытия с укороченным последним баром; chart timezone меняет только отображение. Это общий
контракт, а не установленный профиль MOEX конкретного символа.

- **Bybit:** предлагаемая политика `utc-day-v1`: `[00:00Z,00:00Z следующего дня)`, bucket
  `dayStart + floor((t-dayStart)/duration)*duration`, конец обрезается границей дня. Для `7m`
  последний bucket `[23:55Z,00:00Z)` длится 5 минут; Unix epoch floor дал бы другую сетку. REST/WS
  docs не устанавливают custom 7м anchor или точный W/M календарный anchor. Поэтому это выбранная
  политика терминала; TradingView parity и native D/W/M boundary fixtures ещё pending.
- **MOEX через T‑Invest:** `TradingSchedules` даёт торговые дни, интервалы, аукционы/клиринг
  ([контракт](https://developer.tbank.ru/invest/services/instruments/methods)). Это сведения о
  торгах, не спецификация построения свечей TradingView. Нужны отдельные `tradingDate`,
  `anchorStart`, `bucketEnd`, допустимые trading spans и source mode. Перерыв сам по себе не
  сбрасывает anchor. `tbank-calendar.ts` сейчас вычитает auction/clearing и выбирает regular spans:
  не использовать его как готовую политику всех MOEX свечей. До подтверждения профиля
  инструмент/режим derived MOEX недоступен; UTC rounding или жёсткие 10:00 MSK не являются fallback.
- [T‑Invest stream contract](https://developer.tbank.ru/invest/services/quotes/marketdata) явно
  задаёт отсчёт **2ч/4ч в потоке** с 00:00 UTC. Это не доказательство anchor остальных интервалов,
  истории, 3ч или TradingView. Default/all, exchange и include-weekend источники различаются; в
  текущем обычном GetCandles source type не передаётся.
- **Месяцы:** выбранный будущий контракт — календарные квартал/полугодие/год от января; boundary из
  year/month, label первого календарного дня 00:00Z. Native monthly source обязан иметь проверенное
  соответствие этой trading-date label; иначе отдельный normalizer с доказательством или
  недоступность. **Неделю** оставляем native: `bybitIntervalStart` сейчас предполагает Monday UTC,
  но изученный API текст этого не доказывает. Для MOEX не выводить week start из UTC timestamp.
- User `timeZone/locale` не участвует в bucket/cache/source identity. Intraday подписи форматируют
  исходный instant; D/W/M сохраняют trading-date label (уже принято в `display-locale-timezone`).
  Биржевой календарь и пользовательская зона — разные контексты.

## Полнота и live/history

OHLC = первое O / max H / min L / последнее C, V = сумма уникальных source snapshots, в единицах
источника (T‑Invest — лоты, Bybit spot/linear — base volume). Пустой bucket отсутствует. Пропущенная
минута не превращается в flat/zero candle. Пустой успешный ответ подтверждает только запрошенный
диапазон при доказанном исчерпании страниц/лимитов; network failure не подтверждает покрытие.

Metadata отдельно от цен: `status: open|complete|incomplete|unknown`, границы, покрытие и причина
missing slots. `complete` требует закрытого bucket, исчерпанной source history и подтверждения
финальности реально полученных bars. Известное отсутствие торгов не есть потеря данных; неизвестный
слот остаётся unknown. Для
[Bybit WS](https://bybit-exchange.github.io/docs/v5/websocket/public/kline) `confirm=true` закрывает
source bar; REST close открытого бара — последняя цена сделки. T‑Invest `is_complete` относится к
source bar; `waitingClose=false` даёт обновляемый поток, не финальность. Старый codec теряет
metadata: после reload полнота unknown до перепроверки, даже если цены есть.

Запрос расширять до начала первого и конца последнего target bucket, затем отдавать нужное окно.
Depth/warmup считать в **полученных target bars**, делать bounded backfill с cancellation и
history-start bounds; 440×9м требуют примерно 3960 минут, а торговые паузы увеличат календарный
диапазон. Последние source bars всегда перепроверять; после reconnect догружать пропуск до live
watermark. Сначала заменить source snapshot по timestamp, потом пересчитать bucket: повторные
сообщения не удваивают V. Late correction пересчитывает историю и зависимые TA/MTP.

## Выбранный архитектурный контракт

`ChartIntervalId` (ровно перечисленные ID, case-sensitive `m/M`) отделить от native transport IDs.
Provider `ResolutionPlan` содержит target, native source, anchor/version, source policy и
availability reason. `chart-series` владеет request/generation, `derived-series` —
projection/revisions; transport получает только source. Одна shared native subscription на
provider/owner/instrument/source/mode, refcount и generation guards; при смене target та же source
подписка может переиспользоваться.

Native постоянный кеш сохраняется. Новый source namespace нужен при смене source mode; старый
default кеш нельзя объявить exchange-only. Derived cache сначала только память: provider + owner +
uid + target + source + source mode + anchor fingerprint + aggregationVersion + nativeRevision.
Любая коррекция/import/clear инвалидирует revision, даже при прежней длине массива. Разная display
timezone даёт тот же ключ. Codec/backup metadata sidecar — отдельная миграция, не часть первого
включения.

Совместимость: нынешний JSON schema 1 и Drive guards не менять в исследовании. Для включения выбрать
**schema 2 только у backup/layout envelope, содержащего derived layout**: новый reader принимает
1/2, native-only export остаётся 1, history IDs/codec остаются native. Старый reader отвергнет 2 до
записи, не заменит `7m` на `1m`. Это требует согласования и roundtrip fixtures до реализации;
уточняет прежнее предложение `feefd45` расширить schema 1. Drive должен сохранять envelope/manifest
без потери target, а capability/schema guard — не предлагать несовместимое восстановление. Никаких
новых token fields.

## Предлагаемые чистые test vectors

Математические данные ниже — только fixtures тестов, не product quotes. Время — UTC, границы
`[a,b)`.

| Случай            | Вход / ожидание                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OHLCV/duplicate   | 00:00 `(10,13,9,12,2)`, 00:01 `(12,14,11,13,3)`, повтор 00:01 `(12,15,10,14,5)` → 4м `(10,15,9,14,7)`, count=2, status зависит от coverage                                                       |
| 7м midnight       | 23:54 → `[23:48,23:55)`; 23:55 и 23:59 → `[23:55,00:00)`; 00:00 → новый день, без смешения                                                                                                       |
| Session partial   | Явная тестовая session 09:30–10:40, 45м → `[09:30,10:15)`, `[10:15,10:40)`; это не MOEX расписание                                                                                               |
| Break/anchor      | Тестовая session 09:30–12:00, pause 10:00–10:10: после pause anchor 09:30 сохранён; отдельный профиль reset обязан иметь другой fingerprint                                                      |
| Straddle          | Source 10:00–11:00 пересекает target boundary 10:15 → reject plan, не делить V/OHLC                                                                                                              |
| Calendar          | Jan/Feb(leap)/Mar → `[2024-01-01,2024-04-01)`; 6М Jul–Jan; 12М Jan–Jan. Нет февраля: не создавать свечу, качество unknown/incomplete по evidence                                                 |
| Coverage/tail     | Пустой exhaustive ответ ≠ failure; незавершённая страница не coverage. Дважды один snapshot, REST/live race, поздняя коррекция, reconnect и offline metadata loss                                |
| Invariants/guards | TZ UTC/Moscow/NewYork даёт одинаковые OHLCV/keys; сортировка/immutable input; malformed OHLC, NaN/Infinity, отрицательный V, overflow суммы, stale generation, provider/category/owner isolation |
| Persistence       | Schema 1 native без изменений; schema 2 derived JSON→Drive→JSON сохраняет target/source history; старый reader отказывает атомарно, unknown ID не понижается                                     |

Ограничение проверки: реальные приватные свечи, MOEX session modes/TradingView comparison и Bybit
D/W/M boundary captures не исследованы. Нужен отдельный evidence gate с источником, symbol/class,
датой, режимом торгов, timezone и точными timestamps/OHLCV. `.env`/vault не читались. Реализации,
нативных/визуальных тестов и обещания TradingView parity в этом коммите нет.
