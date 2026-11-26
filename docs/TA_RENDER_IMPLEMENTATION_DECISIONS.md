# Реализация отображения TA: принятые границы

26.11.2026. Ветка `feat/ta-render-presentation`, source base
`50b5873778fa442fce3266c2f9882a59d231ab38` с отдельными документами исследования. Это **локальная
подготовка реализации**, не включённая функция опубликованного приложения.

## Runtime contract

Integrator принимает renderVersion2 из исследования для source-only compiler и последующей
реализации adapters. Версия относится к runtime metadata, не к сохранению instance или backup.
G1/G3/G4/G6/G7 design из исследования принят со следующими проверяемыми ограничениями:

- Plot geometry: line с legacy/break policy, columns с base0, ортогональный cross с относительным
  размером1..4. Cross не заменяется кругом. Точные CSS размеры cross и singleton/cap paint ещё
  калибруются на этапе engine QA; compiler сохраняет singleton как отдельный индекс.
- MACD/PVO sign/change и AO change palette соответствуют исследованным source expressions. Для
  previous-null принимается описанная локальная policy: MACD/PVO false-comparison branch, AO green.
  Это явно не доказательство sparse Pine runtime parity.
- Любой explicit v1 color остаётся solid, даже если он совпадает со старым default. Compiler не
  переписывает styles, не меняет numeric массивы и не пытается восстановить неизвестное намерение.
  Period-only form fix поступает отдельно с собственным review.
- Hidden series не создают plots/scale. Fill references обязаны ссылаться на известные numeric
  series; направления и разрывы кодируются исходными null masks. Запрещены interpolation, last-known
  fill, подстановка нуля, мосты через неизвестные пары или reversal.
- Fill scale policy — none; конечные видимые plots участвуют в scale. Hide/collapse скрывает весь
  instance. Это контракт для adapters, а не уже выполненный native scale тест.
- LW normal drawBackground и KLine negative fill/Price registration plan из исследования принят для
  реализации. Actual create/sync и paint/G7/MTP/performance gates остаются обязательными. Старые
  explicit6 native paths не меняются попутно.

Новые owned файлы: `presentation-types.ts`, `presentation.ts`, `presentation-geometry.ts` в
`src/model/technical-indicators`; тесты `test/ta-render-contract{,-fixture}.mjs`. Runtime пока не
подключён к definitions, adapters, меню, registry, storage или Drive. Старые fixtures не менялись.

## Numeric witness

Отдельный baseline снят через readonly `git show50b5873:src/...` source loader. SHA256
`7cd3515d0bf89d288c3715165c8da0d3584df81ae50525ce2681825cde507ca3` покрывает прежние42 instances, их
v1 параметры, history и numeric results для empty/ordinary/missing-volume/sparse64-bars случаев.
Definitions намеренно исключены из этого witness, чтобы отдельно принимать render metadata. Полный
прежний definition-inclusive witness
`610fd4c860f6ccc49bc80c7f1f29651a5983d75ce2630ff565f5ed81823afc0a` также пока совпадает. Команда
захвата сохранена вне Git как `vps/artifacts/capture-ta-render-numeric42-baseline.mjs`.

## Persistent compatibility — G5 pending

Предложение instance2/envelope3 остаётся на отдельное согласование. Этот этап не добавляет reader,
writer, implicit promotion, auto-reset controls или новых persisted fields. Пользовательские профили
и remote Drive не читаются и не меняются. Runtime compile API не является validator произвольного
backup; импорт продолжает использовать существующие строгие validators.

## Проверки и оставшаяся работа

Восемь focused source tests проверяют palette branches, legacy styles, graph references/nulls,
relative cross size, hidden anchors, paired runs/reversals и frozen42. Whole-source strict compiler
host использует единственный виртуальный модуль version strings, поскольку generated version в
source-only worktree отсутствует; диагностики не подавляются. Scoped ESLint и Prettier проходят.

Нужны независимый review compiler, подключение descriptors, реализация и тесты обоих adapters,
actual browser scale/layers, native lifecycle и performance gates. Этот документ не закрывает SAR/ST
availability, Google/Drive compatibility или полный TradingView parity.
