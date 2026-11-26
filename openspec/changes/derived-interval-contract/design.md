# Design

## Context

База `dc98e376`, состояние и первичные ссылки — в
[исследовании](../../../docs/DERIVED_INTERVAL_RESEARCH.md). Это reviewable предложение, не изменение
runtime. Native enum, source capability, chart interval и отображение timezone сейчас местами
связаны общим Timeframe. Метаданные финальности теряются при переходе в общий Candle/codec.

## Goals / Non-Goals

**Goals:** определить воспроизводимые границы, source identity, coverage и совместимость для 7
запрошенных intraday ID; предусмотреть календарные 3/6/12М без фиксированных суток.

**Non-Goals:** реализация, цены пользователя, включение MOEX без evidence, TradingView parity, новые
тики/секунды/range bars, изменение registry35 или обоих renderers в этом коммите.

## Decisions

### 1. Separate chart target and provider source

Предлагаемый `ChartIntervalId` содержит прежние ID и новые `4m/6m/7m/8m/9m`; native transport union
остаётся отдельным. Resolver возвращает immutable `ResolutionPlan` с target/source/provider,
`sourcePolicy`, `anchorPolicy`/fingerprint, `aggregationVersion`, availability/reason. Закрытый ID
guard сохраняется: никаких произвольных строк/API enum для derived. Capability определяется
провайдером: нынешний T‑Invest native union не является capability Bybit.

Альтернатива расширить общий Timeframe сразу отвергнута: она пропустит target в REST/WS/cache и
нарушит current serializers. Две независимые реализации OHLCV в providers также не нужны.

### 2. Explicit anchor policy before availability

Bybit policy `utc-day-v1` сбрасывает intraday сетку в 00:00Z, обрезая 7м последний бар до 5 минут.
Это продуктовый выбор, не доказанный custom TradingView anchor. T‑Invest MOEX resolver требует
проверенную версию session profile с tradingDate/anchorStart/end/tradableSpans/sourceMode; break и
bucket anchor разделены. Неизвестный профиль возвращает недоступность. Существующий calendar
используется как evidence активности, не как автоматическое определение начала каждой свечи.

Начальный source 1м делает границы точными до минуты. Оптимизации по таблице исследования разрешены
лишь после проверки полного вложения source bars и идентичного состава торгов. Ни native bars,
пересекающие boundary, ни недельные bars для месяцев нельзя математически разрезать без сделок.
Календарные 3/6/12М используют Jan-aligned month index; source monthly trading-date labels
проверяются до включения. Native недели сохраняют provider timestamps; новый weekly projector не
входит в scope.

### 3. Prices and quality have different evidence

Projection возвращает реальные цены плюс отдельные bounds/sourceCount/coverage/status/reason. `open`
— bucket ещё открыт; `incomplete` — известна неполная загрузка; `unknown` — нет доказательств
полноты/финальности; `complete` — закрытый bucket с exhaustive coverage и final source bars. Наличие
отсутствующего timestamp — диагностика, не доказательство ошибки; отсутствие сделок и неторговое
время не создают OHLCV. Unknown volume/overflow/некорректные цены отвергаются, ноль не
подставляется. Metadata не меняет значения существующего native Candle.

History loader выравнивает source window до target bounds и backfill считает в реальных target bars,
учитывая limits, history start и cancellation. Пустой exhaustive ответ сохраняет coverage; ошибка,
cap/page exhaustion — нет. Source cache после reload без finality metadata даёт unknown. Постоянный
sidecar отложен; это честнее присвоения `isComplete !== false` старому бинарному кешу.

### 4. One native series, reproducible target projection

`chart-series` хранит request/generation и переводит progress; `derived-series` хранит revision и
projection. Source subscription key = provider/category + owner + instrument + native source + mode;
refcount/dedup/reconnect и generation guards исключают чужой target. Live snapshots заменяют source
bar, затем пересчитывается affected bucket. Старые коррекции дают replace-history и пересчёт TA/MTP,
новый bar — append, текущий — replace-last. Оба renderer получают одинаковый общий output.

