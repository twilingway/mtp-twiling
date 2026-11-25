# Регистрация силы тренда

Source worktree `ta-trend-registration-worktree` создан от `dc98e37`, ветка
`feat/ta-trend-registration`. Math commit `970242b` перенесён отдельным cherry-pick. Изменены только
TA types/definitions/runtime/catalog, новый definition файл, tests/docs/OpenSpec. Общие
native/UI/Drive/package/version и frozen .19 не меняются.

Registry содержит 35 computed, каталог 36 доступных TA с Volume, библиотека 40 доступных из 131
пунктов с четырьмя MTP. Прежние 29 определения сохраняют порядок, defaults и result shapes.
Остальные пункты каталога не объявлены реализованными.

## Определения

| definitionId     | public ID                       | Persisted defaults           | Output keys          |
| ---------------- | ------------------------------- | ---------------------------- | -------------------- |
| aroon            | STD;Aroon                       | length=14                    | up, down             |
| aroon-oscillator | STD;Aroon_Oscillator            | length=14                    | value                |
| dmi              | STD;DMI                         | diLength=14, adxSmoothing=14 | plusDI, minusDI, adx |
| adx              | STD;Average%1Directional%1Index | diLength=14, adxSmoothing=14 | value                |
| vortex           | STD;Vortex%1Indicator           | length=14, min=2             | plusVI, minusVI      |
| choppiness-index | STD;Choppiness_Index            | length=14, min=1             | value                |

Периоды целые до 10000; Vortex min=2, остальные min=1. Произвольные source/code/offset и чужие
output style keys отклоняются существующим exact-key guard. Instance validator не ослаблен и не
получил специальных permissive ветвей. Plot offset CHOP остаётся presentation-only полем
проверенного math-пакета, math/runtime его не принимает и не сдвигает series.

## Вычислительный контракт CHOP length=1

```ts
interface TechnicalIndicatorResult {
  // Existing fields omitted here.
  warmupBars: number | null;
  alwaysUndefined?: true;
}
```

Null означает, что никакое число наблюдений не даст finite output для этих параметров. CHOP length=1
— корректный persisted instance с params `{ length: 1 }`, но формула имеет log10(length)=0. Runtime
возвращает status=computed, all-null value, warmupBars=null и alwaysUndefined=true даже на пустой
истории. На других параметрах CHOP и на прежних 29 results alwaysUndefined вообще отсутствует;
false/undefined own-property не добавляется.

Это не новая schema instance. Поля warmupBars/alwaysUndefined запрещены на верхнем уровне instance и
в params; результат расчёта не записывается вместо переносимых параметров. Список instances с CHOP
length1 валиден, source JSON сохраняет его без выдуманного warmup 1. При других данных all-null
серия сама по себе не означает alwaysUndefined: например, холодный DMI или неизвестный нулевой TR
остаются обычными результатами с численным warmup.

## History и сохранённая математика

Aroon использует n+1 recency window и частичное начальное окно: warmup 1 при finite lookback 15 для
default 14. Up и Down маскируются независимо, так что known low не теряется из-за missing high.
Выбор наиболее свежего равного экстремума остаётся явно локальной политикой; Pine tie/cold execution
parity не заявлена.

DMI/ADX имеют отдельный DI length и ADX smoothing. Defaults дают DI после 15 баров, ADX после 28.
History recursive/full-input-dependent, seedBars=diLength+adxSmoothing,
seedPolicy=adjacent-change-wilder. Это reviewed Wilder/SMA seed pipeline со строгим first TR и
fixnan; обычный EMA seed вместо него не подставляется. Отдельный ADX возвращает ту же ADX линию, что
и DMI.

Vortex default 14 имеет warmup 15/lookback 15. CHOP default 14 имеет warmup 14/lookback 15:
предыдущий close нужен для старого TR полного окна, хотя ATR1 first-range fallback позволяет
показать первую точку уже на 14 барах. CHOP length=1 сохраняет finite history descriptor, но null
warmup и explicit flag честно сообщают о постоянной неопределённости. CHOP выше 100 на реальном
price gap не обрезается. Все остальные seed/gap/overflow пределы описаны в
`TECHNICAL_TREND_STRENGTH.md`.

Явный third-argument HV TechnicalCalculationContext не изменён. Годовой масштаб HV не появился в
persisted params и не стал обязательным для остальных 34 определений.

## Проверки и граница интеграции

`test/technical-trend-registry.test.mjs` проверяет defaults/order/result shape всех старых 29,
golden numeric runtime новых шести, nullable metadata CHOP1, finite/recursive history, strict
bounds/source/code/styles, exact public IDs/search aliases, JSON и real gaps/causality.
Manual/source JSON roundtrip проверен для всех шести customized instances, включая CHOP1. Текущий
Drive sanitizer проверен для четырёх shapes, использующих прежний length key.

Root должен добавить **ровно diLength и adxSmoothing** в Drive params allowlist при .20 интеграции;
DMI/ADX roundtrip после этого проверяется полностью. Сам Drive в этом source commit не изменён и
нельзя считать его полную проверку завершённой здесь.

Root также обновляет native 35 fixtures и отдельно проверяет оба renderer/browser. Общий output
contract готов; native/UI/runtime приложения не запускались. Source TypeScript, scoped ESLint/
Prettier, strict OpenSpec и focused tests выполняются без build/server/browser/push/merge/deploy.
