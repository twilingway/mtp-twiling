# SAR/Supertrend: source-only регистрация

Exact base: `f74c33d968d7ca258def096bfc2d731bbdf74b5f`. Reviewed math:
`49bfcf77c9a5200f8bcaf6d70735bd167c500b5f`. Работа append-only, только два новых локально computed
индикатора. Native adapters/compiler и исходная математика не изменены. Browser G2, release и
public/Pine execution parity этим этапом не подтверждаются.

## Model и defaults

Новые definitions добавлены после прежних45: `parabolic-sar`, затем `supertrend`. Итого47 computed
definitions; technical catalog48 available с Volume; library52 с четырьмя прежними scripts. Это
доступность локального source/runtime, не обещание внешней публикации или закрытого native gate.

| Параметр             | Default | Локальные reviewed bounds |
| -------------------- | ------- | ------------------------- |
| SAR start            | 0.02    | 0..1                      |
| SAR increment        | 0.02    | 0..1                      |
| SAR maximum          | 0.2     | 0..1                      |
| Supertrend atrLength | 10      | integer1..10000           |
| Supertrend factor    | 3       | 0.01..1 000 000           |

Bounds/defaults берутся из `trend-state/metadata.ts`, дополнительной связи start<=maximum нет:
reviewed recurrence допускает start выше maximum. API остаётся exact:
unknown/missing/null/array/non-finite/out-of-bounds params, invalid style keys и дополнительные
runtime fields отвергаются текущим root validator. Никаких новых source/volume controls: SAR
потребляет HLC, ST — HLC плюс open только для bodyMiddle; общий runtime продолжает проверять полный
TechnicalBar/timestamps. volume:null допустим и не выключает ни один из двух индикаторов.

`trend-price-contract.ts` задаёт узкие ID/history literals. Adapter в `trend-price-runtime.ts`
проверяет reviewed metadata перед созданием точного typed history:

- SAR: recursive, seedBars2, `two-adjacent-bars-close-direction`, full-input-dependent.
- ST: recursive, seedBars max(2,atrLength), `contiguous-true-range-wilder-and-trailing-bands`,
  full-input-dependent.

Это минимум наблюдений, не finite lookback и не гарантия готового значения на sparse данных.
Warmup/history не сохраняются в instance. SAR возвращает `series.value`; ST сохраняет все пять
reviewed arrays `value/direction/upTrend/downTrend/bodyMiddle` без нового общего маскирования.
Первый неизвестный seed price остаётся null, gaps/reseed/overflow сохраняют поведение math. Реальный
вычисленный0 допускается; подстановки0 вместо неизвестной цены нет. Prefix causality, timestamps и
входные frozen objects проверены.

## Presentation и форма

Оба default overlay; pane может быть price либо пользовательская lower pane. Presentation всегда
явно `precisionPolicy:'native-price'`, положение её не переопределяет.

| Индикатор | UI outputs                                     | Runtime-only presentation                                                                                              |
| --------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| SAR       | value, `#2962FF`, width1                       | cross, pine-relative size1; нет соединяющей линии                                                                      |
| ST        | upTrend `#4CAF50`, downTrend `#F23645`, width1 | line/break; hidden value/direction/bodyMiddle; bodyMiddle→upTrend и bodyMiddle→downTrend fills, opacity0.1, gaps break |

Raw hidden arrays остаются только в calculation result. Они не добавляются в outputs definitions,
styles keys, params или backup. Общий compiler проверяет references/lengths/hidden graph и
directional masks; реальный `TechnicalRenderData` выдаёт только3 outputs и2 fills для пары
instances. Fill carrier направлен на свою up/down ветвь. Индивидуальное скрытие stroke сохраняет
fill; instance hide/collapse маскирует оба fills по существующему contract.

Форма имеет RU/EN labels для пяти scalar params и translated названия up/down controls. SAR
показывает «Размер»/Size и preview крестиков; Line select отсутствует. Width1..4 сохраняется
существующим v1 полем и интерпретируется compiler как relative cross size. Импортированный
dashed/dotted lineStyle не удаляется и не преобразуется при submit, size/color/opacity edits; cross
renderer его визуально не использует. Остальные индикаторы сохраняют прежние Width/Line controls.

