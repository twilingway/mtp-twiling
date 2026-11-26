# Design

## Context

См. proposal.md. Текущий runtime не имеет универсальных fill/offset контрактов. Все пять IDs
присутствуют в каталоге127.

## Goals / Non-Goals

**Goals:** pure API, точная builtin identity, измеримые seeds и ресурсные лимиты.

**Non-Goals:** регистрация, UI/native, persisted options, assets/build и публикация.

## Decisions

- ALMA/LSMA принимают NumericSeries; каналы — readonly TechnicalBar. Outputs aligned; Donchian
  offset остаётся metadata.
- Builtin Chandelier — highest high/lowest low плюс-минус ATR, без everget
  ratchet/direction/signals.
- Периоды1..10000, LSMA минимум2 из-за unresolved length1; вход до1000000. Прямые ALMA/LSMA
  ограничены50000000 window-products. Это локальные caps, не Pine bounds.
- Local null policy: полные contiguous окна ALMA/LSMA/SMA/RMA; EMA seed первым valid; RMA seed
  средним первого полного окна. Экстремумы доступны с первого known бара; gap сбрасывает каждый
  поток независимо. Pine sparse/startup runtime parity не заявляется.
- Monotonic extrema deques O(N), bounded SMA mean tree O(N log L), EMA/RMA O(N). Epoch reset tree
  после gap O(1), без полной очистки на каждый пропуск.
- Convex means и масштабированная регрессия предотвращают overflow representable средних;
  непредставимые final bands/projections дают null.

## Risks / Trade-offs

- [Pine runtime не исполнялся] → независимые ledgers и явный parity limit.
- [Negative display offset выглядит как future leak] → computation не сдвигается, renderer gate
  отдельно.
- [IEEE754 rounding] → finite-safe arithmetic, отдельные extreme/subnormal fixtures, без обещания
  побитовой Pine parity.
