# Design

## Context

База 220b227 содержит 35 computed. Math source перенесён двумя cherry-pick из 58da04e и b259447;
reviewed formula tree далее не меняется. См. proposal.md.

## Goals / Non-Goals

Цель — append-only registry и строгая сериализация. Native renderer fixtures, browser, build,
version и публикация остаются у координатора.

## Decisions

- Новые definitions используют manifest bounds/defaults и явные output keys; append после прежних35
  сохраняет order. Choice — discriminated type с readonly tuple EMA/SMA.
- Shared history union включает reviewed VolumeFlowHistoryRequirement целиком, не преобразует
  cumulative-plus-EMA в простой recursive. Warmup/history делегированы reviewed metadata.
- Runtime сначала валидирует реальные bars, затем для новых7 выполняет отдельный volume dispatch.
  Gate проверяет positive finite volume без накопления суммы и риска overflow. NaN/negative volume
  отвергаются общим validator. Нет gate для прежних35.
- Runtime сохраняет reviewed smoothing gaps и каждую длину/timestamp. Никакая общая current-field
  mask не подменяет reviewed hold semantics новых формул.
- Instance validator проверяет choice exact membership; settings сохраняют choice/source как string,
  numeric как number. Дополнительный публичный runtime metadata не попадает в instances.
- Drive allowlist получает ровно divisor/emaLength/oscillatorAverage/signalAverage. Исходные TA
  instances валидируются до проекции, чтобы extra TA params не терялись незаметно; остальные backup
  projections сохраняют прежнюю политику.
- Числа/ошибки/roundtrip и React choice проверяются source-only тестами. Никаких заявлений о
  native/browser/Pine runtime parity.

## Risks / Trade-offs

- [Отсутствующий volume создаёт математический index1000] → runtime gate возвращает11 null series и
  optional unavailableReason только новым7.
- [JS null проходит defaults reviewed math] → строгие instance/import validators не передают null в
  math.
- [Расширение choice union] → typecheck и source-only UI tests проверяют narrowing и string
  persistence.
- [Доступность всего префикса меняется после появления первого volume] → gate определяется всем
  текущим входом, как public source vendor guard; сами формулы остаются causal.
