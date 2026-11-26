# Регистрация семи volume-flow TA

Source-only этап от frozen `.20` `220b2277f28f18d97bde1558d1b865609ebded5a`. Перенесены math commits
`58da04e379a064c6f3772167fcc9f84f1a48f994` и `b2594476283356faeef888024f148a4d44348540` (локальные
cherry-pick `f040a08` и `23289d4`). Reviewed `volume-flow/**` после переноса не меняется.

## Реестр и outputs

Прежние35 definitions сохранены в исходном порядке, новые семь добавлены в конец. Итого42 computed;
каталог127 entries, из них43 доступны с legacy Volume. Терминальная библиотека131 entry, из них47
доступны с четырьмя MTP. Это source registration; native/browser/production доступность этим этапом
не доказана.

| Definition ID      | Public ID                 | Default params                                                                      | Явные output keys             |
| ------------------ | ------------------------- | ----------------------------------------------------------------------------------- | ----------------------------- |
| cmf                | STD;Chaikin_Money_Flow    | length20                                                                            | value                         |
| chaikin-oscillator | STD;Chaikin_Oscillator    | fastLength3, slowLength10                                                           | value                         |
| efi                | STD;EFI                   | length13                                                                            | value                         |
| eom                | STD;EOM                   | length14, divisor10000                                                              | value                         |
| volume-oscillator  | STD;Volume%1Oscillator    | fastLength12, slowLength26, signalLength9, oscillatorAverage EMA, signalAverage EMA | oscillator, signal, histogram |
| nvi                | STD;Negative_Volume_Index | emaLength255                                                                        | index, average                |
| pvi                | STD;Positive_Volume_Index | emaLength255                                                                        | index, average                |

Bounds/defaults берутся из reviewed manifest: min1; CMF/Chaikin/EFI/EOM lengths max2000; PVO lengths
и NVI/PVI EMA max10000; divisor max1000000000. Bounds локальные, не выдаются за Pine maximums. Все
default panes отдельные. PVO Histogram сопоставлен по key явно; порядок public plot не используется
для угадывания рядов. Для NVI/PVI сохранены оба ряда, displayed seed1000 и EMA255.

## История и volume availability

Shared `TechnicalHistoryRequirement` включает reviewed `VolumeFlowHistoryRequirement` без
преобразования cumulative+EMA в простой recursive. Warmup и history делегируются math metadata.

- Chaikin/NVI/PVI — cumulative-plus-ema, full-input-dependent; собственные seed policies сохранены.
- CMF/EOM — valid-observation windows, `lookbackBars=null` при произвольных gaps.
- PVO all-SMA — window seed, finite valid-observation composition; любой EMA stage сохраняет
  full-input-dependent и first-non-null seed.

Только новые семь после общей валидации реальных OHLCV bars проверяют наличие хотя бы одного
`finite volume >0` во всём входе. Проверяется существование, не сумма, поэтому положительные
огромные объёмы не переполняют availability scan. Если вход пуст или содержит только0/null volume,
все11 series содержат null, timestamps и длины сохранены; результат получает optional
`unavailableReason: "volume-unavailable"`. Status остаётся computed. У available новых результатов и
всех прежних35 это поле отсутствует, включая own property со значением undefined.

NaN/Infinity/negative volume отвергаются общим runtime validator до gate. Один положительный volume
достаточен для availability даже при пропусках остальных баров. Дальше результат следует reviewed
math: нет дополнительной current-field mask, которая уничтожала бы EMA/SMA hold. Runtime не
заполняет входные котировки и не создаёт timestamps.

Gate относится ко всему текущему входу. До появления первого положительного volume префикс
недоступен; после его появления индикатор получает математическую историю с начала входа. Поэтому
availability префикса может измениться при расширении исключительно нулевой истории, как при
vendor-volume guard public source. Когда сравниваемые префиксы уже содержат положительный volume,
числовые ряды causal и prefix-stable; frozen input и irregular timestamps проверены.

## Параметры, UI и перенос

