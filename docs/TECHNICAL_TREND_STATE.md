# State/trend: самостоятельная математика

База `ef2b63302dc36bf77fd0fe450407d37d2ff2dff2`, source .20. Добавлены пять pure вычислений:
Supertrend, Parabolic SAR, True Strength Index, Know Sure Thing, Fisher Transform. Шестой
исследованный индикатор DPO явно **unresolved**: default21 требует недоказанного conversion дробного
Pine offset. Никакой DPO функции или готового preset нет.

Статус пакета `math-only`. Registry/catalog/types/runtime, native/UI, Drive, версии и assets не
менялись. Pine execution, браузерная проверка и Pine runtime parity не выполнялись. Первичные
формулы реализованы самостоятельно; внешние Pine исходники и bundles не скопированы в Git.

## API и вход

Экспорт из `src/model/technical-indicators/trend-state/index.ts`:

```ts
supertrend(bars: readonly TechnicalBar[], atrLength = 10, factor = 3): {
  value: NumericValue[]; direction: NumericValue[];
  upTrend: NumericValue[]; downTrend: NumericValue[]; bodyMiddle: NumericValue[];
};
parabolicSar(bars: readonly TechnicalBar[], start = .02, increment = .02, maximum = .2): NumericValue[];
tsi(bars: readonly TechnicalBar[], longLength = 25, shortLength = 13, signalLength = 13): {
  value: NumericValue[]; signal: NumericValue[];
};
kst(bars: readonly TechnicalBar[], options?: KstOptions): {
  value: NumericValue[]; signal: NumericValue[];
};
fisherTransform(bars: readonly TechnicalBar[], length = 9): {
  value: NumericValue[]; trigger: NumericValue[];
};
```

KstOptions: `rocLengths` tuple `[10,15,20,30]`, `smaLengths` tuple `[10,10,10,15]`,
`signalLength=9`. Параметры optional, входные tuples readonly, unknown keys/неверные размеры
отклоняются. Явный null не является отсутствующим численным параметром.

Все series длины bars, index соответствует исходному бару. Вход, параметры и timestamps не
изменяются; timestamps не сортируются, не синтезируются и не используются для расчёта. Caller
соединяет результаты с исходными timestamps. Все вычисления causal и prefix-stable.

Потребляемые поля: Supertrend HLC и open (только hidden bodyMiddle), SAR HLC, TSI/KST close, Fisher
high/low для hl2. Остальные поля не проверяются и не требуются. `null` означает неизвестное
значение; sparse bars, undefined consumed fields, NaN/Infinity, нечисленные поля вызывают
RangeError. High<low и известные потребляемые open/close за известными high/low отклоняются.
Отрицательные и нулевые цены допустимы.

Локальная защита ресурсов: вход до 1 000 000 баров, периоды integer1..10000; Supertrend factor
.01..1 000 000, SAR start/increment/maximum0..1. Это локальные bounds, не Pine max: Supertrend
source имеет factor min .01 и period min1; SAR public inputs вообще не задают min/max. Start выше
maximum допускается и не clamp до первого strict EP update, как в reference. Никаких новых
dependencies.

## Формулы и seeds

### Supertrend

True range — max(high−low, abs(high−previous close), abs(low−previous close)), на первом баре
сегмента high−low. ATR — Wilder alpha1/n, seed среднее первых n TR. Центр hl2, raw bands
hl2±factor×ATR. Lower обновляется при rawLower>previousLower либо previousClose<previousLower; upper
симметрично rawUpper<previousUpper либо previousClose>previousUpper. Previous band nz=0 — **явно
заданное внутреннее состояние** официального reference, не цена подставного бара.

Если previous ATR неизвестен, direction=+1. Иначе когда previous Supertrend равен previous upper,
close>current upper даёт −1, иначе +1; в другой ветви close<current lower даёт +1, иначе −1. −1
означает up, +1 down. Equality не вызывает reversal. Value выбирает lower для up и upper для down.
Up/down series разрываются null на противоположном тренде. BodyMiddle=(open+close)/2 — hidden
численный plot, включён явно; первый global бар скрыт, как в builtin.

Локальная availability mask: price outputs null до известного ATR и на первом баре каждого сегмента.
Direction до seed остаётся +1 на известной HLC свече. При отрицательных ценах public reference nz
может выдавать pre-ATR нулевой upper; наш price output до ATR это скрывает. Поэтому cold preseed
display parity не заявляется. После ATR внутренние bands продолжают reference recurrence.

