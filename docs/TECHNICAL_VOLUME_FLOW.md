# Объёмные индикаторы: source-only пакет

База: `c31004508e4ba6e396653cba1090ff27a4c83b1e`. Импорт:
`src/model/technical-indicators/volume-flow/index.ts`. Семь формул, 11 числовых рядов. Это
`math-only`: регистрация и доступность в интерфейсе не выполнены.

## Официальные источники

Проверено 2026-11-26: public Pine facade, `scriptAccess=open_no_auth`, `isBuiltIn=true`. Все семь ID
сверены с `catalog-data-part1.ts` / `catalog-data-part2.ts` этой базы. Ни пользовательские скрипты,
ни textbook defaults не использованы как источник built-in.

| Формула            | Public source (ссылка ведёт на изменяемый last)                                                                   | Версия | Числовые plots              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- | ------ | --------------------------- |
| CMF                | [STD;Chaikin_Money_Flow](https://pine-facade.tradingview.com/pine-facade/get/STD%3BChaikin_Money_Flow/last)       | 32.0   | CMF                         |
| Chaikin Oscillator | [STD;Chaikin_Oscillator](https://pine-facade.tradingview.com/pine-facade/get/STD%3BChaikin_Oscillator/last)       | 32.0   | Chaikin oscillator          |
| EFI                | [STD;EFI](https://pine-facade.tradingview.com/pine-facade/get/STD%3BEFI/last)                                     | 32.0   | Elder Force Index           |
| EOM                | [STD;EOM](https://pine-facade.tradingview.com/pine-facade/get/STD%3BEOM/last)                                     | 30.0   | EOM                         |
| PVO                | [STD;Volume%1Oscillator](https://pine-facade.tradingview.com/pine-facade/get/STD%3BVolume%251Oscillator/last)     | 33.0   | PVO, Signal line, Histogram |
| NVI                | [STD;Negative_Volume_Index](https://pine-facade.tradingview.com/pine-facade/get/STD%3BNegative_Volume_Index/last) | 4.0    | NVI, NVI-based EMA          |
| PVI                | [STD;Positive_Volume_Index](https://pine-facade.tradingview.com/pine-facade/get/STD%3BPositive_Volume_Index/last) | 4.0    | PVI, PVI-based EMA          |

Все retrieved sources обновлены 2026-09-29. SHA256 UTF-8 поля `source`:

```text
CMF     51a4a1b755c25ffa64dc46e0d82db9c459bb89b3fb37fc38d0847f66c4855c22
Chaikin 2faa935f0c5fd4cf47b170097f09bdda12f0f630e6aecfd13c9d4b3a11ece5ee
EFI     421ac38d0d9100398fbd8212d92d9e683873484e4034b30dcf90611dbdd79bb0
EOM     507610b416f3ebf1fa8707b9be867ff9b452a33878a484b8e0b0eb6af38da0bd
PVO     210ee697a01439ecb29e9761a02dd2ba68dd913a979b3542db4a57a2dd3c1994
NVI     9d716173394f7347a82da25dc41fbabf2ef99475ca0b39ace6c30ee3cd0638fd
PVI     846dff1468f1a49b3ba7a0d4ff7fe80ed5f21c5d1a9826a759a8c6e43b3b9b7a
```

Дополнительные первичные подтверждения:

- [CMF Help](https://www.tradingview.com/support/solutions/43000501974-chaikin-money-flow-cmf/) —
  отношение сумм потока и объёма; пример21 не является default20.
- [Chaikin Help](https://www.tradingview.com/support/solutions/43000501979-chaikin-oscillator/) —
  разность EMA от ADL.
- [EFI Help](https://www.tradingview.com/support/solutions/43000502259-elder-s-force-index-efi/) —
  изменение close × текущий volume и EMA13.
- [EOM Help](https://in.tradingview.com/support/solutions/43000502256-ease-of-movement-eom/) —
  midpoint change и SMA14. Иллюстративный divisor100000000 отличается от актуального default10000 в
  source.
- [PVO Help](https://www.tradingview.com/support/solutions/43000591350-percentage-volume-oscillator-pvo/)
  — три ряда и оба selectable MA type.
- [NVI Help](https://www.tradingview.com/support/solutions/43000773005-negative-volume-index-nvi/) и
  [PVI Help](https://in.tradingview.com/support/solutions/43000773006-positive-volume-index-pvi/) —
  отображаемый seed1000 и EMA255.
- [Pine reference](https://in.tradingview.com/pine-script-reference/v6/) — `ta.nvi`/`ta.pvi`
  используют внутренний seed1, zero-state reset и `nz`; `math.sum` пропускает na.
- [StudyOverrides](https://www.tradingview.com/charting-library-docs/latest/api/interfaces/Charting_Library.StudyOverrides/)
  — вспомогательное подтверждение bounds CMF/Chaikin/EFI/EOM. Его legacy Volume Oscillator5/10
  расходится с актуальным public Pine PVO33; здесь применён source33.

## API, параметры и outputs

Все integer bounds включительны, min1. Максимумы — локальные ресурсные ограничения, а не
утверждение, что public Pine требует те же максимумы. EMA/SMA берутся из reviewed `primitives.ts`;
ADL — из reviewed `momentum-volume/volume.ts`.

| ID / функция                             | Defaults и локальные max                                                                               | Результат                         | Required data            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------- | ------------------------ |
| cmf / `cmf`                              | length20, max2000                                                                                      | массив → manifest `value`         | high, low, close, volume |
| chaikin-oscillator / `chaikinOscillator` | fastLength3/slowLength10, max2000                                                                      | массив → `value`                  | high, low, close, volume |
| efi / `elderForceIndex`                  | length13, max2000                                                                                      | массив → `value`                  | close, volume            |
| eom / `easeOfMovement`                   | length14 max2000; divisor10000 max1000000000                                                           | массив → `value`                  | high, low, volume        |
| volume-oscillator / `volumeOscillator`   | fastLength12/slowLength26/signalLength9 max10000; oscillatorAverage/signalAverage = EMA, выбор EMA/SMA | `{oscillator, signal, histogram}` | volume                   |
| nvi / `negativeVolumeIndex`              | emaLength255, max10000                                                                                 | `{index, average}`                | close, volume            |
| pvi / `positiveVolumeIndex`              | emaLength255, max10000                                                                                 | `{index, average}`                | close, volume            |

Длины fast/slow не переставляются и могут совпадать либо иметь обратный порядок. Constant hline0,
цвета/precision и динамические цвета histogram не являются дополнительными числовыми рядами.

`volumeFlowPresets` deeply frozen. `volumeFlowMetadata(id, options)` проверяет параметры и
возвращает frozen warmup каждого выхода и собственный `VolumeFlowHistoryRequirement`. Он пока не
входит в shared types. Названия `value`, `index`, `average` — локальные output keys для последующего
согласования registry/native/Drive.

## Формулы

- CMF: flow = volume × ((close-low)-(high-close))/(high-low), нулевой range даёт flow0. Результат —
  сумма последних length известных flow / сумма последних length известных volume. Реализация
  использует отношение двух SMA, поскольку множитель length сокращается. Окна независимо пропускают
  na, как два вызова `math.sum`; их временные границы при пропусках могут различаться.
- Chaikin: EMA(fast, ADL) − EMA(slow, ADL). ADL накапливает известные flow от нулевого origin.
  Первая EMA seed — первый доступный ADL.
- EFI: EMA от `(close-current − close-previous) × volume-current`. Нужны соседние bar endpoints; не
  используется последнее известное close через пропуск.
- EOM: raw = divisor × изменение HL2 × текущий (high−low) / текущий volume; затем SMA(length). HL2
  считается как high/2+low/2 для предотвращения промежуточного сложения с overflow.
- PVO: oscillator =100×(MA(volume,fast)−MA(volume,slow))/MA(volume,slow);
  signal=MA(oscillator,signalLength); histogram=oscillator−signal. Оба выбора EMA/SMA независимы.
- NVI/PVI: внутренний state начинается с1. На active баре
  `state += state × (close−previousClose)/previousClose`, иначе hold. Active: volume строго меньше
  previousVolume для NVI, строго больше для PVI. Output index = state×1000, output average =
  EMA(index,emaLength). Равные volumes не меняют индекс.

## Пропуски, ошибки, overflow

Вход — readonly `TechnicalBar[]`. Каждая выходная серия имеет ровно ту же длину. Timestamps не
создаются и не сортируются; будущий runtime caller привязывает исходные реальные timestamps по тому
же индексу. Неплотные массивы, NaN/Infinity в используемых полях, отрицательный volume и high<low в
используемой паре отвергаются `RangeError`. Поля, которые формула не потребляет, не проверяются.
Никакие котировки не создаются.

`null` — na. Reviewed EMA сохраняет предыдущее значение на na source, SMA собирает length известных
наблюдений и затем сохраняет окно на na. Поэтому EFI/EOM/PVO могут выводить held smoothed значение
на баре с отсутствующим raw вкладом; это математика сглаживания, а не заполнение входной цены.
Первые length−1 валидных SMA наблюдений дают null. EMA seed — первое известное наблюдение,
alpha=2/(length+1), без SMA seed.

CMF нулевой знаменатель даёт null; high==low даёт flow0 даже при отсутствующем close/volume —
проверка range предшествует умножению в source. EOM при volume0 имеет raw null (включая 0/0 при
high==low); high==low с положительным volume даёт raw0. PVO при slowMA0 даёт oscillator/histogram
null, signal может сохранить предыдущее значение согласно выбранному MA.

Pine reference NVI/PVI явно задаёт особую политику: текущий или предыдущий close null/0 → hold;
текущий volume null → сравнение false; previous volume null →0 для сравнения. Предыдущий внутренний
state0 перед новым баром заменяется1. Это подтверждено reference, а не придуманный textbook seed.
Даже первый бар с отсутствующим close даёт числовой математический индекс1000; caller всё равно
обязан проверить наличие объёма у поставщика.

После overflow внутреннего NVI/PVI или displayed index оба ряда остаются null; выдуманный restart
после потери накопления запрещён. После непредставимого ADL Chaikin остаётся null; EMA-hold не
маскирует потерю накопления. При отсутствующем ADL вкладе reviewed ADL сохраняет только известную
сумму, а EMA следует na-hold — это локальное ограничение sparse parity.

Производные непредставимые EFI/EOM/CMF вклады переводятся в null до сглаживания. Обработка затем
следует na-skipping/hold; часть информации теряется. Reviewed EMA/SMA не являются arbitrary
precision: extreme cancellation, underflow, выход огромного значения из rolling окна и mixed-sign
near-limit values могут потерять точность или привести к null даже когда точный конечный результат
представим. Арифметические преобразования для устойчивости могут отличаться от порядка операций
Pine. Полная bitwise/Pine runtime parity не заявляется; реальное исполнение Pine и экспорт
TradingView golden здесь не запускались.

Все public sources содержат runtime guard отсутствующего объёма: сумма известных volumes0 вызывает
ошибку источника. Чистые функции отдельно возвращают математические ряды; runtime guard не
подменяется вымышленными volumes. Manifest содержит `requiresNonzeroVolumeHistory=true`. При
регистрации caller должен сделать результат недоступным для entirely missing/zero volume history до
отображения; NVI/PVI constant1000 не доказывает наличие рыночных данных. MTF и
wait-for-timeframe-closes не реализованы.

## История и warmup

Warmup — минимум баров без пропусков при невырожденных данных; гарантией finite output он не
является. Ни один допустимый набор параметров структурно не делает все outputs undefined, поэтому
`alwaysUndefined=false`. Отсутствие/нулевые объёмы могут оставить ряды null независимо от
параметров.

| Формула | Warmup                                                                                                       | History/convergence                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| CMF     | length                                                                                                       | два observation window; точность после length известных вкладов каждого окна             |
| EOM     | length+1                                                                                                     | length известных соседних изменений; точность после заполнения окна                      |
| EFI     | 2                                                                                                            | first-valid EMA; full-input-dependent                                                    |
| Chaikin | 1                                                                                                            | ADL zero-origin + две first-value EMA; full-input-dependent                              |
| PVO     | EMA oscillator:1; SMA oscillator:max(fast,slow); signal EMA: тот же минимум; signal SMA: плюс signalLength−1 | EMA в любой части требует полной истории; all-SMA — finite valid-observation composition |
| NVI/PVI | 1 для обоих outputs                                                                                          | cumulative seed1/display1000 + first-value EMA; full-input-dependent                     |

`lookbackBars=null` также для observation windows: при произвольном числе na фиксированного
positional lookback нет. `observations` содержит требуемое число валидных вкладов. Для all-SMA PVO
metadata отдельно показывает staged `outputWarmupBars`; `seedBars` означает минимальную непрерывную
историю для всех выходов, не EMA convergence.

Для EMA после m обновлений влияние различия seed умножается на `(1−alpha)^m`. Для полного совпадения
нужны одинаковые исходные данные и начало истории. NVI/PVI дополнительно сохраняют накопленную
масштабную зависимость от префикса. У Chaikin постоянный сдвиг ADL при согласованном сдвиге обеих
EMA сокращается, но обрезание входа меняет smoothing boundary и transient; конечный warmup не
доказывает convergence.

Все проходы O(N), память O(N + length), никаких look-ahead и оконных пересканирований.

## Независимые числовые ledger

Все synthetic fixtures находятся только в test. Golden ниже получены ручной рациональной
арифметикой, не вызовом implementation/другого TA package.

| Ledger             | Исходные промежуточные числа                                       | Ожидаемый итог                                                                                          |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| CMF2               | flow4,−6,0,5; volume4,6,8,10                                       | na,−1/5,−3/7,5/18                                                                                       |
| Chaikin2/3         | ADL4,−2,−2,3; EMA2=4,0,−4/3,14/9; EMA3=4,1,−1/2,5/4                | 0,−1,−5/6,11/36                                                                                         |
| EFI2               | close10,12,9,9,15; volume5,7,4,8,2; raw na,14,−12,0,12             | na,14,−10/3,−10/9,206/27                                                                                |
| EOM2 divisor10     | HL2=10,12,11,13; range4,4,4,6; volume10,20,10,15; raw na,4,−4,8    | na,na,0,2                                                                                               |
| PVO2/3 signal2 EMA | volume10,20,10,30; EMA2=10,50/3,110/9,650/27; EMA3=10,15,25/2,85/4 | oscillator0,100/9,−20/9,6100/459; signal0,200/27,80/81,37960/4131; histogram0,100/27,−260/81,16940/4131 |
| PVO1/2 signal2 SMA | volume10,20,10,30; SMA2 na,15,15,20                                | oscillator na,100/3,−100/3,50; signal na,na,0,25/3; histogram na,na,−100/3,125/3                        |
| NVI EMA2           | close10,12,9,18,9; volume10,20,10,10,5; index1000,1000,750,750,375 | average1000,1000,2500/3,7000/9,13750/27                                                                 |
| PVI EMA2           | те же close/volume; index1000,1200,1200,1200,1200                  | average1000,3400/3,10600/9,32200/27,97000/81                                                            |

## Проверки и последующая регистрация

Результат: 15/15 focused tests, typecheck, scoped ESLint/Prettier и `git diff --check` прошли;
strict OpenSpec — 41/41.

Команды выполняются из отдельного worktree с junction на canonical node_modules; version preparation
вызывается штатным typecheck. Source19 и integration root не изменялись.

```text
node --test --experimental-test-isolation=none test/technical-volume-flow.test.mjs
pnpm.cmd typecheck
pnpm.cmd exec eslint src/model/technical-indicators/volume-flow --max-warnings 0
pnpm.cmd exec prettier --check src/model/technical-indicators/volume-flow test/technical-volume-flow.test.mjs docs/TECHNICAL_VOLUME_FLOW.md openspec/changes/ta-volume-flow
pnpm.cmd spec:validate
```

Pending root review: shared history contract; registry/types/catalog registration; output
keys/styles и native adapters; instances/Drive validation keys; vendor-volume runtime gate; UI и
browser review. Build, серверы, браузер, реальные API/ключи, push, merge и deploy не выполнялись.
