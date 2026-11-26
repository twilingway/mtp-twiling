# Регистрация TSI/KST/Fisher: source cut

Exact base `5d569c394ee3d8730af12c665aa956f290b3245e` (.21 frozen42). Reviewed math commit
`49bfcf77c9a5200f8bcaf6d70735bd167c500b5f` cherry-picked как `44c1eb4`; файлы `trend-state/*` после
cherry-pick не менялись.
[Первичные источники, versions/source SHA256 и границы формул](TECHNICAL_TREND_STATE.md)
сохраняются. Pine runtime execution/parity не заявляется.

Registry append-only: **45 computed**, **46 available TA** (включая Volume), **50 available library
entries** (ещё4 existing MTP scripts). Новые definitions идут строго после прежних42. Source library
rendering проверен через настоящий TerminalIndicatorLibrary function, без браузера. Supertrend/SAR
остаются math-only/unavailable, DPO unresolved/unavailable. Другой `STD;Trend%1Strength%1Index` не
подменяется TSI.

## Instances и outputs

| ID / public ID                              | Persisted defaults                                                                                                                       | Outputs          | Pane  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----- |
| `tsi` / `STD;True%1Strength%1Indicator`     | `longLength=25, shortLength=13, signalLength=13`                                                                                         | `value, signal`  | lower |
| `kst` / `STD;Know_Sure_Thing`               | `roc1Length=10, roc2Length=15, roc3Length=20, roc4Length=30, sma1Length=10, sma2Length=10, sma3Length=10, sma4Length=15, signalLength=9` | `value, signal`  | lower |
| `fisher-transform` / `STD;Fisher_Transform` | `length=9`                                                                                                                               | `value, trigger` | lower |

Все numeric inputs scalar integer1..10000. KST arrays создаются только внутри runtime bridge при
вызове pure math, в persisted schema их нет. Все6 outputs — обычные line plots: primary
blue/secondary orange, без нового renderer. Fisher levels −1.5/−.75/0/.75/1.5, TSI/KST level0.

Existing instance validator уже проверяет exact params/keys, defaults/bounds, output style keys и
optional style fields; `instances.ts` не менялся. Root runtime сначала валидирует instance и shared
real-bar input (включая increasing timestamps), затем early-dispatch вызывает reviewed math.
Дополнительного HLC mask поверх TSI/KST/Fisher нет: это сохраняет pure gap/overflow policy и
известный предыдущий Fisher trigger на текущем gap. Volume не становится обязательным и
`unavailableReason` новым3 не добавляется. Реальные свечи продукта не заменялись; synthetic fixtures
существуют только в tests.

## Literal history contract

Общий `TechnicalHistoryRequirement` расширен новым узким `StateOscillatorHistoryRequirement`. Старый
recursive shape выделен в `LegacyRecursiveHistoryRequirement` **без изменения literals/seedBars**.
Старый runtime factory принимает только старый seedPolicy union. Нет arbitrary string, type cast или
ослабления strict для новых history.

| ID         | Warmup                                      | History                                                                                                                                     |
| ---------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| TSI        | 2 minimum, nonzero change denominator       | `recursive`, `lookbackBars=null`, `seedBars=2`, `seedPolicy=first-known-ema-chain`, `convergence=full-input-dependent`                      |
| KST        | value=max(roc+sma), default45               | `finite`, lookback=max(roc+sma)+signal−1 (default53), `seedPolicy=known-observation-window`, `convergence=exact-after-dense-lookback`       |
| Fisher n>1 | value minimum2                              | `recursive`, `lookbackBars=null`, `seedBars=2`, `seedPolicy=partial-extrema-explicit-previous-state-nz`, `convergence=full-input-dependent` |
| Fisher n=1 | `warmupBars=null`, all numeric outputs null | тот же recursive contract, **`seedBars=null`**, result-only `alwaysUndefined=true`                                                          |

Нормализатор читает reviewed metadata, проверяет kind/seedPolicy/convergence/seed и возвращает
точные literal objects. Fisher1 не получает seed1 или finite lookback. Warmup — minimum, не обещание
сходимости; flat/unknown denominator может отложить finite output неограниченно. KST finite lookback
относится к dense history: na-skipping observation windows на sparse могут требовать более старые
timestamps. Эти ограничения не менялись относительно pure49.

## Настройки и persistence