Ручной ledger H/L/C: `(10,8,9),(12,10,11),(14,12,13),(15,13,14),(14,11,12),(12,9,10),(13,10,12)`,
length2/factor1. TR=2,3,3,2,3,3,3; ATR=na,2.5,2.75,2.375,2.6875,2.84375,2.921875.
Value=na,13.5,13.5,11.625,11.625,13.34375,13.34375; direction=+,+,+,−,−,+,+. На length1 initial nz
band0 не равен initial raw upper; отдельный equality ledger закрепляет этот boundary.

### Parabolic SAR

Первый бар сегмента null; на втором close>previous close задаёт below=true, EP=current high,
SAR=previous low; иначе above, EP=current low, SAR=previous high. AF=start. Сразу выполняется
projection SAR+AF×(EP−SAR). Strict пересечение SAR>current low для below или SAR<current high для
above вызывает reversal. Новый SAR использует max(current high,old EP) либо min(current low,old EP),
новый EP противоположный текущий extreme, AF=start.

На seed/reversal bar AF не повышается. Иначе strict новый EP увеличивает AF до
min(AF+increment,maximum). Затем SAR clamp по одному предыдущему low/high, а с третьего бара
сегмента ещё по two-back low/high. Равные close выбирают начальный above; равные EP не повышают AF.
Даже initial AF>maximum остаётся start до первого EP update.

На общем ledger выше start=.2/inc=.2/max=.4: SAR=na,8,8,10,15,15,9; EP/AF после баров1..6 равны
12/.2,14/.4,15/.4,11/.2,9/.4,13/.2. Bar3 projection10.4 clamp к low двухбарной давности10; bar4
reversal использует прежний EP15. Это вручную заданные ожидаемые числа, без зеркального helper
алгоритма в тесте.

### True Strength Index

Change=close−close[1], затем EMA(long)→EMA(short) отдельно для change и abs(change). EMA
alpha2/(n+1), seed first known observation, без ожидания n.
Value=100×doubleEMA(change)/doubleEMA(abs(change)), signal=EMA(value,signalLength). Нулевой
denominator даёт null, не нулевой TSI. Builtin scale×100 подтверждён source, не raw ratio helper.

Close10,12,11,14 при long=short=signal3: double numerators2,5/4,3/2; denominators2,7/4,2;
TSI=na,100,500/7,75; signal=na,100,600/7,1125/14. При period1 текущий ненулевой change даёт ±100,
flat denominator неизвестен.

### Know Sure Thing

ROC(r)=100×(close−close[r])/close[r]; при previous close0 или неизвестной паре null. Четыре SMA
соответствующих ROC с весами1,2,3,4 складываются в KST; signal=SMA(KST,s). SMA требует length
известных наблюдений, null не занимает slot, после seed хранит последний mean. При close1,2,4,2 и
всех ROC/SMA1, signal2: KST=na,1000,1000,−500; signal=na,na,1000,250. Для разных ROC1,2,3,4 на
геометрической цене2^i компоненты100,300,700,1500 дают8800 после пятой свечи. Default геометрический
closed-form endpoint429817957400 после45 баров, signal после53.

### Fisher Transform

Source hl2. Positional highest/lowest hl2 в последних length **позициях**, partial initial windows,
null не растягивает span. Используется уже существующий pure ExtremeIndexWindow без изменения.
Normalized=.66×((hl2−lowest)/(highest−lowest)−.5)+.67×nz(previous normalized). Strict >.99
заменяется .999, strict <−.99 заменяется −.999. Fisher=.5×ln((1+x)/(1−x))+.5×nz(previous Fisher);
trigger=previous Fisher, не SMA.

Flat highest=lowest даёт null, включая начальную свечу и весь length1. Explicit source nz(previous
state)=0 разрешён только для этих рекурсивных переменных; неизвестные цены не заменяются. При
hl2=1,2,3: normalized na,.33,.5511; Fisher a=.5ln(133/67), b=.5ln(15511/4489)+.5a; output na,a,b и
trigger na,na,a. На монотонной истории normalized до clamp равен1−.67^k, Fisher стремится к
ln(1999); это независимый closed-form контроль большого fixture.

## Null, overflow и история

