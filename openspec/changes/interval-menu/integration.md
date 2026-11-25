# Подключение меню интервалов

В изолированном worktree подключены 13 нативных интервалов в Toolbar, историю, поток, кеш и backup.
Меню содержит все 18 строк; пять производных явно недоступны до следующего этапа. Это не полная
поддержка 18 интервалов. Сервер и канонический checkout не затронуты.

## Контракт

```ts
type IntervalId =
  | "1m"
  | "2m"
  | "3m"
  | "5m"
  | "10m"
  | "15m"
  | "30m"
  | "45m"
  | "1h"
  | "2h"
  | "3h"
  | "4h"
  | "1d"
  | "1w"
  | "1M"
  | "3M"
  | "6M"
  | "12M";
```

Экспорты модели: `src/model/intervals/index.ts`. Компонент:
`src/screens/terminal/intervals/TimeframeMenu.tsx`. Стили: `/interval-menu.css`, подключать после
основных стилей темы. Портал меню находится в `document.body`; CSS наследует глобальные переменные
`--surface-raised`, `--text`, `--muted`, `--line`, `--surface-hover`, `--surface-selected`,
`--accent`. Никаких контекстов, storage, таймеров или сетевых запросов внутри нет.

```tsx
<TimeframeMenu
  value={preferences.timeframe}
  onSelect={setTimeframe}
  favorites={favoriteIntervals}
  onToggleFavorite={toggleFavoriteInterval}
  availability={{
    "45m": "Для этого интервала пока нет торгового календаря.",
    "3h": "Для этого интервала пока нет торгового календаря."
  }}
/>
```

`availability` содержит только недоступные ID с непустой причиной; отсутствие ключа разрешает выбор.
Звезда вызывает только `onToggleFavorite`, не выбирает интервал и не закрывает меню. Избранное
отображается в порядке реестра. Сохранение избранного по владельцу — ответственность интеграции; при
чтении фильтровать неизвестные значения через `isIntervalId`. Текущий ID остаётся в кнопке даже при
временно недоступном источнике. Меню не изменяет диапазон запрошенной истории.

## Подтверждённое соответствие T‑Invest