В actual TechnicalIndicatorSettings добавлены human RU/EN labels длинного/короткого периода, четырёх
ROC и четырёх SMA. Signal/length используют прежние labels. Inputs сохраняют numeric min/max/step1.
Тесты вызывают реальные onChange/onSubmit и реальную updateTechnicalIndicator/root validator с
in-memory controller; проверяют все3, оба языка, все9 KST inputs, invalid rejection без default
fallback и Fisher1 save. Это source UI behavior, не visual/browser QA.

Drive allowlist расширен **ровно10** scalar keys:
`longLength shortLength roc1Length roc2Length roc3Length roc4Length sma1Length sma2Length sma3Length sma4Length`.
Existing `signalLength`/`length` уже были. JSON/Drive schemaVersion не менялась. Production
sanitize/prepare/restore проверены offline in-memory, внешние аккаунты/Google не вызывались.

Raw instances валидируются до allowlist projection: null/arrays/unknown/extra params/styles и
runtime metadata отклоняются, не отбрасываются молча. У всех3 custom roundtrip сохраняет flat
params, pane/order/visibility и оба output styles; численные результаты до/после равны. Fisher1
metadata заново вычисляется после restore; warmup/history/alwaysUndefined/series/timestamps в
instance не сохраняются.

## Независимый frozen42 witness

До registry edits baseline source читался через read-only
`git show 5d569c394ee3d8730af12c665aa956f290b3245e:src/<relative>` в независимый source loader.
Witness включает42 definitions в прежнем порядке,42 default instances с order,42 history contracts и
результаты на4 cases: empty;64 ordinary synthetic HLCV; те же без volume; те же с каждым пятым gap.
Irregular исходные timestamps сохраняются. Witness сериализован JSON в фиксированном порядке полей и
SHA256:

`610fd4c860f6ccc49bc80c7f1f29651a5983d75ce2630ff565f5ed81823afc0a`

Новый `technical-state-oscillator-fixture.mjs` воспроизводит этот witness только для прежних42 и
проверяет фиксированный независимый hash. После регистрации hash совпал:
defaults/order/results/result-key shapes/history прежних42 сохранены. Исходный frozen hash не был
получен из изменённого registry. Initial sandbox `spawnSync git EPERM` снят read-only повтором с
escalation; credentials/секреты не читались.

## Source-only проверки

- `node test/technical-state-oscillator-registry.test.mjs`:7 PASS — frozen42,45/46 counts, exact
  IDs/deferred states, независимые TSI rational/KST weighted percent/Fisher log ledgers, nullable
  history/Fisher1, gaps/prefix/timestamps/no fake0/overflow, strict params/styles.
- `node test/technical-state-oscillator-persistence.test.mjs`:4 PASS — production JSON/Drive all3
  custom roundtrip, Fisher1 metadata exclusion, raw corruption rejection/restore и exact10 allowlist
  keys.
- `node test/technical-state-oscillator-settings.test.mjs`:4 PASS — human RU/EN fields, actual
  submit/save/root validator, invalid save rejection, Fisher1 и actual50-entry library source.
- Reviewed math tests остаются19 PASS; pure49 folder diff пуст.
- Full source compiler host (`node test/technical-trend-state-typecheck.mjs`) PASS: исходный strict
  tsconfig/noEmit, весь реальный src, ровно один виртуальный module app-version.ts с двумя string
  exports APP_VERSION/BUILD_ID. Нет diagnostics filtering. Plain tsc без generated имеет baseline
  missing-module limit; prepare-version не запускался, generated не записывался.
- Scoped ESLint/Prettier PASS. Strict OpenSpec all46/46 PASS.

Прежние .21 acceptance tests с жёсткими **общими** counts42/43 и native fixtures не переписывались в
этом source scope; root должен актуализировать totals для нового45/46/50 cut. Их historical numeric
contract дополнительно сохранён frozen42 witness. Полный build/full test suite/browser PASS этим
документом не заявляется.

## Root gates

Независимый review exact source commit; обновление root/native acceptance counts; обе chart engines
с двумя lines, styles/pane settings, gaps/flat/Fisher1 и persistence reload; последующий
version/build/browser/public PWA gate — отдельно у координатора. Package/version/native
fixtures/root receipts, Drive accounts, build/server/browser/push/merge/deploy в этой ветке не
менялись. .20/.21 frozen worktrees сохранены.
