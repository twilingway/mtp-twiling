# Design

## Context

Замороженная основа `6d5fbbf` содержит семь зарегистрированных индикаторов и primitive EMA/RMA.
Мотивация и границы приведены в proposal.md; общие registry/runtime принадлежат координатору.

## Goals / Non-Goals

**Goals:** чистые independently callable функции, единые nullable inputs, самостоятельные fixtures,
metadata без executable callbacks и без изменения существующего union ID.

**Non-Goals:** UI/native интеграция, все встроенные индикаторы, Pine execution и платформенная
parity.

## Decisions

- Новые функции лежат в `averages/`; `averages/index.ts` является отдельной точкой импорта.
- DEMA/TEMA используют существующий first-value EMA; промежуточный carried EMA на null остаётся
  входом следующей ступени согласно композиции опубликованных формул. Только финальный выход
  маскируется по исходному source. SMMA отдельно повторяет опубликованную рекурсию: если previous
  null, взять SMA, иначе recurrence с alpha=1/length. Null source сбрасывает recurrence; следующий
  бар пересеивается SMA. При последовательных null внутренний seed может появиться на втором gap,
  согласно literal branch; внешний output всегда маскируется. RMA primitive не изменяется.
- WMA/VWMA выбирают последние length валидных наблюдений; gap не потребляет окно и выводит null.
  VWMA использует только совместно доступную пару source/volume, чтобы не смешивать два разных окна.
  Это явный локальный контракт sparse данных, а не обещание полного Pine plotting parity.
- HMA использует оригинальную формулу Alan Hull: floor(n/2), floor(sqrt(n)), минимум один. Публичный
  built-in HMA v28.0 подтверждает floor sqrt и использует length/2 в half window без отдельного
  cast. Усечение half опирается на original Hull Integer, Pine runtime не запускается.
- Оконные суммы вычисляются после нормализации по масштабу цен/весов: это предотвращает лишний
  overflow промежуточного price×weight и price×volume. Выход за числовой диапазон даёт null. WMA
  использует weightedNew=weightedOld−sumOld+length×new, VWMA — rolling numerator/denominator.
  Компенсированные суммы и ring buffer дают обычный O(bars), память O(length). Раз в length валидных
  наблюдений суммы перестраиваются за O(length), амортизированная сложность остаётся линейной. При
  выпадении доминирующего масштаба более чем в миллион раз разрешён дополнительный защитный rebase.
  Monotonic deque отслеживает максимум без сканирования каждого окна. Независимые price/volume
  scales иногда могут underflow при представимом результате; для таких крайних окон VWMA имеет
  отдельный O(length) fallback по масштабу взвешенных произведений.
- Metadata использует существующий TechnicalHistoryRequirement, но отдельный ID union и immutable
  presets. Finite lookback описывает минимальное число наблюдений без gaps.

## Risks / Trade-offs

- [Различия HMA между платформами] → явно публикуются floor convention и отсутствие runtime parity.
- [Sparse VWMA Pine SMA composition может выбирать разные окна] → локальное pairwise правило явно
  записано, нулевой объём не исключается и не заменяется.
- [Рекурсивные значения зависят от seed] → metadata не выдаёт minimum warmup за convergence.
- [Длинные окна] → deterministic budget проверяет 100000 баров/период10000, периодические rebase и
  обычный линейный путь; крайние числовые масштабы покрываются отдельными ledger fixtures.
