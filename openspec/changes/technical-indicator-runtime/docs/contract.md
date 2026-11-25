# Контракт чистого ядра

Импорт: `src/model/technical-indicators/index.ts`. Основа worktree: `ffc41fe`, без UI/native/MTP,
изменений старых flags/backup/controller и без новых зависимостей.

## Определения и экземпляры

`technicalIndicatorDefinitions` — семь immutable data-only определений: `sma`, `ema`, `rsi`, `macd`,
`bollinger-bands`, `atr`, `stochastic`. Они содержат schemaVersion1, id/title/shortTitle, status,
defaultPane, parameters (тип/default/min/max), outputs (id/title/kind/color), levels и references. В
metadata нет callback или сериализованного Pine/JS.

| definitionId    | Параметры по умолчанию                                  | Серии                   | Pane    |
| --------------- | ------------------------------------------------------- | ----------------------- | ------- |
| sma             | length20, source close                                  | value                   | overlay |
| ema             | length20, source close                                  | value                   | overlay |
| rsi             | length14, source close                                  | value                   | pane    |
| macd            | fastLength12, slowLength26, signalLength9, source close | macd, signal, histogram | pane    |
| bollinger-bands | length20, multiplier2, source close                     | basis, upper, lower     | overlay |
| atr             | length14                                                | value                   | pane    |
| stochastic      | length14, smoothK3, smoothD3                            | k, d                    | pane    |

Stochastic 14/3/3 выбран по заданию; публичный built-in Stochastic v33.0 имеет smoothK1 по
умолчанию. Это намеренно заданный preset, а не обещание совпадения всех defaults платформы.

Экземпляр JSON:

```json
{
  "schemaVersion": 1,
  "id": "rsi-fast",
  "definitionId": "rsi",
  "params": { "length": 7, "source": "close" },
  "pane": { "kind": "pane", "id": "rsi-fast" },
  "visible": true,
  "order": 0,
  "styles": { "value": { "color": "#7e57c2", "width": 1, "visible": true } }
}
```

`createTechnicalIndicatorInstance(definitionId,id,options?)` подставляет defaults, проверяет
параметры и возвращает независимую копию. У overlay определений default pane — `{kind:"overlay"}`; у
остальных — `{kind:"pane",id:instance.id}`. Явный pane ID может объединять несколько экземпляров;
сама привязка к native pane относится к следующей интеграции.

`isTechnicalIndicatorInstance`/`isTechnicalIndicatorInstanceList` — строгая проверка данных.
Допускаются только известные параметры/outputs, period integer1..10000, multiplier0..100,
source=open/high/low/close/hl2/hlc3/ohlc4/volume. order integer0..10000, ID не длиннее100 символов,
цвет #RRGGBB, width1..4. Список максимум100 экземпляров с уникальными ID. Неизвестные поля,
prototype/accessor objects, NaN/Infinity и функции отклоняются; getters при проверке не вызываются.

`unsupportedTechnicalIndicatorDefinitions` отдельно содержит честный пример Advance/Decline Line:
требуются market-breadth данные. `getTechnicalIndicatorDefinition` возвращает computed/unsupported
либо null. Недоступный ID нельзя выполнить или создать как успешную пустую серию. Никакие 224 пункта
автоматически не объявляются реализованными; фундаментальные/community разделы не вводятся.

## Вход и выход

```ts
type NumericValue = number | null;
interface TechnicalBar {
  readonly timestamp: number;
  readonly open: NumericValue;
  readonly high: NumericValue;
  readonly low: NumericValue;
  readonly close: NumericValue;
  readonly volume: NumericValue;
}
```

Обычные реальные Candle проекта структурно совместимы. Nullable поля означают явное отсутствие
значения. Timestamps должны быть конечными, неотрицательными, строго возрастающими. Дубликаты и
невалидные OHLCV отклоняются; merge/reorder исходников остаются обязанностью source слоя.

`calculateTechnicalIndicator(instance,bars)` проверяет instance и вход, затем возвращает:

```ts
{
  instanceId: string;
  definitionId: TechnicalIndicatorId;
  status: "computed";
  timestamps: readonly number[];
  series: Readonly<Record<string, readonly (number | null)[]>>;
  warmupBars: number;
  historyRequirement: TechnicalHistoryRequirement;
}
```