Native persistent cache остаётся authoritative. Derived memo только в памяти, ключ из исследования;
revision меняется при correction/import/clear, а не по длине массива. Source mode не меняется
неявно: переход с нынешнего default на exchange-only требует отдельного namespace/migration. Display
timezone ни в ключе, ни в математике. Будущая проекция axis/countdown без проверенных границ session
возвращает недоступность, а не вымышленные даты торгов.

### 5. Explicit persistence compatibility gate

Рекомендован backup schema 2 для envelope с derived layout; native-only export остаётся 1. Reader
принимает прежнюю schema 1 без изменения defaults/ID/цен и schema 2 по строгому guard; history
blocks остаются native `ohlcv-f64-v1`. Старый reader должен отвергнуть 2 до любых записей. Derived
layout не выдаёт source ID за target. Drive manifest/content validation обязаны поддержать тот же
schema contract до публикации. Текущий коммит не меняет эти guards и не создаёт schema 2.

Альтернатива `feefd45` — расширить schema 1 только для нового layout guard — хуже обозначает
несовместимость старого reader. Выбор schema 2 требует отдельного одобрения root/пользователя до
реализации. Если выбран другой migration contract, сначала обновляются proposal/design/vectors.

## Dependency graph / File ownership

```text
primary sources + approved anchor/schema evidence
  -> interval contract + pure bucket/quality tests
  -> provider resolution plan + source history/stream metadata
  -> chart-series + derived-series + source cache invalidation
  -> persistence/Drive migration + atomic roundtrip tests
  -> controller/renderers/axis/countdown + browser validation
```

| Пакет             | Предлагаемое владение                                                                                         | Зависимость и проверка                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Pure intervals    | `model/intervals/{registry,aggregate,calendar}.ts`, новые policy modules; `test/derived-intervals.test.mjs`   | Evidence gate; hand vectors, bounds, sparse coverage, immutable inputs                         |
| Provider series   | Новые `services/{chart-series,derived-series}.ts`, `tbank-client.ts`, `market-public.ts`, `providers/bybit/*` | Pure contract; mocked pagination/snapshot/reconnect/generation tests                           |
| Source cache      | `history-codec.ts`, `storage-history.ts`, cache contracts/metadata adapter                                    | Provider provenance; clear/import/offline/empty-range regression tests, старый codec неизменен |
| Persistence       | `model/{types,backup-format}.ts`, `services/types.ts`, `services/drive/*`, layout restore                     | Approved schema gate; native schema 1 fixtures и derived schema 2 atomic JSON/Drive roundtrip  |
| Chart integration | Controller/terminal state, intervals axis/projection/countdown, adapters/UI/favorites                         | Общая projection + persistence; оба engine и camera/TA behavior проверяются отдельно           |

`model/types.ts` — shared boundary: один интегратор после согласования, не параллельные правки.
Registry35/TA definitions, tokens, vault, package/lock и версия — вне ownership всех этих пакетов.

## Risks / Trade-offs

- MOEX TradingView session profile неизвестен → недоступность до exact symbol/date/mode evidence;
  TradingSchedules alone недостаточен. Нет обещания parity по UTC.
- 1м source увеличивает запросы и ограничивает глубину → limits/backfill budget, history-start
  bounds, verified larger-source optimization; не заменять отсутствующую историю coarse bars
  незаметно.
- REST finality и old codec metadata недостаточны → unknown и tail revalidation, не ложный complete.
- Schema 2 несовместима со старым reader → отдельное одобрение, clear refusal до записи, native-only
  schema 1 export для обратного пути; без source bars offline честно показывает отсутствие данных.

## Migration Plan

В этом change миграции нет. Перед implementation согласовать anchor availability и schema contract;
создать behavioral delta к `candle-intervals`, затем по пакетам графа добавить код/fixtures. Сначала
intraday Bybit policy, затем только доказанные MOEX profiles; месяцы — поздняя отдельная фаза. Откат
отключает derived выбор и память, сохраняет native cache и schema 1 данные; schema 2 snapshot
сохраняется без разрушительного преобразования. Неподдерживаемый layout не импортируется частично.
