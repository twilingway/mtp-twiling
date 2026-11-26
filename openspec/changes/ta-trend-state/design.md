# Design

## Context

База exact ef2b633, самостоятельный math-only пакет. Исходные формулы и hashes записаны в
research-checkpoint.md. Общие primitives используют na-skipping seeds; для нового пакета необходимы
явные численные recovery правила.

## Goals / Non-Goals

Goals: causal readonly bars API, aligned NumericSeries, все численные plots включая hidden
Supertrend bodyMiddle; state ledgers, отсутствие неявного future lookahead.

Non-Goals: Pine execution parity, chart integration, runtime/bundle/build изменения. DPO default не
включается при недоказанном дробном offset.

## Decisions

- SAR и Supertrend имеют локальную conservative sparse политику: неизвестный потребляемый HLC или
  непредставимая state арифметика разрывают сегмент. SAR заново seeding на второй соседней известной
  свече, Supertrend заново набирает ATR. Это явный recovery контракт, не заявка Pine gap parity.
  Сохранение stale trend через неизвестный reversal отвергнуто.
- First ATR — Wilder mean из length TR, TR первого бара сегмента high−low. Supertrend сохраняет
  явный nz(previous bands)=0 public reference state и direction +1 до previous ATR. Эти state нули
  не используются вместо неизвестных цен. Первый global бар скрыт, как builtin; локальный reset
  скрывает также первый бар новой секции.
- Для SMA/EMA используются собственные небольшие finite-safe kernels: SMA na-skipping, EMA first
  known seed, при непредставимой арифметике state сбрасывается. Иначе общие primitives допускают
  отравление seed при extreme difference. Recursive kernels не заменяются fixed lookback.
- Fisher positional extrema берутся из hl2 с partial windows; flat denominator даёт null и следующий
  recursion использует только явно заданный source nz(previous state)=0. TSI/KST unknown raw
  observations маскируют текущие outputs, внутренние filters продолжаются по documented na-skipping
  правилам.
- Metadata сохраняет researched public IDs/version/hash, пределы inputs, outputs, requiredData и
  history. DPO unresolved записан как отдельный статус с причиной, без готового computational
  preset.

## Risks / Trade-offs

- Pine na/overflow execution не измерено → отдельно указать local policies и не заявлять parity.
- DPO дробный barsback → unresolved, causal presentation contract документирован; другие пять не
  блокируются.
- Binary64 и smoothing drift → hand ledgers/invariants/overflow guards, без arbitrary precision
  обещаний.

## Migration Plan

Source-only commit. Координатор отдельно рассматривает registry/public IDs/output keys/history
fetch/native/UI/serialization. Архивация после review, вне текущего ownership.