`ParameterDefinition` получил отдельный choice variant с exact readonly tuple `["EMA", "SMA"]`.
`isTechnicalIndicatorInstance` проверяет точное членство; null, missing, numeric и
неизвестные/неверного регистра строки отвергаются. Bounds и exact keys params/styles проверяются тем
же production validator до runtime. Вычислительные metadata/series/timestamps не становятся instance
fields.

`TechnicalIndicatorSettings` показывает source/choice как select, сохраняет оба строкой; numeric
controls сохраняют прежний Number conversion. RU/EN labels: divisor — «Делитель»/Divisor; emaLength
— «Период EMA»/EMA length; oscillatorAverage — «Тип средней осциллятора»/Oscillator MA type;
signalAverage — «Тип сигнальной средней»/Signal MA type. Invalid choice остаётся строкой и
отклоняется validator до записи; не превращается в numeric NaN или default.

Drive params allowlist расширен ровно четырьмя ключами: divisor, emaLength, oscillatorAverage,
signalAverage. В `sanitizeDriveBackup` добавлена проверка исходного technicalIndicators list до
projection. Иначе unknown params могли бы быть незаметно отброшены и превратиться в валидные
defaults. Остальные backup projections не меняются. JSON и Drive prepare/restore используют
production validators; null/unknown/extras/styles corruption отклоняются, custom
params/panes/order/visibility/styles сохраняются точно. Ни historyRequirement, ни unavailableReason
не сохраняются вместе с экземпляром.

## Проверки

Прошли95 focused source tests (включая16 frozen math tests),24 существующих Drive tests, TypeScript,
scoped ESLint/Prettier, strict OpenSpec44/44 и `git diff --check`.

Основной focused batch:

```powershell
node --test --experimental-test-isolation=none test/technical-volume-flow.test.mjs test/technical-volume-registry.test.mjs test/technical-volume-persistence.test.mjs test/technical-volume-settings.test.mjs test/technical-average-registry.test.mjs test/technical-momentum-volume-registry.test.mjs test/technical-volatility-registry.test.mjs test/technical-trend-registry.test.mjs test/technical-indicators.test.mjs test/technical-indicator-actions.test.mjs test/indicator-library.test.mjs
node --test --experimental-test-isolation=none test/drive-sync.test.mjs
pnpm.cmd typecheck
pnpm.cmd spec:validate
```

Старые non-native tests обновляют только counts42/43/47 и ограничивают проверку прежних шести trend
entries slice(29,35). Legacy35 compatibility дополнительно защищена pinned SHA256
`a790d945c7ac9ec5504a97ab3d6ac130a1f7539069c9bef98c6cfddc640cdcbc`: он получен напрямую из Git
source frozen220b227, включает все definitions, default instances и полные runtime results на
четырёх synthetic test inputs (empty,40 ordinary bars, entirely missing volume, sparse OHLCV). После
регистрации hash совпадает. Для expected новых результатов использованы отдельные ручные rational
ledgers, не вызовы pure math для генерации expected.

Source-only UI tests вызывают реальный `TechnicalIndicatorSettings`, production
`updateTechnicalIndicator` и instance validator с контролируемыми React hooks. Проверены оба языка,
точные options, сохранение SMA strings, отклонение invalid choices и прежние numeric/source
controls. Это не визуальная/browser проверка.

## Pending root review

- Независимое source review и согласование нового shared history union.
- Native renderer fixtures/tests, включая прежний pinned count35, output routing/styles и
  недоступный volume; здесь они не менялись.
- Browser/visual smoke и итоговый интеграционный cut. Build, серверы, browser, package/version, root
  receipt, исходные `.19`/`.20` worktrees, push/publish/merge/deploy не менялись.
- Ограничения Pine runtime/MTF/sparse ADL/binary64 reviewed math сохраняются: см.
  [TECHNICAL_VOLUME_FLOW.md](TECHNICAL_VOLUME_FLOW.md). Новая регистрация их не снимает.
