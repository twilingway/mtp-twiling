# Proposal

## Why

Пять builtin-индикаторов каталога пока не имеют отдельного проверенного математического пакета.
Нужны чистые kernels и первичные свидетельства до регистрации и UI.

## What Changes

- Добавить Stochastic RSI, Relative Vigor Index, Relative Volatility Index со всеми MA/BB outputs,
  Coppock Curve и суммарный Bull/Bear Power.
- Закрепить verified-TLS metadata/SHA wrappers, локальные границы, NA/startup policy и пределы
  доказанной parity.
- Проверить ручные ledgers, независимые oracles, причинность, экстремумы и ограниченную стоимость.

## Capabilities

### New Capabilities

- `relative-oscillator-kernels`: чистые численные ряды пяти относительных осцилляторов.

### Modified Capabilities

Нет.

## Impact

Только новый каталог `relative-oscillators`, собственные tests/docs/OpenSpec. Без изменения shared
types, регистрации, UI, сохранений, native adapters, зависимостей и старой математики.
