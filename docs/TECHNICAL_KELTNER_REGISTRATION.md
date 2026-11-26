# Keltner Channels: source-only регистрация

Exact base `0d17cf10a1a7f199d34d66235bd17352ca3f2627`; reviewed pure math
`780e9c5287153021b516b472fb1282b22f3b59a4`. Добавлен только `keltner-channels` после прежних50.
Итого51 computed,52 technical entries с Volume,56 library entries с четырьмя прежними scripts. Это
локальная source/runtime доступность; native/browser/Pine execution parity и release этим этапом не
подтверждаются.

## Verified primary evidence

`KELTNER_PRIMARY_CAPTURE.json` содержит только version/hash, input defaults, plot colors и fill
RGB/transparency; полного Pine source нет. Script `test/helpers/keltner-primary-registration.py`
делает анонимный GET с `ssl.create_default_context`, CERT_REQUIRED/check_hostname, отключён только
proxy. TLS verification не отключается и не зависит от унаследованного Node TLS flag.

Проверено26.11.2026, HTTP Date03:40:25UTC, HTTP200:

- [Официальный KC endpoint](https://pine-facade.tradingview.com/pine-facade/get/STD%3BKeltner_Channels/last),
  actual version35.0.
- Decoded-source SHA256 `102f0093433635000a53bf731f0fabe2a1f17cc7a28de12de14af81b7d1417bb`,
  совпадает с reviewed metadata.
- Source plot order Upper/Basis/Lower, все три `#2962FF`.
- Source fill RGB33/150/243, Pine transparency95 → `#2196F3`, opacity0.05. Это не предполагаемый10%
  default.

[Официальный Help](https://www.tradingview.com/support/solutions/43000502266-keltner-channels-kc/)
также прочитан через web tool: source close, Length20, EMA/SMA basis и отдельные band/background
controls. Pine endpoint через web tool оказался недоступен; факты выше подтверждены отдельным
certificate-verified Python capture. Code/source/proprietary bundles в repository не копируются.

## Parameters и strict API

| Model key        | Default            | Тип / локальный reviewed предел |
| ---------------- | ------------------ | ------------------------------- |
| length           | 20                 | integer1..10000                 |
| multiplier       | 2                  | number0..1 000 000              |
| source           | close              | прежние8 PriceSource values     |
| useExponentialMa | true               | настоящий boolean               |
| bandsStyle       | Average True Range | ровно3 canonical values         |
| atrLength        | 10                 | integer1..10000                 |

Canonical band values: `Average True Range`, `True Range`, `Range`. Bounds являются локальными math
limits, не утверждением о всех Pine input bounds. Имена model fields соответствуют reviewed
KeltnerOptions; source переменные length/mult/src/exp/BandsStyle/atrlength сопоставлены с этими six
fields без новых числовых aliases.

`ParameterDefinition` расширен boolean и readonly nonempty string choice metadata. Runtime instance
params остаются узко типизированными: `KeltnerParameters` содержит boolean и literal union3, PVO
params по-прежнему VolumeAverage EMA/SMA. Validator принимает только `typeof boolean` и exact
membership metadata choices; нет Boolean/string/0/1 coercion, trim/case normalization или исполнения
кода. Missing/null/array/unknown keys и accessor/non-record guard прежние. `Range `, `range`, `EMA`
для KC и `Range` для PVO отвергаются.

Старые50 definitions/params/styles/history не расширены render metadata. MACD/PVO/AO palette
activation и Donchian displayOffset остаются отдельными задачами.

## Числа, readiness и history

Runtime вызывает неизменённый `keltnerChannels` и сохраняет raw object `basis/upper/lower`. Общего
warmup mask нет: default basis готов с первого known source, bands — с десятого ATR observation.
`warmupBars` означает dense minimum для всех outputs, а не запрет показывать ранний basis.

| Режим            | Basis ready | Bands ready           | History              |
| ---------------- | ----------- | --------------------- | -------------------- |
| EMA + ATR        | 1           | max(1,atrLength)      | recursive            |
| EMA + True Range | 1           | 1                     | recursive            |
| EMA + Range      | 1           | length                | recursive            |
| SMA + ATR        | length      | max(length,atrLength) | recursive            |
| SMA + True Range | length      | length                | finite max(length,2) |
| SMA + Range      | length      | length                | recursive            |

Range означает RMA(high-low,length), не raw range. True Range использует текущий TR с high-low
fallback при неизвестном previous close. При length1 SMA+TR outputs могут быть готовы с первого
бара, но finite history остаётся2 из-за previous-close dependency.

`keltner-contract.ts` задаёт narrow finite/recursive history с точными seedPolicy literals; adapter
проверяет их против reviewed metadata без generic string casts. Сохраняются seedBars и convergence.
EMA/SMA/range streams независимы; null/reset/overflow masks и timestamps передаются как у math.
Unselected volume:null допустим, source volume с unknown values даёт null basis, без fake0.
Настоящий математический0 сохраняется. Общий runtime по-прежнему валидирует все TechnicalBar
fields/timestamps до formula dispatch.

## Presentation

Default overlay; user может выбрать price либо own pane. Explicit `precisionPolicy:'native-price'`
остаётся той же в lower pane. Visible UI plot order Upper/Basis/Lower повторяет source; raw result
object сохраняет reviewed basis/upper/lower.

Все plots — line/break, width1, blue#2962FF; один fill upper→lower, blue#2196F3/opacity0.05/gaps
break. Hidden series отсутствуют. Общий bridge использует реальный lower plot как fill scale
carrier, никаких hidden0/pseudoquote. При неизвестных bands fill не создаёт пары, а известный early
basis остаётся в outputs. Индивидуальное скрытие stroke не меняет fixed fill; instance hide/collapse
маскирует fill по существующему contract.

Native modules, compiler, price scale/camera/cache не редактируются. Local break-gap semantics
следуют reviewed masks; точное Pine skip-na/display-gap и browser paint не заявлены.

## Форма и portable boundaries

Settings draft хранит boolean как boolean. Use Exponential MA — настоящий checkbox, покрытый уже
существующим `.technical-settings input[type="checkbox"]` CSS16×16; числового0/1 surrogate нет.
Select имеет ровно3 values, RU display labels не меняют stored strings. Labels параметров и трёх
новых style outputs есть RU/EN. PVO EMA/SMA select values/display и все четыре комбинации сохранены.

Изменение только bool/choice/period/pane не материализует styles/default color. Импортированные
sparse v1 styles и lineStyle сохраняются; advanced fill controls не добавлены. Fill default
находится только в runtime metadata и не выдаётся за persisted editable setting.

Instance schemaVersion1, backup envelope, DB writer и G5 форматы не меняются. Drive добавляет ровно
два scalar keys: `useExponentialMa bandsStyle`. Length/multiplier/source/atrLength уже входили в
pinned old allowlist. Все старые keys, включая shortLength, сохранены. Оригинал валидируется до
projection; false не теряется как falsy field. Root/profile/manual JSON/Drive
sanitize/prepare/restore проверены локально для bool true/false, всех styles, price/own pane и
sparse explicit styles. Реальный Google API/DB import не выполнялся.

## Calculation limit

Shared `technicalCalculationUnavailableReason` добавляет только KC branch: до1M bars включительно
kernel разрешён; выше — transient `calculation-limit`, три null arrays той же длины и реальные
timestamps. Params/prefs/backup не получают flag. Изменение истории снова запускает kernel;
неожиданные kernel exceptions не скрываются generic catch.

ALMA/LSMA50M window-product budget к KC не применяется. EMA/RMA paths O(N), reviewed SMA O(N log L);
memory O(N+L), плюс outputs/validation. Runtime не меняет reviewed алгоритмы. Boundary unit
использует spy для1M разрешённого kernel и реальные valid1M+1 bars для skip; это не
device/performance benchmark. KC period change не снимает bar cap — требуется уменьшить историю;
shared status допускает сохранение valid дорогих params.

## Независимая совместимость

`keltner-compatibility.test.mjs` восстанавливает actual base через read-only `git show` и отдельный
source loader. Deep equality покрывает старые50 definitions/default/custom styles/panes/history,
empty/dense/noVolume/sparse results, profile validation, JSON и Drive projection; current
prepare/restore сохраняет old50 v1 instances. PVO all4 EMA/SMA combinations и malformed choices
сопоставлены с base.

Old50 witness SHA256: `8f972b956f4704cff925b686cb9ace9ac3c09471cf6b188fc14b352a790f7a63`.

На base/current дополнительно совпали full42
`610fd4c860f6ccc49bc80c7f1f29651a5983d75ce2630ff565f5ed81823afc0a` и numeric42
`7cd3515d0bf89d288c3715165c8da0d3584df81ae50525ce2681825cde507ca3`. Reviewed math6files
averages/channels/filters/index/inputs/metadata byte-identical780e9 после нормализации checkout
CRLF→LF. Central `test/technical-registry-expectation.mjs` и существующие fixtures не изменены.

## Проверки и границы

- Новые suites: registration6, actual-settings6, persistence3, independent compatibility2 —17/17
  PASS.
- Сохранённые suites: pure channel-average88, settings-style6, volume-settings3, compiler9, bridge5
  —111/111 PASS.
- Whole-source TypeScript noEmit с двумя version strings только in-memory и scoped ESLint — PASS.
  Strict OpenSpec56/56, owned Prettier и diff-check — PASS. Frozen SHA и clean WT status передаются
  отдельно после commit.

Итого128 scoped tests. Actual form означает выполнение реального component submit/action/validator с
controlled hooks/controller boundaries; browser layout/paint и физический16px размер этим не
измеряются. CSS selector размер проверен статически. Pinned central helper пока ожидает50 и прежние
Drive keys: global count/key assertions потребуют root update после независимого review; это
намеренно не скрыто изменением fixtures. Full build/check/browser не запускались.

Нет native adapters/camera/history/cache/version/build/Google/credentials changes, новых
dependencies или публичной публикации. Перед production нужны independent source review, root
central expectations update и отдельные native/browser gates KC.