**Локальная sparse политика SAR/Supertrend:** неизвестный high/low/close разрывает сегмент и даёт
null trend outputs. То же при непредставимом TR/band/SAR projection. Следующая известная HLC
начинает новый сегмент; SAR ждёт следующую соседнюю HLC для второго seed бара; Supertrend заново
набирает n contiguous TR; первый бар нового сегмента скрыт даже при n=1. Неизвестный open не
сбрасывает известный trend, только bodyMiddle=null. Такой reset не заявляет совпадение с Pine na
execution. До/после gap и новый warmup закреплены отдельным тестом.

TSI/KST: текущий неизвестный raw change/ROC или его overflow маскирует оба видимых выхода.
Внутренние filters продолжают известное state: null не потребляет SMA slot, EMA удерживает
предыдущий результат; второй EMA и signal могут получать известное held значение первого stage. Raw
KST/signal state отделён от локальной output mask. Fisher: отсутствующий/flat/overflow текущий
source даёт value=null; trigger сохраняет **реальный предыдущий Fisher**, если известен. На
следующем шаге previous null рекурсии обрабатывается только source nz. Missing prices не
восстанавливаются.

Finite-safe kernels сохраняют first-known EMA и mean seed, rolling SMA; при overflow arithmetic
state сбрасывается, а результат null. TR/разности/ratios/bands проверяются до дальнейшего state
update. Half-sum midpoint избегает ненужного high+low overflow; arbitrary precision/underflow/Pine
rounding parity не обещаются. SAR direct projection может overflow даже при представимом
математическом convex rewrite; это честный null с новым seed. Ни один output не выдаёт NaN/Infinity.

| Расчёт     | Минимальная dense доступность                               | History                                      |
| ---------- | ----------------------------------------------------------- | -------------------------------------------- |
| Supertrend | value/down=max(2,n), direction1, bodyMiddle2, up≥max(2,n+1) | recursive full input, Wilder+bands           |
| SAR        | value2                                                      | recursive full input, two-bar seed/EP/AF     |
| TSI        | value/signal2 при первом ненулевом change                   | recursive full input, EMA chain              |
| KST        | value=max(roc+sma)=45; signal=value+signalLength−1=53       | finite **dense** lookback53 для всех outputs |
| Fisher     | value2/trigger3 при changing hl2; length1 всегда null       | recursive full input, extrema+nz state       |

Это минимумы, не гарантия конечного результата и не convergence padding. Null/zero denominator могут
отложить output неопределённо долго. KST known-observation windows на sparse истории могут требовать
больше timestamp истории, чем dense lookback. Для recursive полной истории произвольный
фиксированный fetch padding не даёт exact parity.

Metadata `trendStateMetadata(id,parameters?)` возвращает frozen
warmupBars/outputWarmup/alwaysUndefined/historyRequirement и availability explanation; local history
type не подменяет shared TechnicalHistoryRequirement. Для Fisher length1
warmup=null/alwaysUndefined=true. `trendStatePresets` содержит пять frozen объектов: public IDs,
actual version/sourceSha256, defaults/localLimits, requiredData, outputs, references и parityLimits.
`dpoResearch` отдельно unresolved. Volume не требуется ни одному из пяти.

Все пути O(N); дополнительные extrema/windows O(length), intermediate/output series O(N). Лимит
баров и period10k ограничивает ресурсы, временные benchmarks не являются частью API.

## DPO: разрешённая формула и неразрешённая граница

Source v32: length21, centered=false, source close. `barsback=length/2+1`. Centered
raw=close[barsback]−SMA(close,length), plot offset=−barsback; обычный
raw=close−SMA(close,length)[barsback], plot offset0. Это **две разные формулы**, не простой сдвиг
одного ряда.

