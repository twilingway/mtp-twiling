# Чистая математика ALMA, LSMA и каналов

Статус **math-only**. Новый пакет `src/model/technical-indicators/channel-average/index.ts`,
отдельные tests/docs/OpenSpec. Все пять exact IDs есть в каталоге127. Реализация самостоятельная;
Pine source и proprietary/reference bundles в Git не копируются. Shared types, registry/UI/native,
cache, Drive, package/version/build не меняются.

## API, defaults и outputs

Все функции синхронные, чистые, без часов/DOM/сети. Входы `NumericSeries` и
`readonly TechnicalBar[]` совместимы с общими типами; серии длины входа, исходные массивы и
timestamps не меняются. ALMA/LSMA возвращают числовую серию (metadata key `value`), каналы — объект
серий.

| API                                | Exact builtin defaults                                                                                   | Outputs             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------- |
| `alma(series, options?)`           | length9, offset0.85, sigma6; builtin source фиксирован close                                             | value               |
| `lsma(series, options?)`           | length25, offset0, Source close                                                                          | value               |
| `keltnerChannels(bars, options?)`  | length20, multiplier2, source close, useExponentialMa true, bandsStyle `Average True Range`, atrLength10 | basis, upper, lower |
| `donchianChannels(bars, options?)` | length20, displayOffset0 (Pine input `Offset`)                                                           | basis, upper, lower |
| `chandelierExit(bars, options?)`   | length22, atrLength22, multiplier3                                                                       | longExit, shortExit |

ALMA `floor?: boolean=false` — дополнительный аргумент pure API/Pine `ta.alma`, **не видимый input
builtin**. LSMA caller передаёт уже выбранный source series: metadata Source close описывает builtin
default. Keltner поддерживает open/high/low/close/hl2/hlc3/ohlc4/volume; производный source требует
всех своих компонентов. Его useExponentialMa, bandsStyle и atrLength — настоящие inputs с builtin
`display.none`.

Массивы dense, consumed значения finite либо null. Sparse/undefined/NaN/Infinity дают `RangeError`.
Timestamps finite, порядок не сортируется. Donchian читает только high/low и timestamps; остальные
каналы — high/low/close плюс выбранный Keltner source. Невыбранные open/volume игнорируются. High
ниже low и consumed close вне известного диапазона отклоняются. Неизвестные цены не заменяются.

Локальные caps: bars<=1000000; периоды1..10000, LSMA2..10000; integer LSMA offset/Donchian
displayOffset от-10000 до10000; ALMA offset от-100 до100, sigma0.000001..10000;
multiplier0..1000000. Это **не Pine input bounds**. Дегенеративная LSMA length1 не доказана primary
reference: явный локальный RangeError и `unresolved` limitation. Builtin source не устанавливает
min2; slope0 не придуман.

## Формулы и причинность

ALMA: m=offset*(L-1), optional floor применяется только к m; s=L/sigma; w[j]=exp(-(j-m)^2/(2*s^2)).
j0 — самый старый бар окна, jL-1 — текущий. Результат weighted sum / sum weights. Reference по
умолчанию использует fractional m без обязательного floor. Для устойчивости из log weights
вычитается sampled maximum; значения окна масштабируются по max absolute. Convex sum ограничивается
диапазоном единичного scale, чтобы rounding не превращал representable mean в Infinity.

ALMA и LSMA используют прямой алгоритм O(N*L), память O(N+L). До kernel allocation проверяется
max(0,N-L+1)*L<=50000000; cap означает window-products, а не число CPU инструкций. Две проходки по
окну сохраняют этот порядок сложности. FFT и новых зависимостей нет.

LSMA: least-squares slope/intercept на x0..L-1, результат intercept+slope*(L-1-offset).
Положительный offset оценивает прежнюю координату **текущей** прямой; отрицательный экстраполирует
эту же прямую вперёд. Оба остаются на calculation timestamp и не читают future prices. Centered x и
масштабированные y предотвращают overflow промежуточных x*y.

Keltner basis — EMA(source,L) при useExponentialMa true, иначе SMA(source,L). EMA alpha2/(L+1), seed
первое valid. RMA alpha1/L, seed средним первого полного contiguous окна. upper/lower=basis
плюс/минус multiplier*range.

| bandsStyle         | Range                                             |
| ------------------ | ------------------------------------------------- |
| Average True Range | RMA(TR, atrLength)                                |
| True Range         | текущий TR с handle_na=true                       |
| Range              | **RMA(high-low,L)**, не raw high-low и не SMA/EMA |

TR=max(high-low,abs(high-prevClose),abs(low-prevClose)); при неизвестном prevClose или на первом
баре fallback high-low. Basis остаётся численным output даже пока ATR не готов.

Donchian upper=highest(high,L), lower=lowest(low,L), basis — их midpoint. Доступные startup
экстремумы считаются с первого known бара, затем окно ограничено L. Monotonic deques O(N), память
O(N+L), ties корректно истекают по индексу. displayOffset валидируется, но **не меняет расчётные
серии**; metadata presentation хранит сдвиг. Renderer должен рисовать значение на index+offset
отдельно. Negative displayOffset переносит значение, известное лишь на calculation bar, назад по
экрану; это не исторический сигнал.

