# Design

## Context

Base f889aebb14b9b330913a73595aed11c39b7e5fcd. Все изменения — новые paths. Public wrappers
закреплены metadata-only capture; код Pine не сохраняется. Внешний Pine execution отсутствует.

## Goals / Non-Goals

Полные чистые numeric outputs пяти wrappers; строгие типы и независимые oracles. Без shared
registry/UI/persistence/native изменений и без заявления runtime parity.

## Decisions

- Общая арифметика mantissa/exponent сохраняет представимые отношения при переполнении промежуточных
  разностей/произведений и subnormal масштабе. Окна — bounded segment tree с mean, weighted mean и
  population variance: O(N log L), память O(L).
- SMA/WMA/stddev и rolling sum используют последние L известных наблюдений, EMA first-known seed,
  RMA L-known SMA seed; null не вставляется и после готовности переносит состояние. SWMA —
  позиционные четыре бара с весами 1,2,2,1 и null propagation. ROC и change обращаются к точным
  индексам.
- Stoch extrema используют частичное окно по позициям bars и игнорируют null. Это явная локальная
  policy; конфликт startup текста official manual и отсутствие Pine oracle оставляют parity gate
  открытым. Flat denominator — null; RSI all-flat — null. Старые kernels не меняются.
- Offsets — только metadata; массивы не сдвигаются. Vigor offset относится к обоим plots, Volatility
  offset только к value. BB/MA rows всегда присутствуют, отключённые — null.
- Volatility volume требуется только для VWMA; numerator/denominator SMA независимы, согласно
  композиции primitives. Bull/Bear — один SUM plot; внутренние bull/bear не становятся
  дополнительными outputs.
- Локальные caps: 1M bars, length 1..10000, 80M оценочных tree/constant visits на kernel. Это не
  performance SLA устройства и не Pine input bounds.

## Risks / Trade-offs

Pine execution seed/NA/startup и float tolerances не измерены. Primary wrapper определяет формулу,
но не доказывает private runtime primitives. Численно устойчивые перегруппировки отличаются
последними битами от последовательной double арифметики. Реальные missing quotes остаются null;
skip-NA фильтры могут переносить законное предыдущее значение.

## Validation

Ручные RSI/SWMA/ROC/WMA/stddev ledgers, независимые прямые oracles на коротких рядах,
sparse/gaps/flat/reversal, prefix/append/correction, потребляемые поля, volume, max/subnormal и
caps. Whole-source noEmit с виртуальными только двумя version exports, scoped lint/format, strict
OpenSpec; старое дерево math byte-identical base.

## Open Questions

До будущей регистрации нужны Pine execution fixtures для stoch partial/full startup, sparse NA,
all-flat RSI и точных EMA/RMA seeds. Эти вопросы не маскируются как доказанная parity и не меняют
локальный явный контракт этого math-only пакета.
