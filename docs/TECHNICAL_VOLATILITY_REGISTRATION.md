# Регистрация волатильности и импульса

Source-пакет от `6d33e1d`, ветка `feat/ta-volatility-registration`. Math-пакет предварительно
перенесён из `e5e8814` отдельным cherry-pick. Регистрация содержит 29 computed определений, 30
доступных TA пунктов с Volume, 34 доступных из 131 пункта библиотеки с четырьмя MTP. Другие TA
пункты не объявлены реализованными.

## Определения и параметры

| definitionId          | public ID                      | Persisted defaults                                                                |
| --------------------- | ------------------------------ | --------------------------------------------------------------------------------- |
| bollinger-percent-b   | STD;Bollinger_Bands_B          | length=20, multiplier=2, source close                                             |
| bollinger-bandwidth   | STD;Bollinger_Bands_Width      | length=20, multiplier=2, source close, expansionLength=125, contractionLength=125 |
| historical-volatility | STD;Historical_Volatility      | length=10                                                                         |
| awesome-oscillator    | STD;Awesome_Oscillator         | пустые params, фиксированные HL2 и периоды 5/34                                   |
| balance-of-power      | STD;Balance%1of%1Power         | пустые params                                                                     |
| cmo                   | STD;Chande_Momentum_Oscillator | length=9, source close                                                            |
| ultimate-oscillator   | STD;Ultimate_Oscillator        | fastLength=7, middleLength=14, slowLength=28                                      |
| trix                  | STD;TRIX                       | length=18, фиксированный close                                                    |

Все периоды — целые 1..10000, multiplier новых Bollinger производных — 0.001..50. Source доступен
только у %B, BBW и CMO. У HV/TRIX source фиксирован на close, а AO использует HL2. AO/BOP не
принимают искусственные length/source параметры. Старые Bollinger Bands сохраняют прежние bounds
multiplier 0..100; это не меняет проверенные bounds новых производных.

BandWidth возвращает `value`, `highestExpansion`, `lowestContraction` с отдельными styles. AO
возвращает `value` типа histogram; остальные новые выходы типа line. TRIX сохраняет проверенный log
EMA delta×10000. Дополнительная signal line не выдумывается.

## Явный HV context

```ts
interface TechnicalCalculationContext {
  readonly historicalVolatilityPeriodsPerYear: number;
}

calculateTechnicalIndicator(instance, bars, {
  historicalVolatilityPeriodsPerYear: 365
});
```

Тип экспортируется из TA `types.ts` и общего `index.ts`. Третий аргумент optional для сохранения
прежнего API других индикаторов. Для HV он обязателен: undefined/null/пустой объект, NaN, Infinity,
ноль, отрицательное число или строка вызывают RangeError. Сам runtime не выводит таймфрейм из
timestamps и не выбирает константу за caller.

Подтверждённый public built-in использует 365 для intraday или ровно 1D, 365/7 иначе. Выбор по
текущему timeframe делает интеграционный слой координатора. Persisted params HV содержат только
length: один и тот же JSON instance применяется на разных таймфреймах с разным context. Поля
periodsPerYear/context в params либо на верхнем уровне instance отклоняются общим валидатором. Сам
context и bars не мутируются. Warmup и history не требуют annualization для своего расчёта.

## Совместимость и граница wiring

Новые определения добавлены после прежних 21. Их порядок и defaults не меняются. TA instance
schemaVersion остаётся 1; миграция старых profiles не требуется. Generic instance validation
использует definitions и прежний exact-key механизм; специальных permissive ветвей не добавлено.

Ровно три новых persisted ключа требуют расширения существующего Drive allowlist: `expansionLength`,
`contractionLength`, `middleLength`. Они не подменены неоднозначными aliases к signalLength/smoothK.
Координатор владеет этим расширением и полной Drive roundtrip проверкой; в данном worktree Drive не
изменён. Source/manual JSON roundtrip проверен для всех восьми, текущий Drive sanitizer проверен для
остальных шести shapes без этих новых ключей.

Подключение context к TechnicalRenderData и обоим adapters также принадлежит координатору. Общие
series/definition outputs подготовлены; native paint, UI и browser этим source commit не
проверялись. Нельзя считать доступность HV в конечном приложении подтверждённой до передачи context
из обоих renderer callers.

Формулы, seed, sparse/overflow ограничения и первичные источники описаны отдельно в
`TECHNICAL_VOLATILITY_MOMENTUM.md`. Pine execution parity не заявляется.

## Проверки

`test/technical-volatility-registry.test.mjs` содержит реальные numeric ledger всех восьми, BBW3
outputs, HV context guards/scales, warmup/history, strict bounds/source/unknown-field guards, старые
defaults/order, manual JSON и частичный текущий Drive roundtrip. Также проверяются прежние core,
average/momentum registry, actions/library и portable-provider tests. TypeScript, scoped
ESLint/Prettier и strict OpenSpec validation запускаются без build/server/browser.