Chandelier builtin v4/TradingView ta/11: longExit=highest(high,length)-multiplier*ATR(atrLength);
shortExit=lowest(low,length)+multiplier*ATR(atrLength). Обе линии доступны одновременно. Actual
source **не содержит** sourceClose, previous-stop ratchets, direction, buy/sell signals, masking или
reversal state. Популярный everget community variant сюда не примешан. Long exit может упасть при
росте ATR или истечении старого high; stops не затягиваются искусственно.

## Readiness, seeds и history

`channelAverageMetadata(id, options?)` возвращает immutable math-only metadata: exact
ID/version/hash/defaults, effective parameters, outputs, omittedNumericOutputs=[], default overlay,
per-output firstReadyBars, warmupBars для всех outputs, history/seed/convergence, local bounds и
limitations. Presets/options не входят в persistent schema.

| Формула             | Первый ready на dense входе                         | History                                     |
| ------------------- | --------------------------------------------------- | ------------------------------------------- |
| ALMA                | L (default9)                                        | finite L; full-window; exact-after-lookback |
| LSMA                | L (default25)                                       | finite L; full-window; exact-after-lookback |
| Keltner EMA basis   | 1                                                   | recursive; first-valid seed                 |
| Keltner SMA basis   | L                                                   | finite L                                    |
| Keltner upper/lower | max(basisReady, ATRlength / 1 для TR / L для Range) | recursive, кроме SMA+TR                     |
| Keltner SMA+TR      | basis L, bands max(L,1)                             | finite max(L,2), TR читает previous close   |
| Donchian            | 1, partial extrema startup                          | finite L                                    |
| Chandelier          | ATRlength (default22), независимо от extrema length | recursive ATR плюс конечное окно extrema    |

Recursive lookbackBars=null и convergence=full-input-dependent: seed readiness не означает
совпадения с иной стартовой историей. Default Keltner basis готов1, bands10. Chandelier
length50/ATR2 готов2 благодаря partial extrema startup.

**Local gap policy:** ALMA/LSMA требуют полное contiguous окно. SMA/RMA пересеиваются после null,
EMA начинает с первого valid. Каждый high/low extrema поток сбрасывается независимо, затем
использует partial окно нового сегмента. Неизвестный prevClose даёт официальный TR fallback.
Basis/range независимы. Overflow TR/high-low становится null и пересеивает RMA. Непредставимый final
band/projection — null, не Infinity и не fake0. Настоящий математический zero остаётся0.

SMA использует bounded tree средних O(N log L), память O(N+L), без subtractive cancellation при
истечении большого значения. Epoch reset после gap O(1). EMA/RMA O(N). Convex means сохраняют
constant subnormal/max значения в average/source/midpoint. IEEE754 rounding/underflow остаются
численными ограничениями. Pine skip-na и startup/runtime edge parity отдельно не измерены.

## Независимые ledgers

Expected values не получаются production-функциями. ALMA L3,m1,sigma3*sqrt(2*ln2) даёт веса
[1,2,1]/4; L4,m1.5,sigma4*sqrt(2*ln2) — [1,4,4,1]/10; optional floor m1 — [8,16,8,1]/33. Для
[1,2,7,4] последние результаты41/10 и100/33. Orientation проверена отдельно.

LSMA [1,4,2]: mean7/3,slope1/2, endpoint17/6, offset1=7/3, offset-1=10/3. Even asymmetric
[2,7,-1,4]: mean3,covariance-1,denominator5,endpoint27/10.

HLC ledger: (10,8,9),(15,11,14),(14,10,11),(20,16,18),(12,8,10),(13,9,12),(8,4,5). Рациональные
строки вычислены независимо (Fraction/manual), не через TS engine:

| Поток                         | Последовательность                     |
| ----------------------------- | -------------------------------------- |
| TR                            | 2,6,4,9,10,4,8                         |
| EMA3(close)                   | 9,23/2,45/4,117/8,197/16,389/32,549/64 |
| ATR2                          | na,4,4,13/2,33/4,49/8,113/16           |
| RMA3(high-low)                | na,na,10/3,32/9,100/27,308/81,940/243  |
| highest3                      | 10,15,15,20,20,20,13                   |
| lowest3                       | 8,8,8,10,8,8,4                         |
| Chandelier L3/ATR2/mult2 long | na,7,7,7,7/2,31/4,-9/8                 |
| Chandelier short              | na,16,16,23,49/2,81/4,145/8            |

Проверены все Keltner Range options и EMA/SMA, асимметричные lengths, extrema ties/expiration,
zero/negative/flat/subnormal/max цены, defaults/firstready, frozen inputs/timestamps, каждый prefix,
null/empty/all-null/sparse/malformed, overflow recovery, окно10000/100000 экстремумов и resource
caps. Chandelier weakening fixture проверяет отсутствие fake trails, не придумывает reversal output.

