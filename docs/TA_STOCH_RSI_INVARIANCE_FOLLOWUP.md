# Stoch RSI canonical ratio — P2 follow-up

Base `a906f02d28bd2ea2eaed08d0f5892afcc3d14b78`; WT `artifacts/relative-oscillators-invariance`,
branch `fix/relative-oscillators-invariance`. Исходный PURE5 WT и
`artifacts/relative-oscillators-readonly-*` прочитаны, не изменены. Меняется только Stoch RSI нового
math-only пакета. Остальные четыре kernels, их defaults/outputs/ metadata, shared/legacy
RSI/stochastic, registry/UI/native/Drive/version/persistence не меняются.
Build/browser/agents/network не запускались.

## Причина и изменение

При zero-change и RSI length>1 обе RMA умножаются на одинаковый коэффициент. Пакет уже сохранял
аналитически неизменное RSI. При следующем missing adjacent change RMA не менялись, но повторное
деление самостоятельно округлённых states отличалось от опубликованного RSI на1ulp. Разница
становилась новым min/max маленького stochastic окна и могла дать полноценный0/100. Это
implementation P2 заявленной **локальной** invariance, не спор о Pine startup.

Теперь missing change переносит canonical `previousRsi` до вызовов RMA. Пропущенная observation не
меняет states и не пересчитывает опубликованный ratio. Известный zero-change обновляет обе RMA: при
L>1 сохраняется ratio, при L1 обе становятся0 и0/0 остаётсяnull. Ненулевой change вычисляется как
раньше. Denominator/extrema не меняются; epsilon, threshold и blanket0/50 fallback отсутствуют.

Ledger `[0,-4,-4,-3,-3,null]`, RSI3/Stoch2/K1/D1:−4,0,+1 дают seed gain1/3, loss4/3, RSI20;
zero-change даёт2/9 и8/9, RSI20; missing-change переносит20. Последнее окно `[20,20]` имеет
denominator0: все K/D равныnull. До fix последний K/D был0.

## Frozen evidence

`test/fixtures/relative-invariance/manifest.json` фиксирует SHA256 exact-byte копий original full
trial47, original minimized/six-bar vectors, independent review probes, six-bar regression и
evidence JSON. Копии не форматируются; локальный `.gitattributes` отключает их text normalization.
Для exact CRLF reviewer probe задан `cr-at-eol` вместе с обычными blank-at-eol/blank-at-eof/
space-before-tab checks: исходные bytes сохраняются, whitespace проверки не отключаются. Original
six-bar JSON содержит `[0,-8,-8,-6,-6,null]`, executable ledger — `[0,-4,-4,-3,-3,null]`: оба
проверяются отдельно без подмены исходного vector.

Full trial113 отдельно воспроизведён неизменённым reviewer generator (seed0x35ab10) на frozen a906
API и сохранён как **replayed-frozen-trial113.json**, не как перезаписанный original artifact.

- original-trial47 SHA `17d79c1b669dcc87ab8c9185d7b09e7d04b426f450f9e912a02fb19dbe834b9d`.
- original-six-bar SHA `c2489e09e23294fabb5f286a893f58fe45be3bda794d9981fb50a618b9e9de87`.
- unchanged probes SHA `cc7a1d4badbe772f077c35dc6aa7fa5b445612bd72f816baf2087b9c916cfb49`.
- replayed frozen113 SHA `913ffb7a016cb8cb307c875edf02cd6774c8b50f2da9a8c55d526072962188c7`.

## Before / after

Новые8 targeted tests: до fix1 PASS/7 FAIL, после8/8 PASS. Trial47 K29 теперь22.462116593784884
вместо0; trial113 K12 теперьnull вместо66.66666666666666. Frozen actual/expected не переписываются.

Replay исполняет exact сохранённый independent oracle/generator. Адаптация — только I/O URLs,
metadata target/hash и capture полных trial47/113; численные definitions, seed,200 fixtures и
tolerance3e−11 неизменны. Frozen baseline2198/2200 match, ровно прежние trial47/113 mismatch;
candidate **2200/2200 match, failures=[]**, все6 groups PASS. Rational expected не вызывает
production helpers. Author ordinary oracle также уточнён на NA carry; он не единственное evidence.

```text
node test/technical-relative-invariance.test.mjs
node test/helpers/relative-invariance-review-replay.mjs --baseline
node test/helpers/relative-invariance-review-replay.mjs
```

`--baseline` читает соседний frozen WT `relative-oscillators-math`; exit1 ожидаем и отражает два
frozen mismatch. Replay пишет только в собственный ignored `artifacts/stoch-invariance-replay/`:
`evidence-before.json`, `evidence-after.json`, полные
`trial-47-before.json`/`trial-113-before.json`. Targeted test поддерживает
`RELATIVE_INVARIANCE_LOADER_PATH` для frozen loader. Original evidence и frozen source не
изменяются.

Targeted coverage: long zero/NA runs, L1 zero reset, nonzero recovery,60 seeded exact-rational
stress fixtures с asymmetric smoothing, все8 source choices, prefix/correction и frozen inputs.
MAX/4, MIN_VALUE и2^±900 сохраняют invariance без epsilon. Исходные numeric27/core15/channel88/
boundary1 проверяются отдельно; старый witness сравнивает340 файлов/70 indicator files с
`f889aebb14b9b330913a73595aed11c39b7e5fcd`.

## Границы

Финальные проверки: numeric27+core15+channel88+boundary1+targeted8 =139 PASS; независимый replay
2200/2200 PASS. Whole-source strict host (только virtual absent app-version с двумя строковыми
exports), scoped ESLint/Prettier и OpenSpec57/57 PASS. Read-only Git witness выполнен unsandboxed
из-за известного managed spawnSync restriction:340 старых файлов/70 indicator files unchanged. Шесть
исходных reviewer artifacts повторно сверены с SHA manifest, original frozen WT clean.

Прежние Pine execution startup/NA/seed/float parity, realtime/MTF, native/offset carrier,
registry/UI/persistence gates остаются открыты. Primary defaults/SHA не менялись и не скачивались
повторно. P2 исправляет локальный контракт, не объявляет PURE5 feature ready; требуется независимое
повторное review.
