# Производные интервалы: чистая минутная математика

`src/model/derived-intervals/index.ts` — независимый source-only контракт для 4/6/7/8/9/45 минут и
180 минут (3 часа). Он не подключён к продукту. Реальные private/provider данные и совпадение с
TradingView не проверялись. Исследование и будущая архитектура остаются в
`DERIVED_INTERVAL_RESEARCH.md` и change `derived-interval-contract`; этот пакет их не включает.

## API

```ts
aggregateDerivedMinutes(request: DerivedMinuteRequest): readonly DerivedMinuteBar[]
```

Caller обязан явно задать:

- `baseInterval: "1m"`, `targetMinutes: 4 | 6 | 7 | 8 | 9 | 45 | 180`;
- `bars`: readonly реальные, строго нормализованные OHLCV с `timestamp` и
  `finality: "final" | "forming" | "unknown"`;
- `sessions`: readonly supplied sessions либо `{ kind: "unknown" }`, что даёт ошибку;
- `coverage`: readonly диапазоны с `evidence: "exhaustive" | "partial" | "unknown"`;
- `asOf`: момент снимка в Unix milliseconds, safe integer в диапазоне JavaScript Date.

У session есть `start`, `end`, `anchor`, `openWindows: readonly {start,end}[]`. Все ranges —
`[start,end)`. Timestamps bars, границы sessions/windows/coverage и anchor кратны 60 000. `asOf`
может находиться внутри минуты. `anchor <= session.start`; anchor может предшествовать start.
Sessions, их окна и coverage строго упорядочены, без перекрытий; соседние диапазоны допустимы.
Пустой список sessions допустим при пустых bars. Пустые openWindows обозначают отсутствие открытых
минут.

Известная длительность source — ровно минута. Каждый source целиком помещается в одно openWindow.
Бар в перерыве или вне supplied session — ошибка. Секундные, 2/3/5/15/60-минутные и месячные
источники не поддерживаются; OHLCV более крупного бара невозможно разрезать.

Движок не сортирует и не выбирает победителя среди duplicate snapshots. Caller заранее выполняет
доказанную нормализацию и заменяет исправления по timestamp. Повторяющиеся timestamps, включая
одинаковые snapshots, отвергаются. Все O/H/L/C/V finite, `high >= max(open,close,low)`,
`low <= min(open,close)`, `volume >= 0`. Нулевые цены, отрицательные цены и реальный нулевой volume
допустимы, если соблюдён OHLC контракт. Missing volume не подменяется нулём.

## Anchor и границы

Для source timestamp `t`, duration `d = targetMinutes * 60_000`:

```text
gridStart = anchor + floor((t - anchor) / d) * d
bucketStart = max(session.start, gridStart)
bucketEnd = min(session.end, gridStart + d)
```

Timestamp результата — `bucketStart`, даже если первая реальная сделка позже. Это supplied boundary,
а не вымышленная цена. Short leading/last bucket выбирается только данными caller. Перерывы убирают
минуты из expected count, не сбрасывая anchor. Для reset caller задаёт отдельную session. Окно
внутри bucket может начаться позже его timestamp; bucket end остаётся границей сетки/session.

Если caller явно выбирает сутки UTC `[00:00Z,00:00Z следующего дня)` и anchor в начале каждых суток,
7-минутный последний bucket — `[23:55Z,00:00Z)` длиной 5 минут. Это локально выбранная политика, не
утверждение о Bybit, MOEX или TradingView. Session не выводится из timezone или symbol. UI timezone
в API отсутствует и не влияет на OHLC. Встроенных календарей, торговых часов и DST нет.

## Цены и качество

Только buckets с реальными bars создают свечу: O первого, H максимум, L минимум, C последнего, V
сумма в исходных единицах. Пустые buckets отсутствуют, forward fill запрещён. При переполнении суммы
V — ошибка `arithmetic-overflow`; Infinity и fake zero не возвращаются. IEEE-754 округление finite
сумм сохраняется; пакет не вводит decimal accounting или перевод единиц volume.

`quality` отдельно содержит:

| Поле                     | Значение                                                      |
| ------------------------ | ------------------------------------------------------------- |
| `expectedMinutes`        | Все минуты пересечения bucket и supplied openWindows          |
| `sourceMinutes`          | Реально переданные уникальные source bars                     |
| `missingSourceMinutes`   | Expected минус source, включая будущую часть открытого bucket |
| `exhaustiveMinutes`      | Минуты открытых окон с exhaustive coverage                    |
| `partialCoverageMinutes` | Минуты открытых окон с partial evidence                       |
| `unknownCoverageMinutes` | Остальные открытые минуты, включая отсутствие coverage        |
| `finalSourceMinutes`     | Реальные bars с explicit final                                |
| `formingSourceMinutes`   | Реальные bars с explicit forming                              |
| `unknownFinalityMinutes` | Реальные bars с explicit unknown                              |