## Primary evidence

Проверено26.11.2026: публичные endpoints прочитаны Python urllib с default certificate/hostname
verification, отключён только неработающий proxy. TLS verification не отключалась. Node с
унаследованным NODE_TLS_REJECT_UNAUTHORIZED=0 не использовался для source verification. Hash ниже —
decoded source UTF8, не JSON response.

| Exact ID / endpoint                                                                                                                         | Actual version | SHA256 source                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------ |
| [STD;Arnaud%1Legoux%1Moving%1Average](https://pine-facade.tradingview.com/pine-facade/get/STD%3BArnaud%251Legoux%251Moving%251Average/last) | 30.0           | `6392823a19e1c4cf55a794491c857dff845230998cba8eb92f0d6646d0caff04` |
| [STD;Least%1Squares%1Moving%1Average](https://pine-facade.tradingview.com/pine-facade/get/STD%3BLeast%251Squares%251Moving%251Average/last) | 30.0           | `0454f77822ea2d48d989106c72a1798dbded9d380034eed30002f2c58ddd2d33` |
| [STD;Keltner_Channels](https://pine-facade.tradingview.com/pine-facade/get/STD%3BKeltner_Channels/last)                                     | 35.0           | `102f0093433635000a53bf731f0fabe2a1f17cc7a28de12de14af81b7d1417bb` |
| [STD;Donchian_Channels](https://pine-facade.tradingview.com/pine-facade/get/STD%3BDonchian_Channels/last)                                   | 32.0           | `1c2092e5bd3919968c13dea205d77c5bc60233685ffd1281b39b1676a2461f69` |
| [STD;Chandelier_Exit](https://pine-facade.tradingview.com/pine-facade/get/STD%3BChandelier_Exit/last)                                       | 4.0            | `b66ee578b5a5645af8173c752838221ea848729ea593459d26ffaf7417a7a37f` |
| [TradingView/ta/11 source](https://pine-facade.tradingview.com/pine-facade/get/PUB%3B77c0f0012daa4ff09d68b6f3bed95a7f/11)                   | 11.0           | `da37dca4bc18ce3b825d1d9c8b682f97859508cc5bb8bd3e51e1a28713edee80` |

Дополнительно прочитаны официальные Help
[ALMA](https://www.tradingview.com/support/solutions/43000594683/),
[LSMA](https://www.tradingview.com/support/solutions/43000599877-least-squares-moving-average/),
[Keltner](https://www.tradingview.com/support/solutions/43000502266-keltner-channels-kc/),
[Chandelier](https://www.tradingview.com/support/solutions/43000773013-chandelier-exit/) и
[официальная библиотека](https://www.tradingview.com/script/BICzyhq0-ta/).

ALMA kernel/floor, EMA/RMA seeds, ATR/TR и linreg args прочитаны по
[Pine v6 reference](https://www.tradingview.com/pine-script-reference/v6/#fun_ta.alma),
[official function payload](https://www.tradingview.com/static/bundles/11967.f052e1615089996eccf6.js),
SHA256 `681492fc92bba4f2ec3dfb2435a2c6675a7f84df9a5fc41e3fd113eacdd9f2f8`. Payload прочитан только в
памяти процесса и не сохранён в repo.

## Gates следующей интеграции

Root регистрирует5 IDs в shared contracts/runtime/catalog отдельно и проверяет source selectors.
ALMA builtin preset фиксирует close, optional floor остаётся pure API. LSMA length1 остаётся
unresolved/unsupported до доказательства, min2 не выдаётся за TradingView minimum. LSMA offset —
параметр формулы, Donchian displayOffset — presentation.

Generic fill между upper/lower Keltner/Donchian и display offset Donchian требуют отдельного native
renderer/acceptance gate. Нет fake +/-1 price plot. Marker/direction gate для Chandelier не нужен:
source таких outputs не содержит. Все пять default overlay. Multi-timeframe/timeframe_gaps,
realtime/Pine runtime и browser/native не проверялись; visual parity не заявлена.

## Проверки source delivery

Команды из изолированного WT, без prepare-version/build:

```text
node --test --experimental-test-isolation=none test/technical-channel-average.test.mjs
node test/helpers/channel-average-source.mjs --typecheck
node node_modules/eslint/bin/eslint.js src/model/technical-indicators/channel-average --max-warnings 0
node node_modules/prettier/bin/prettier.cjs --check src/model/technical-indicators/channel-average test/technical-channel-average.test.mjs test/helpers/channel-average-source.mjs docs/TECHNICAL_CHANNEL_AVERAGE.md openspec/changes/ta-channel-average
node scripts/spec.mjs validate --all --strict
```

Typecheck читает весь source с исходными strict options. Только если baseline generated app-version
отсутствует, compilerhost виртуально предоставляет APP_VERSION:string и BUILD_ID:string. Нет записи
generated, подавления diagnostics или изменения flags. Итоги — verification.md.