Проверено 25.11.2026 по официальному
[marketdata.proto](https://github.com/RussianInvestments/investAPI/blob/main/src/docs/contracts/marketdata.proto).
Имена в таблице — суффиксы `CANDLE_INTERVAL_` / `SUBSCRIPTION_INTERVAL_`. Числовое значение
совпадает для истории и потока. Ограничения времени запроса ориентировочные по proto; API также
ограничивает число возвращённых свечей. `history.maxRequest` хранит календарную единицу,
`history.maxCandles` — лимит количества. Нельзя превращать месяц в фиксированные 30 дней для
календарных границ.

| ID  | Enum | История | Поток           | Максимальный запрос / свечи |
| --- | ---- | ------- | --------------- | --------------------------- |
| 1m  | 1    | 1_MIN   | ONE_MINUTE      | 1 день / 2400               |
| 2m  | 6    | 2_MIN   | 2_MIN           | 1 день / 1200               |
| 3m  | 7    | 3_MIN   | 3_MIN           | 1 день / 750                |
| 5m  | 2    | 5_MIN   | FIVE_MINUTES    | 1 неделя / 2400             |
| 10m | 8    | 10_MIN  | 10_MIN          | 1 неделя / 1200             |
| 15m | 3    | 15_MIN  | FIFTEEN_MINUTES | 3 недели / 2400             |
| 30m | 9    | 30_MIN  | 30_MIN          | 3 недели / 1200             |
| 1h  | 4    | HOUR    | ONE_HOUR        | 3 месяца / 2400             |
| 2h  | 10   | 2_HOUR  | 2_HOUR          | 3 месяца / 2400             |
| 4h  | 11   | 4_HOUR  | 4_HOUR          | 3 месяца / 700              |
| 1d  | 5    | DAY     | ONE_DAY         | 6 лет / 2400                |
| 1w  | 12   | WEEK    | WEEK            | 5 лет / 300                 |
| 1M  | 13   | MONTH   | MONTH           | 10 лет / 120                |

В потоке 2h/4h начало отсчитывается от 00:00 UTC — это явно указано в `CandleInstrument.interval`.
Не переносить на эти нативные свечи сессионное выравнивание производных интервалов.

| Производный ID | Реальный источник истории и потока | Преобразование                                    |
| -------------- | ---------------------------------- | ------------------------------------------------- |
| 45m            | 15m                                | `aggregateSessionCandles(source, "45m", options)` |
| 3h             | 1h                                 | `aggregateSessionCandles(source, "3h", options)`  |
| 3M             | 1M                                 | `aggregateCalendarMonths(source, 3, { asOf })`    |
| 6M             | 1M                                 | `aggregateCalendarMonths(source, 6, { asOf })`    |
| 12M            | 1M                                 | `aggregateCalendarMonths(source, 12, { asOf })`   |

Для производного ID у записи **нет** `history`/`stream`; использовать запись `source` и
пересчитывать после обновления исходной свечи. Историю исходного интервала хранить отдельно от
результата агрегации, не смешивать кеши. Для `3M/6M/12M` расширять начало fetch до начала
квартала/полугодия/года. Секунды 5/10/30 существуют в истории (enum 14–16), но отсутствуют в
SubscriptionInterval. Их нет в согласованном IntervalId. Тики и диапазоны также не выбираются;
причины видны в меню.

## Конвенция агрегации

- Все timestamps и `asOf` — Unix milliseconds; функции чистые и не обращаются к часам.
- Месячный источник должен иметь начало месяца в 00:00 UTC. Иные значения явно отклоняются. Proto
  подтверждает UTC timestamps; календарные начала квартала/полугодия/года — конвенция терминала.
  Если API вернул другой timestamp, сначала явно подтвердить/нормализовать месячный источник, а не
  округлять произвольные дневные свечи.
- `sessionFor(timestamp)` обязателен для каждого исходного 15m/1h бара и возвращает `{start,end}`.
  Источник должен быть совместим с этим якорем: при сессии 07:00 допустимы 07:00/07:15/07:30 для
  45m. Если часовой источник выровнен иначе, требуется более мелкий источник/отдельное решение;
  функция не пересобирает его молча по UTC. `null`, timestamp вне сессии, несовместимые или
  противоречивые границы вызывают RangeError. Паузы и ночные сессии определяет вызывающий календарь.
- Последний бар сессии заканчивается по `session.end` и может быть короче номинального интервала.
- Из реальных свечей берутся первый open, максимальный high, минимальный low, последний close, сумма
  volume. Пустые бары/месяцы не создаются. Дубликат timestamp заменяется последним входом.
- Результат совместим с общей структурой Candle и дополнен `endTimestamp`, `sourceCount`, `hasGaps`,
  `isComplete`. `hasGaps` означает неполный набор исходных слотов, включая ещё не наступившие;
  `isComplete` требует полного набора, закрытого периода по `asOf` и отсутствия исходного
  `isComplete:false`. Сохранять этот флаг, если его предоставляет источник.

## Интегрированный промежуточный этап

- `Timeframe = NativeIntervalId` содержит 13 идентификаторов. Оба валидатора history/backup
  принимают именно их. `favoriteIntervals?: IntervalId[]` — только представление меню; пять
  производных можно отметить звездой, но нельзя выбрать как текущий источник.
- `NATIVE_TIMEFRAME_CONFIG` — единственный mapping, реэкспортированный из history-codec и
  market-model. Для 1M `ms=null`, `chunkDays=null`; запросы разбиваются по 119 календарным месяцам,
  чтобы при включительных границах не превысить 120 свечей/10 лет. Остальные chunkDays остаются
  консервативными и укладываются в проверенные ограничения.
- `TimeframeMenu` стоит в Toolbar; `ChartRangeControl` — ниже графика. Lookback явно подписан днями,
  а не календарными месяцами. `setTimeframe` сохраняет rangeDays, UID и избранное.
- Запоздавшие сообщения старого интервала того же UID больше не попадают в live-кеш новой серии: в
  receive проверяются одновременно UID и `TIMEFRAMES[sub.timeframe].stream`.
- Старые правила видимости рисунков не содержат месяцы. 1M не наследует правило weeks; данные
  рисунков и их schema не мигрируются. Настройки/координаты и глобальная камера не меняются.

## Согласование с контроллером на 2ab4dc3

Интеграционная ветка основана на root `2ab4dc3`. Его `history-view-range.ts` адаптирован к
`intervalMs:number|null`: null означает календарный месяц UTC. Сохранены coverage/readiness,
приоритет saved-left, actual warmup bars, offline proof правого края, engine/UID/cancellation,
retired-camera и import recovery guards. Контроллер истории не заменён старой версией.

`planHistoryViewRange` использует календарный shift от target для месячного warmup и выравнивает
from/earliest к началу месяца. `historyFirstDate` использует first1dayCandleDate для 1M и возвращает
начало соответствующего месяца. `historyViewBackfillFrom(plan,cursor,missingBars,multiplier)` каждый
раз пересчитывает границу от текущего cursor; при пустой истории удваивается количество календарных
месяцев, а не ранее вычисленный интервал миллисекунд. Числовые интервалы сохраняют прежний расчёт
дней. `historyViewBackfillStep` оставлен для совместимости; controller использует новую границу from
и не удваивает его результат.

Все вспомогательные функции ниже остаются доступны, timestamps — ms:

```ts
import {
  shiftUtcMonths,
  utcMonthStart,
  shiftTimeframe,
  historyRequestWindow,
  historyWindowStart,
  olderHistoryStart
} from "./intervals/calendar.js";

// Ровно N календарных месяцев назад с корректным clamp дня (31 января -> 29 февраля).
const warmupFrom = shiftUtcMonths(utcMonthStart(until), -N);
// Или N интервалов любого нативного вида, без вычисления monthMs.
const sourceWarmupFrom = shiftTimeframe(until, timeframe, -N);
// Готовая прежняя эвристика lookback + ceil(warmupBars*1.65) интервалов + 14 дней.
const from = historyWindowStart(until, rangeDays, timeframe, warmupBars);
// Готовая граница backfill: для 1M это 120 реальных месяцев.
const olderFrom = olderHistoryStart(cursor, timeframe);
// Нативный monthly GetCandles требует достаточно широкого окна.
const request = historyRequestWindow({ from, to: until }, timeframe);
```

`historyRequestWindow` для 1M выравнивает from по началу месяца UTC; если span ещё меньше месяца,
захватывает предыдущий месяц. Пустые окна не расширяет. `historyWindowStart` уже возвращает эту
выровненную границу; добавочный вызов нормализации ей не нужен. Отдельно сохранить root clamp по
доступности инструмента: для 1M использовать first1dayCandleDate, как для 1d/1w.

Readiness-модель не подставляет 30 дней вместо `intervalMs:null`. Кеш/stream client использует
`shiftTimeframe` для recent coverage и не умножает null. Контроллер приложения содержит 491 непустую
строку, контроллер истории — 381; оба укладываются в ограничение 500.

Проекция `charts/adapter.ts` принимает прежний `intervalMs:number` и дополнительно null для
календарного месяца. Все имеющиеся вызовы из LW/KLine и диалога координат получают его из config;
интерполяция внутри реальных данных сохранена, за пределами используются календарные месяцы.

## Шкала времени

- LW5.0.9: `timeScale.tickMarkFormatter`, штатные TickMarkType Year/Month/DayOfMonth/Time. Мелкие
  подписи при обычном масштабе скрыты; границы месяца/года и дня выбирает сама библиотека. При
  barSpacing >=24 показываются подробные даты/часы. Для 1M timeVisible=false. Форматтер перекрестия
  не переопределён.
- В LW пустая подпись не удаляет штатный grid mark. Поэтому нативные вертикальные линии для
  календарных/часовых интервалов выключены; `paintCalendarGrid` в bottom primitive рисует реальные
  линии на выбранных calendarAxisTicks. Горизонтальная сетка сохранена. Передний слой не рисует
  сетку повторно. Для минутных интервалов остаётся нативная сетка. Это проверено отдельными тестами
  координат рисования и binding production-примитива; одного label hiding недостаточно.
- KLine9.8.12: [публичный custom-axis API](https://v9.klinecharts.com/en-US/guide/custom-axis),
  `registerXAxis/createTicks` и `setPaneOptions({id:"x_axis_pane",axisOptions:{name}})`.
  `calendarAxisTicks` выбирает первые реальные свечи при смене UTC-месяца/дня и расставляет деления
  с приоритетом календарных границ и проверкой расстояния. Имена месяцев не дублируются на каждом
  дневном баре. CustomApi.formatDate, tooltip и crosshair не изменены.
- Реальные calendar boundary ticks и binding KLine API проверены детерминированно. Видимый canvas
  после общей интеграции ещё требует browser/visual QA; это не заявляется как проверенное визуально.

## Оставшаяся интеграция

1. Перенести два итоговых коммита интеграционной ветки в canonical; новые изменения root после
   2ab4dc3 в MTP/прозрачности объединяет владелец canonical. Календарный grid находится в нижнем
   LW-примитиве перед options.paint, соответствующую вставку сохранить при конфликтах слоёв.
2. Подключить исходный fetch и live-пересчёт пяти производных, затем разрешить их в persisted
   Timeframe/backup/cache. До этого причины `DERIVED_INTERVAL_UNAVAILABLE` остаются обязательными.
3. Выполнить общие проверки canonical и изолированную визуальную проверку светлой/тёмной/чёрной
   темы, мобильного меню, Escape, стрелок, Home/End, звёзд, клика снаружи и реальных делений шкалы.

## Выполненные локальные проверки

- `node test/intervals.test.mjs`: 15 поведенческих тестов агрегации и registry.
- `node test/native-intervals.test.mjs`: 12 тестов реальных production-модулей с заменённой
  сетью/хранилищем на границе; каждый из 13 interval enum, source/live/cache, offline, stale-stream,
  backup/binary roundtrip, month/leap/countdown/projection и actual boundary ticks.
- `node test/lifecycle.test.mjs`: сохранение UID/lookback/favorites при всех 13 переключениях.
- Saved-left/calendar warmup/backfill: 9 тестов history-view-range, 14 history-view-load; production
  binding LW grid проверяет реальные линии в bottom primitive.
- Полный `pnpm check` на базе 2ab4dc3: TypeScript, ESLint, Prettier, build и все **193 теста PASS**.
  Build 0.3.7 / `81bf21e070f820e9`, 41 assets. `pnpm spec:validate`: все 8 пунктов PASS. Sandbox
  spawn EPERM устранён разрешённым запуском. Root import/readiness/camera проверки сохранены и
  проходят вместе с новыми месячными сценариями.
- Canonical build, сервер, браузер и настоящая сессия банка не запускались. Фактическая поддержка
  enum проверена по официальному proto, сетевые сценарии — детерминированные проверки границ.
