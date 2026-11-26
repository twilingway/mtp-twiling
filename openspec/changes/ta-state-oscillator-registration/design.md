# Design

## Context

Exact base5d569c3 содержит42 computed; reviewed math49 cherry-picked без изменения чисел. Canonical
specs содержит только drawing-editing; новая capability фиксирует integration contract.

## Goals / Non-Goals

Goals:45 computed/46 available TA/50 library; flat schema inputs;2 lines для каждого; прежние42
неизменны по независимому Git-derived hash.

Non-Goals: Supertrend/SAR registration, DPO implementation, renderer changes,
version/build/browser/publish.

## Decisions

- Definitions append-only, existing exact instance validator автоматически проверяет новые
  параметры/outputs/styles. Изменение старого validator без выявленной ошибки не требуется.
- KST persisted9 scalar lengths, tuples собираются только при вызове math. TSI25/13/13, Fisher9.
- Новый StateOscillatorHistoryRequirement — finite KST
  known-observation-window/exact-after-dense-lookback; recursive TSI first-known-ema-chain seed2;
  recursive Fisher partial-extrema-explicit-previous-state-nz seed2|null. Нормализация проверяет
  reviewed metadata и возвращает literal union без arbitrarystring/cast. Старый recursive union
  сохраняется отдельным alias, без расширения допустимых seeds старых индикаторов.
- Early runtime dispatch после общей валидации возвращает exact pure49 outputs, не накладывая новый
  HLC mask на Fisher trigger или TSI/KST. Fisher1 добавляет только result
  warmup=null/alwaysUndefined=true.
- Drive allowlist расширяется ровно longLength/shortLength/roc1..4Length/sma1..4Length;
  metadata/series не входят в schema. Root validator проверяет raw данные до projection.

## Risks / Trade-offs

- Nullable Fisher seed в общем type может выявить неявные consumer assumptions → полный source
  compiler host без подавления diagnostics.
- Sparse/overflow политика pure49 локальная → runtime не меняет её, ограничения сохраняются в docs.
- Настройки без browser → actual onSubmit/root validator тестируются source harness, native/browser
  остаются root gates.