Все серии имеют длину bars. Выход не содержит NaN/Infinity, не создаёт timestamp и не мутирует
источник/экземпляр. Индикатор рассчитывается и при visible=false: видимость и styles применяет
будущий renderer. Исправленный последний или исторический бар требует повторного pure расчёта;
скрытого singleton state нет.

## Seed, gaps и прогрев

- SMA берёт последние length ненулевых в смысле na наблюдений: числовой 0 является обычным
  наблюдением, null пропускается. EMA стартует с первого non-null, alpha=2/(length+1). Wilder RMA
  стартует средним первых length non-null, alpha=1/length. После seed null не обновляет state.
- Primitive MA на null возвращает прежнее рассчитанное значение. Runtime дополнительно маскирует
  строку с отсутствующим необходимым source null, чтобы renderer показывал gap. Это явный контракт
  нашего renderer-facing слоя, не заявление о полном Pine plotting parity на sparse данных.
- RSI сравнивает соседние позиции исходной серии, как опубликованный builtin change(source). Пропуск
  исключает обе соседние разности; изменение между last-valid по разные стороны gap не выдумывается.
  RMA игнорирует null изменений. После seed down==0 даёт100, затем up==0 даёт0; полностью плоский
  RSI поэтому100.
- ATR true range при отсутствующем предыдущем close использует high-low, затем RMA. Пропуск самой
  строки не заменяется нулевым true range.
- MACD — разность двух first-seeded EMA; signal — EMA этой разности; histogram=macd-signal.
- BB — SMA±multiplier×populationDeviation с делителем N. Используется rolling central moment, без
  вычитания огромных price² сумм.
- Stochastic extrema смотрят последние length позиций бара и игнорируют na внутри этого окна. Они не
  растягивают окно на length non-null свечей. Raw %K при нулевом диапазоне null, затем используются
  две SMA. До полного length окна возможны значения на уже доступной истории, поскольку
  отсутствующая предыстория не является нулевыми high/low.

`warmupBars` — минимальное возможное число наблюдений для всех выходов, без gaps/вырожденности:
SMA/BB=length, RSI=length+1, ATR=length, EMA/MACD=1, Stoch=smoothK+smoothD−1. Он не является
обещанием сходимости или достаточной глубиной загрузки. Для полностью заполненного Stoch lookback
нужны length+smoothK+smoothD−2 исходных позиций. EMA/RMA/MACD/RSI зависят от всей предоставленной
seed истории; обрезка до одного period меняет значения. Native/history интеграция должна согласовать
прогрев и baseline входа, а не использовать minimum1 как достаточную историю EMA.

Отдельное сериализуемое `historyRequirement` и экспорт `technicalIndicatorHistoryRequirement`
предназначены loader/native workers. Для SMA/BB:
`{kind:"finite",lookbackBars:length, seedPolicy:"window",convergence:"exact-after-lookback"}`. Для
Stoch lookbackBars=length+smoothK+ smoothD−2, то есть18 по умолчанию. При na/gaps нужно проверять
реальную достаточность валидных наблюдений, а не слепо ограничить fetch восемнадцатью timestamp.

Для рекурсивных серий:
`{kind:"recursive",lookbackBars:null,seedBars,seedPolicy, convergence:"full-input-dependent"}`. EMA:
first-non-null/1, MACD: first-value-ema-chain/1, RSI: adjacent-change-wilder/length+1, ATR:
true-range-wilder/length. Для общей RMA есть отдельный `rmaHistoryRequirement(length)` с
seedPolicy=sma-of-first-length и seedBars=length. Никакое конечное padding не обещает точного
равенства рекурсивной серии, рассчитанной от другого начала истории. calculate всегда использует
весь поданный bars, независимо от minimum/lookback metadata.

Календарные перерывы без явной null строки не добавляют na: вычисления идут по реальным барам, а не
по вымышленным минутам между timestamp.

## Проверки и границы

`test/technical-indicators.test.mjs` использует ручные рациональные векторы RSI/MACD/ATR/Stoch и
замкнутую population variance последовательности1..20; expected не извлекаются из implementation.
Также проверены defaults, flat/zero loss, na, frozen input, исправления, несколько экземпляров,
roundtrip и запрет исполняемых/неизвестных полей. UI/движки и живой Pine execution не запускались.
