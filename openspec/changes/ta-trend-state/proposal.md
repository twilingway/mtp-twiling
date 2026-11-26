# Proposal

## Why

Каталог содержит шесть ещё не зарегистрированных state/trend индикаторов. Нужен независимо
проверяемый математический пакет с первичными источниками и честными границами доказанной
совместимости.

## What Changes

- Добавляются pure Supertrend, Parabolic SAR, TSI, KST и Fisher с metadata, ручными ledger тестами и
  документацией.
- DPO исследуется отдельно: нечётный default21 имеет дробный offset в Pine v6; пока conversion не
  доказан первичным источником, его preset остаётся unresolved, вычисление не выдумывается.
- Явно задаются seeds, sparse/overflow политика, history и ограничения ресурсов.

## Capabilities

### New Capabilities

- `technical-trend-state`: чистые вычисления state/trend индикаторов и статус исследованных формул.

### Modified Capabilities

Нет.

## Impact

Только новый trend-state folder, собственные tests/docs/OpenSpec. Общие
types/runtime/registry/catalog, графики, сохранения, версии и публикация не меняются. Подключение в
продукт требует отдельного review/gates.
