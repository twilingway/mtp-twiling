# Spec Delta

## Purpose

Подключать шесть проверенных расчётов силы тренда к общим определениям и переносимым экземплярам,
честно отражая математически неопределённые параметры без изменения прежних результатов.

## ADDED Requirements

### Requirement: Шесть строгих определений

Registry SHALL содержать 35 computed определений, добавляя Aroon, Aroon Oscillator, DMI, ADX, Vortex
и CHOP после прежних 29. Каталог SHALL связывать точные public IDs с реальными вычислениями,
сохраняя прежние defaults и порядок. Неизвестные aliases SHALL не считаться отдельными реализациями.

#### Scenario: Поиск новых определений

- **WHEN** открыт RU или EN каталог и выполнен поиск Aroon/DMI/ADX/VI/CHOP
- **THEN** соответствующие реальные public IDs доступны среди 36 TA пунктов вместе с Volume

### Requirement: Nullable warmup только вычислительного результата

CHOP length1 SHALL оставаться валидным instance с null во всех выходных точках, warmupBars=null и
alwaysUndefined=true в вычисленном результате. Ни одно количество истории SHALL не объявляться
достаточным для finite output этих параметров. Другие результаты SHALL сохранять численный warmup и
не иметь alwaysUndefined поля.

#### Scenario: Корректный CHOP length1

- **WHEN** пустая или непустая история рассчитана для CHOP length1
- **THEN** status=computed, warmupBars=null, alwaysUndefined=true, а series сохраняет длину и null

#### Scenario: Результат не является instance

- **WHEN** alwaysUndefined или warmupBars переданы в сериализуемом instance
- **THEN** строгая проверка отклоняет неизвестные поля

### Requirement: Проверенные численные ветви

Runtime SHALL сохранять n+1 окно Aroon, строгий первый TR и Wilder/fixnan pipeline DMI/ADX, ATR1
Vortex/CHOP и log CHOP без произвольного clamp. History SHALL отличать finite lookback от полной
зависимости Wilder seed. Явный third-argument HV context SHALL оставаться обязательным только для
HV.

#### Scenario: Ручной DMI ledger

- **WHEN** DI length2 и ADX smoothing2 применены к проверенному OHLC ledger
- **THEN** DI и ADX совпадают с ручными рациональными значениями, без first-bar fallback DMI

### Requirement: Переносимые строгие параметры

Все шесть instances SHALL проходить source JSON roundtrip с точными параметрами и output styles.
Неизвестный source/code, неверные bounds и чужие выходы SHALL отклоняться. Расширение Drive
allowlist SHALL оставаться отдельным шагом координатора с двумя точными ключами.

#### Scenario: Передача координатору

- **WHEN** source commit передан на .20 интеграцию
- **THEN** указаны pending diLength/adxSmoothing Drive keys и отсутствие native/browser проверки