Coverage не подтверждает финальность bars и не означает наличие торгов. Overlap запрещён, поэтому
двойной подсчёт evidence невозможен. Движок не удостоверяет правдивость evidence: caller обязан
подтвердить pagination exhaustion, источник, режим и границы ответа. Coverage вне открытых окон не
учитывается. Отсутствующая минута остаётся missing даже при exhaustive ответе: отдельного no-trades
evidence здесь нет. Реальный flat bar с volume 0 является source, пропуск — нет.

Приоритет status:

1. `open`: bucket end позже asOf. Счётчики всё равно показывают gaps/unknown evidence.
2. `incomplete`: закрытый bucket имеет missing source minutes, partial coverage или forming bars.
3. `unknown`: закрытый bucket без перечисленных дефектов имеет unknown coverage/finality.
4. `complete`: закрыт, все expected минуты реально присутствуют, coverage exhaustive и все bars
   final.

Время само не повышает finality. Старый native cache без metadata должен передавать unknown, а не
придумывать final. Даже полный набор OHLCV без coverage не даёт complete.

## asOf, исправления и неизменность

Source start позже asOf отвергается; final minute с end позже asOf тоже отвергается. Текущая минута
может быть supplied forming/unknown snapshot, в том числе ровно в момент начала. Движок не умеет
восстановить прошлый snapshot из будущего: caller обязан предоставить causal snapshot и evidence на
asOf. Для проверки прошлого нельзя просто изменить asOf у массива с будущими минутами.

Входы не мутируются; frozen inputs допустимы. Результат, каждый bar и quality frozen. При одинаковых
входах результат одинаков. Tail append сохраняет закрытый prefix при неизменных policy/evidence;
коррекция старой минуты пересчитывает только зависящие OHLCV без накопления прежнего V. Движок не
хранит state, revisions, subscriptions или cache. Caller отвечает за замену snapshots, будущую
инвалидацию TA/MTP и provenance. Наличие timestamp не доказывает происхождение реальной котировки.

## Ошибки и локальные bounds

`DerivedMinuteError extends RangeError` имеет стабильный `code`: unsupported-source,
unsupported-target, unsupported-session, invalid-input, invalid-time, invalid-order, invalid-source,
outside-open-window, future-source, arithmetic-overflow, resource-limit. Валидация выполняется и при
пустых bars. Ошибочный request не возвращает частичный результат.

`DERIVED_MINUTE_LIMITS` — локальная защита работы, **не API max**: 250 000 bars, 10 000 sessions,
100 000 openWindows суммарно, 100 000 coverage spans и до 366 суток в одной session. Больший
диапазон можно разделять на явные sessions с осмысленными anchors. Timestamp arithmetic проверяется
на safe integer; чрезмерно удалённый anchor с небезопасной разностью отвергается.

Expected и coverage вычисляются пересечениями отсортированных ranges с binary search. Пустые
минуты/сутки/годы не перебираются. Bucket создаётся при первом реальном bar; память результата
ограничена числом source bars. Число минут target ограничено 180.

## Проверки и будущие gates

Source tests не выполняют build и не генерируют product quotes:

```text
node --test test/derived-interval-math.test.mjs
node test/helpers/derived-interval-source.mjs --typecheck
node node_modules/eslint/bin/eslint.js src/model/derived-intervals --max-warnings 0
node node_modules/prettier/bin/prettier.cjs --check src/model/derived-intervals test/derived-interval-math.test.mjs test/helpers/derived-interval-source.mjs docs/DERIVED_INTERVAL_MATH.md openspec/changes/derived-interval-math
node scripts/spec.mjs validate --all --strict
```

Helper сохраняет все tsconfig strict diagnostics и проверяет исходники напрямую; при отсутствии
generated app-version ровно один virtual compiler-host module экспортирует два string:
`APP_VERSION`, `BUILD_ID`. На диск generated/version/build файлы не пишутся; diagnostics не
фильтруются.

Ручные ledgers 4/7/45/180, 6/8/9 boundaries, день/год/session anchor, break/short bucket, forming,
unknown/missing coverage/finality, empty buckets, zero volume, strict errors/overflow, immutable
inputs, causal prefix, append/correction и локальные bounds покрыты unit fixtures.

Root integration отдельно требует: review source commit; подтверждённые provider/source/session
profiles; transport-only native IDs; metadata provenance и native cache revisions; snapshot
reconciliation и reconnect; approved portable/schema/Drive contract; оба chart engines, axis,
countdown, TA/MTP и visual/browser checks. Месяцы/кварталы, registry, UI, transport, persistent
cache, serializers, секреты, package/version/build и публикация этим коммитом не меняются.