Официальный
[v6 migration](https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/#fractional-division-of-constants)
и [operators](https://www.tradingview.com/pine-script-docs/language/operators/#arithmetic-operators)
подтверждают сохранение дробной части input-int division. При default21 получается11.5.
[Type system](https://www.tradingview.com/pine-script-docs/language/type-system/#type-casting)
объясняет explicit int truncation для float, но source не вызывает int; отдельного primary правила
conversion fractional history index/plot offset не найдено. Это не доказательство floor/round.
Исполнение Pine не выполнялось. Поэтому default DPO не реализован, не зарегистрирован и не включён в
completed math count.

Будущий centered контракт обязан хранить output на **вычисляющем** баре i и явно предоставлять
presentation offset. Отображение на i−barsback использует информацию из более позднего вычисляющего
бара; при display timestamp t значение зависит от будущего t+barsback. Нельзя возвращать это под t
как causal indicator или незаметно заменить нецентрированным вариантом. До подтверждения integer
conversion даже точный presentation offset остаётся нерешённым.

## Первичные источники и source evidence

Прочитано анонимно26.11.2026; `last` изменяемый. Source SHA256 ниже относится к UTF-8 `source` в
actual response. Полные response hashes и reference payload hash сохранены в
[research checkpoint](../openspec/changes/ta-trend-state/research-checkpoint.md).

| Public source                                                                                                                 | Version | SHA256 source                                                      |
| ----------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------ |
| [STD;Supertrend](https://pine-facade.tradingview.com/pine-facade/get/STD%3BSupertrend/last)                                   | 12.0    | `0c4115d2b12d1a3eb07c12bbc44e9dd99eaded6019781a40115be066311c42e3` |
| [STD;PSAR](https://pine-facade.tradingview.com/pine-facade/get/STD%3BPSAR/last)                                               | 33.0    | `0b65333a9c928edf614ff55fb66654e0f66fa00a7fc57d7e2d590923df77350e` |
| [STD;DPO](https://pine-facade.tradingview.com/pine-facade/get/STD%3BDPO/last)                                                 | 32.0    | `e6ddefe64e45e5b2b2555e577730ce2a5b7dfec0398c8319160ae5b257512339` |
| [STD;True%1Strength%1Indicator](https://pine-facade.tradingview.com/pine-facade/get/STD%3BTrue%251Strength%251Indicator/last) | 31.0    | `d754f9a1362997e4bafbde8a520cb9361560c072ea5c67d312edfa43eba0b886` |
| [STD;Know_Sure_Thing](https://pine-facade.tradingview.com/pine-facade/get/STD%3BKnow_Sure_Thing/last)                         | 30.0    | `e6ebf18172d38f94f76c83162fd3fe49d0d183c5a195dd1da79cc59f8f193c56` |
| [STD;Fisher_Transform](https://pine-facade.tradingview.com/pine-facade/get/STD%3BFisher_Transform/last)                       | 32.0    | `83e99f94eb20e1e19c3ae2964748a5492638280e22581465d754b89d49819432` |

SAR/Supertrend wrappers делегируют native ta.sar/ta.supertrend. Их официальные
[reference](https://www.tradingview.com/pine-script-reference/v6/#fun_ta.sar) примеры прочитаны в
публичном
[function payload](https://www.tradingview.com/static/bundles/11967.f052e1615089996eccf6.js), только
узкие фрагменты; SHA256 `681492fc92bba4f2ec3dfb2435a2c6675a7f84df9a5fc41e3fd113eacdd9f2f8`. Это
evidence recurrence, не выполненный Pine oracle.

Дополнительная справка:
[Supertrend](https://www.tradingview.com/support/solutions/43000634738-supertrend/),
[DPO](https://www.tradingview.com/support/solutions/43000502246-detrended-price-oscillator-dpo/),
[TSI](https://www.tradingview.com/support/solutions/43000592290-true-strength-index/),
[KST](https://www.tradingview.com/support/solutions/43000502329-know-sure-thing-kst/),
[Fisher](https://www.tradingview.com/support/solutions/43000589141-fisher-transform/). Help упрощает
некоторые детали; actual source устанавливает default TSI signal13 и Fisher trigger previous, а не
универсальное7..12/SMA правило.

## Проверки и integration gates

Focused source tests: `node test/technical-trend-state.test.mjs`, без build и subprocess test
isolation. 19 тестов: независимые rational/log/state ledgers, seed/strict
equality/reversal/AF/clamps, flat/gaps/reseed/overflow, bounds, frozen/prefix/timestamps,
invariants, metadata и100000-bar fixture.

Plain `node node_modules/typescript/bin/tsc --noEmit` обнаружил baseline отсутствующий
`src/generated/app-version.ts`. Source-only `node test/technical-trend-state-typecheck.mjs`
проверяет **весь реальный проект** с тем же tsconfig/noEmit и ровно одним виртуальным module
`APP_VERSION:string`, `BUILD_ID:string`. Ничего не пишет на диск, не подавляет diagnostics и не
меняет strict flags. Это не plain tsc PASS. Дополнительно scoped ESLint, Prettier и strict OpenSpec.

Для регистрации координатору нужны пять exact public IDs/output keys, новые параметры/limits/history
integration, explicit sparse semantics, отдельные native/renderer/serialization tests и browser QA.
DPO остаётся отдельным unresolved gate. Этот source commit не меняет computed count продукта, не
означает merge/deploy или реализацию всех TA.
