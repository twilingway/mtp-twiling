# Trend-state: research checkpoint

Проверено 26.11.2026. Реализация ещё не начата: координатор временно освобождает slot для public PWA
QA. Scope остаётся math-only, без registry/UI/build/server/version/Drive/банка/публикации. База:
exact `ef2b63302dc36bf77fd0fe450407d37d2ff2dff2`, detached worktree
`D:\MySource\ReactJS\vps\artifacts\ta-trend-state-math`. `node_modules` — junction на canonical
repo. Прочитаны AGENTS.md, CODE_STYLE, repository OpenSpec workflow, config.yaml и
parallel-task-execution. Дополнительные агенты не создавались. Memory quick pass не нашёл
релевантной истории.

## Проверенные public sources

Все IDs найдены в catalog-data-part1/part3 исходной базы; TSI здесь **True Strength Index**, не
отдельный `STD;Trend%1Strength%1Index`. GET официального анонимного endpoint с
`scriptAccess=open_no_auth`. `last` изменяемый; hashes ниже относятся к реально прочитанному
`source` UTF-8 (SHA256), внешние исходники/bundles в Git не копировались.

| ID                                                                                                                            | Version | Source SHA256                                                      |
| ----------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------ |
| [STD;Supertrend](https://pine-facade.tradingview.com/pine-facade/get/STD%3BSupertrend/last)                                   | 12.0    | `0c4115d2b12d1a3eb07c12bbc44e9dd99eaded6019781a40115be066311c42e3` |
| [STD;PSAR](https://pine-facade.tradingview.com/pine-facade/get/STD%3BPSAR/last)                                               | 33.0    | `0b65333a9c928edf614ff55fb66654e0f66fa00a7fc57d7e2d590923df77350e` |
| [STD;DPO](https://pine-facade.tradingview.com/pine-facade/get/STD%3BDPO/last)                                                 | 32.0    | `e6ddefe64e45e5b2b2555e577730ce2a5b7dfec0398c8319160ae5b257512339` |
| [STD;True%1Strength%1Indicator](https://pine-facade.tradingview.com/pine-facade/get/STD%3BTrue%251Strength%251Indicator/last) | 31.0    | `d754f9a1362997e4bafbde8a520cb9361560c072ea5c67d312edfa43eba0b886` |
| [STD;Know_Sure_Thing](https://pine-facade.tradingview.com/pine-facade/get/STD%3BKnow_Sure_Thing/last)                         | 30.0    | `e6ebf18172d38f94f76c83162fd3fe49d0d183c5a195dd1da79cc59f8f193c56` |
| [STD;Fisher_Transform](https://pine-facade.tradingview.com/pine-facade/get/STD%3BFisher_Transform/last)                       | 32.0    | `83e99f94eb20e1e19c3ae2964748a5492638280e22581465d754b89d49819432` |

Все scripts Pine v6, updated 2026-09-29. Response SHA256 соответственно:
`cfd21672da3c693c89a82ed4b553b9b323a7a46a78ef784871c85a3e92441862`,
`1521df4355cf3be1905e71fd430bf5a59ef3883c1d3a6a43b8083d02b0ff7c93`,
`cbfd94096b944baa03ddeee3693db9bc3efe548e210a09f91c7e4ab09f54cd87`,
`c0fabbbea492603d6e8c7ddd8d401548822af7b60cc2f998e279ef4ae2072212`,
`7ce56f2ffd3526210a91da8164b7c20ae66f6ef278382b0232e3c8c965ebd80d`,
`ce9f4233cc8f909e9af1d5b67df74f5eaef5cfba34eb49b19d929d7be138cd87`.

Официальный [Pine Reference v6](https://www.tradingview.com/pine-script-reference/v6/#fun_ta.sar)
динамический: web reader показал только shell. Публичный
[function payload](https://www.tradingview.com/static/bundles/11967.f052e1615089996eccf6.js)
прочитан только узкими фрагментами `pine_sar` и `pine_supertrend`; payload SHA256
`681492fc92bba4f2ec3dfb2435a2c6675a7f84df9a5fc41e3fd113eacdd9f2f8`. Полный bundle не сохранялся. Его
примеры подтверждают SAR seed/reversal/AF clamp и Supertrend nz previous bands (описано ниже). Pine
execution не выполнялось, runtime parity не заявляется.

Дополнительные первичные страницы:
[Supertrend Help](https://www.tradingview.com/support/solutions/43000634738-supertrend/),
[DPO Help](https://www.tradingview.com/support/solutions/43000502246-detrended-price-oscillator-dpo/),
[TSI Help](https://www.tradingview.com/support/solutions/43000592290-true-strength-index/),
[KST Help](https://www.tradingview.com/support/solutions/43000502329-know-sure-thing-kst/),
[Fisher Help](https://www.tradingview.com/support/solutions/43000589141-fisher-transform/). Help
недостаточен для cold/gap semantics; builtin source первичнее для actual defaults/outputs.

## План typed pure API

Каждый вход `readonly TechnicalBar[]`; каждый NumericSeries длины bars с индексом исходного
timestamp. Никаких fake bars, мутации/создания timestamps. Metadata отдельная, frozen, status
math-only. Общие types/primitives не менять; использовать только после проверки seed/null
совпадения.

- `supertrend(bars, atrLength=10, factor=3)` →
  `{ value, direction, upTrend, downTrend, bodyMiddle }`. Factor min .01; period min1. `bodyMiddle`
  численный hidden plot, нужен либо включённым выходом, либо явным omittedNumericOutputs. up/down
  split нужен для line-break. Direction convention −1 up, +1 down.
- `parabolicSar(bars,start=.02,increment=.02,maximum=.2)` → NumericSeries. У builtin inputs нет
  явных min/max; локальные строгие bounds должны быть честно указаны отдельно.
- `dpo(bars,length=21,centered=false)` → `{ value, plotOffsetBars, requiresFutureAtDisplay }`.
  `value` привязан к вычисляющему бару. Centered требует явного negative display offset, никогда не
  выдавать будущие значения под более ранними causal timestamps.
- `tsi(bars,longLength=25,shortLength=13,signalLength=13)` → `{ value, signal }`, source только
  close. Двойной EMA price change / двойной EMA abs(change), ×100; signal EMA. Это именно builtin
  ×100, не raw `ta.tsi` scale.
- `kst(bars,options)` → `{ value, signal }`; ROC lengths [10,15,20,30], SMA lengths [10,10,10,15],
  signal9. Weighted SMA(ROC) с весами1,2,3,4; signal SMA. Source только close.
- `fisherTransform(bars,length=9)` → `{ value, trigger }`. Source hl2, extrema hl2; trigger
  предыдущий Fisher (не SMA, несмотря на упрощённый Help текст).

## Подтверждённая state math и спорные границы

Supertrend: ATR Wilder с true-range high−low fallback; raw bands hl2±factor×ATR; trailing band
обновляется при strict comparison или crossing previous close. Пока previous ATR неизвестен
direction=+1. Reference использует `nz(previousBand)` (первоначально 0) — это **явная формула
state**, её нельзя путать с подменой неизвестных входных свечей нулём. Builtin дополнительно
скрывает value и bodyMiddle на первом баре. Нужны ручные ledgers для first ATR, length1, negative
prices, strict equality/reversal и overflow.

SAR: reference seed на bar index1: close>previous close → below, EP=current high, SAR=previous low;
иначе above, EP=current low, SAR=previous high. Затем сразу projection SAR+AF×(EP−SAR), strict
SAR>low / SAR<high reversal; reversal SAR=max(high,EP) или min(low,EP), EP=current opposite extreme,
AF=start. На first trend bar AF не наращивается. Иначе при новом strict EP
AF=min(AF+increment,maximum). Финальный clamp — previous low/high, а начиная index2 также two-back.
Seed start не clamp к max до первого EP update. Требуется явная conservative sparse/gap политика;
reference не доказывает Pine gap execution.

**DPO material question ещё открыт:** source `barsback=period_/2+1` в Pine v6; default length21
нечётный. Нужно первичное подтверждение conversion для history index/plot offset, прежде чем
выбирать floor/trunc или иное правило. Centered формула `close[barsback]−SMA(close,length)` и
negative plot offset; нецентрированная **другая** формула `close−SMA(close,length)[barsback]`.
Простое перемещение одинакового ряда неправильно. При display timestamp t центрованный output
требует вычисляющий бар t+barsback, это presentation future boundary, а не causal signal. Если
conversion неразрешим, сообщить координатору и реализовать другие пять.

Fisher: normalization `.66×((hl2−lowest)/(highest−lowest)−.5)+.67×nz(previous normalized)`. Clamp
строго >.99→.999, <−.99→−.999. Fisher `.5×ln((1+x)/(1−x))+.5×nz(previous Fisher)`. Flat H=L window
denominator0 → undefined, не x=0. Partial extrema windows ожидаются как ta.highest/lowest; нужно
отдельно документировать gap behavior и проверять reference na rules. Explicit nz recursive state
соответствует source, неизвестную цену нулём не заменять.

Периоды локально1..10000; resource cap O(N) algorithms. Consumed fields null допустимы,
undefined/NaN/Infinity/sparse arrays reject; malformed H/L reject. Overflow → null с явным state
policy. KST finite dense lookback=max(roc+sma)+signal−1; TSI/SAR/Supertrend/Fisher
full-input-dependent. Dense warmup минимальный, не convergence padding. Для Fisher cold first flat
hl2 range требует нетривиальной defined output границы; не обещать unconditional length warmup.
Нужны frozen/prefix-causality/timestamps, gap/flat/zero denom, numeric overflow и hand-ledger тесты.

## Следующее продолжение

Создать proposal/design/spec/tasks через актуальные
`node scripts/spec.mjs instructions ... --change ta-trend-state`. `spec list` уже прочитан;
canonical specs содержит только drawing-editing. Контракт нового math package — новая capability.
Запрошенный scope: только `src/model/technical-indicators/trend-state/*`,
`test/technical-trend-state.test.mjs` (own helpers при необходимости),
`docs/TECHNICAL_TREND_STATE.md`, `openspec/changes/ta-trend-state/*`. Новые production modules ≤500
nonempty lines. Проверки focused source-only Node tests, direct tsc --noEmit, scoped
eslint/prettier, strict spec; без prepare-version/build/browser. Фиксировать source commit и clean
worktree, registration gates отдельно.
