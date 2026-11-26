# Design

## Context

См. proposal. База7cc9df9 содержит47 computed TA. Reviewed math780e9c5 standalone: ALMA/LSMA direct
work<=50M и все новые kernels bars<=1M. Существующий result уже имеет transient unavailableReason
для volume.

## Goals / Non-Goals

Три регистрации и точный preflight без изменения pure math. Native renderer/DB schema/G5/KC
boolean/choices/DC display offset/релиз исключены.

## Decisions

- Math package переносится byte-identical; три отдельные registration modules: contract,
  definitions, runtime. Shared registry append-only, прежние47 не получают metadata changes.
- Cost helper O(1) использует barCount/params и reviewed constants. Runtime возвращает computed
  container с unavailableReason calculation-limit и dense null arrays/всеми timestamps. Это не
  warmup и не fake quotes. Catch-all исключён: malformed inputs продолжают отклоняться.
- Тот же helper даёт RU/EN status в legend/settings без тяжёлого повторного calculation. Settings
  оценивает текущие введённые valid params; доступность восстанавливается после setData/params
  change. Cache по params очищается при setData как прежде.
- ALMA fixed close; LSMA selector пользуется существующими sources и causal formula offset. CE два
  независимых stops; gap/history contract адаптируется явно из math metadata.
- V1 allowlist расширяется только offset/sigma. floor/series/status/reason не становятся instance
  fields.

## Risks / Trade-offs

LSMA length1 unresolved → локальный min2 с явным пояснением. Работа<=50M всё равно синхронна → caps
и bounded runtime tests не объявляются frame budget. Native-price scaling и browser нужны root после
независимого source review.
