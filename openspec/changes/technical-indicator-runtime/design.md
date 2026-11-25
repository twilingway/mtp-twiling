# Design

## Context

Существующие flags/MTP/native rendering остаются независимыми. Это общий pure TypeScript слой для
будущей интеграции, без хранения и без выполнения Pine/пользовательского кода.

## Goals / Non-Goals

**Goals:** семь реальных определений (пять новых TA и SMA/EMA), статические metadata и независимые
instance JSON v1.

**Non-Goals:** подключение UI/движков, миграция backup, исполнение всего каталога, MTP и торговые
сигналы.

## Decisions

- Metadata definitions не содержат функций. Исполнение выбирается только закрытым switch по
  definition ID.
- Strict instance validator проверяет schema/params/pane/styles, запрещает неизвестные поля и
  ограничивает размеры/числа. Параметры типов source/period отдельно от UI-подписей.
- Scalar null означает na; сглаживания игнорируют его и держат state. Runtime маскирует
  отсутствующий необходимый вход null, чтобы renderer не выдавал carry-forward за точку данных. RSI
  change сравнивает соседние строки; после разрыва новая разность не выдумывается.
- EMA стартует с первого значения, RMA с mean первых length non-null наблюдений. Flat RSI=100
  подтверждён публичным built-in STD;RSI v47.0. BB использует divisor N, ATR=RMA(true range),
  Stoch=raw %K→SMA(smoothK)→SMA(smoothD).
- Пропущенные календарные свечи не добавляются: вход — реальные упорядоченные timestamps. Явные null
  поля сохраняют свою позицию. Минимальное число наблюдений и полный lookback различаются, особенно
  EMA/MACD/Stochastic.
- Инкрементальный runtime пока исключён: пересчёт полного массива детерминирован и правильно
  учитывает историческую коррекцию.

## Risks / Trade-offs

- Reference manual загружается динамически → seeding/formula сверены по официальному JS payload и
  публичному open_no_auth builtin RSI; пути зафиксированы в docs.
- Полная Pine runtime parity на всех sparse series без запуска Pine не доказана → gap mask и спорные
  места явно описаны, независимые ручные векторы не выдаются за visual/native QA.
