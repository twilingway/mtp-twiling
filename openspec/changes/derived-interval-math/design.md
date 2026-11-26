# Design

## Context

См. proposal.md и `docs/DERIVED_INTERVAL_RESEARCH.md`. Это независимый source-only пакет; нынешние
общие Candle и Timeframe не используются. Root подтвердил API и консервативную трактовку пропусков.

## Goals / Non-Goals

**Goals:** readonly typed API, runtime guards, deterministic OHLCV, observable quality evidence.

**Non-Goals:** часы, DOM, сеть, провайдеры, календарь MOEX, TV parity, месяцы, persistent schema,
cache/stream/UI интеграция и изменения product runtime.

## Decisions

- `aggregateDerivedMinutes` принимает targetMinutes 4/6/7/8/9/45/180, source только `1m`, asOf,
  supplied sessions, coverage и readonly bars с explicit finality. Неизвестные sessions — typed
  error.
- Session задаёт `[start,end)`, anchor не позже start и sorted disjoint open windows. Сетка
  wall-clock от anchor; clipping только supplied session boundaries. Перерыв не сбрасывает сетку.
  Отдельные sessions позволяют caller явно выбрать reset. Никаких встроенных биржевых знаний.
- Только buckets с реальными bars. Expected/coverage считаются пересечениями интервалов, не обходом
  пустых минут. Input arrays строго упорядочены; вместо скрытого sorting/dedup — ошибка.
- Coverage spans disjoint, sorted, minute-aligned: exhaustive/partial/unknown. Неуказанные минуты
  unknown. Missing source minute всегда incomplete; отсутствует no-trades evidence. Finality unknown
  не становится final. Open status имеет приоритет, подробные счётчики остаются доступны.
- asOf — явный safe integer instant; future starts и final bars с end > asOf отвергаются. Forming
  snapshot текущей минуты допустим, finality не выводится из времени.
- Локальные лимиты входов и session span защищают ресурсы, не описывают provider API limits. Checked
  timestamp arithmetic и volume sum не допускают unsafe integer/Infinity.

## Risks / Trade-offs

- Редкие торги дают incomplete даже после exhaustive ответа → будущий отдельный no-trades evidence
  контракт; сейчас это безопасная консервативная оценка.
- Ошибочная supplied policy даёт математически корректный чужой anchor → проверка provider/session
  provenance остаётся обязательным root integration gate.
- Нет persistence metadata → этот пакет не поднимает native cache до complete.

## Migration Plan

Нет миграции и runtime wiring. Root review и cherry-pick source commit отдельно; архивирование после
интеграционного решения. Откат — удалить независимый пакет без изменения пользовательских данных.