Изменение только params/pane не материализует styles/default color. Существующие explicit
colors/styles остаются точными; style patch материализует только изменённый output. ST показывает
только две stroke settings; fill controls отсутствуют, поскольку текущий v1 не умеет честно
сохранять G5 fill modes. Этот gap не скрыт автосохранением runtime defaults.

MACD/PVO/AO production definitions не получают palette metadata: v1 opacity edit материализовал бы
required color и переключал auto palette в solid. Код native palette остаётся отдельно проверенным,
activation требует будущего G5 UI/persist contract.

## Portable boundaries

Instance schemaVersion1, backup envelope/DB/version не меняются. `services/drive/backup.ts`
добавляет ровно пять numeric keys: `atrLength factor start increment maximum`. Остальные старые keys
и exact pre-projection validation сохраняются. New params всегда flat finite scalars;
geometry/fills/precision policy/series/direction/bodyMiddle туда не попадают.

Tests выполняют настоящий root/profile validation, JSON serialize/parse и Drive
sanitize/prepare/restore локально, с custom/default styles и price/own panes. Не выполнялись
реальные Google API, запись IndexedDB, import в пользовательский профиль или миграция G5
instance2/envelope3/DB3 writer. Старый reader без новых definition IDs штатно отвергает такой backup
до записи; автоматического переписывания старых instances нет.

## Независимые compatibility witnesses

`technical-trend-price-compatibility.test.mjs` читает исходники pinned base через read-only
`git show`, транспилирует их отдельным source loader и сравнивает с текущим core. Сравниваются
первые45 definitions/default instances/custom v1 styles/panes, history, empty/dense/noVolume/sparse
results, profile validation и JSON/Drive projection. Дополнительно old45 проходят current Drive
prepare/restore без изменения fields.

Old45 witness SHA256: `74f0feb3595c7bfccc42086369260520446641b61593658107f2ee54756c39d0`.

Оба старых witnesses проверяются на base и current без изменения fixtures:

- full42 `610fd4c860f6ccc49bc80c7f1f29651a5983d75ce2630ff565f5ed81823afc0a`;
- numeric42 `7cd3515d0bf89d288c3715165c8da0d3584df81ae50525ce2681825cde507ca3`.

Reviewed math sar/supertrend/inputs/filters/metadata/index/fisher/oscillators совпал с49b
byte-for-byte после нормализации checkout CRLF→LF. Формулы, seed, clipping/math masks и source
metadata не редактировались. Источники: SAR public ID `STD;PSAR`, version33.0, SHA256
`0b65333a9c928edf614ff55fb66654e0f66fa00a7fc57d7e2d590923df77350e`; ST `STD;Supertrend`,
version12.0, SHA256 `0c4115d2b12d1a3eb07c12bbc44e9dd99eaded6019781a40115be066311c42e3`. Primary
references остаются в неизменённом reviewed metadata; новых network fetch этого этапа нет. Исходные
parity limits сохранены в `TECHNICAL_TREND_STATE.md`.

## Проверки и remaining gates

- Новые suites: registration6, persistence3, actual-form5, independent Git compatibility2 —16/16
  PASS.
- Сохранённые suites: settings-style-preservation6, pure trend-state19, render compiler9,
  render-data bridge5 —39/39 PASS.
- Whole source TypeScript noEmit с двумя version strings только in-memory — PASS. Scoped ESLint
  owned production files и Prettier owned files — PASS. Strict OpenSpec51/51 — PASS. Frozen commit
  SHA и clean worktree status передаются отдельно после commit.

Это55 scoped tests; actual-form означает исполнение реального component submit/action/validator с
controlled React hooks/controller boundary, а не browser UI. Старые global45/46/50 и
unavailable-SAR/ST count assertions намеренно не переписываются здесь: root обновляет global counts
один раз после integration. Полный build/test/browser не запускался.

G2 и точная визуальная идентичность TradingView ещё отдельные root gates. Native collapsed
empty-axis cosmetic, point pixel calibration, fills/grid/price/MTP/drawings/cursor layers,
log/inverted/DPR/resize/engine restore и performance требуют дальнейшей интеграционной проверки. Ни
исходники renderer, ни shared compiler, ни price history/cache/camera writer в этой регистрации не
изменены.
