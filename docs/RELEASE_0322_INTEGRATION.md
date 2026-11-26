# Версия 0.3.22: TSI, KST и Fisher

Ветка `feat/release-0322`, worktree `vps/artifacts/release-0322-worktree`. Source cut
`50b5873778fa442fce3266c2f9882a59d231ab38`, build `6556aedb0c5b49bb`. Эта версия ещё не
опубликована. Отдельная browser QA выполнена на собственном сервере5228.

## Вычисления и перенос

Добавлены TSI, KST и Fisher Transform: 45 вычислений, 46 доступных TA с объёмом и 50 записей
библиотеки с четырьмя MTP. Все три находятся в нижних панелях, по два ряда каждый. TSI содержит
value/signal, KST — value/signal, Fisher — value/trigger. Supertrend и SAR остаются math-only до
правильного cross/linebr/fill rendering; DPO явно unresolved, не вычисляется по угаданному offset.

Pure math49 сохранена неизменной. Независимый review регистрации2cb86e9 не нашёл blockers: 41
focused test, whole-source compiler host, lint/format и spec46 PASS. Frozen42 witness
`610fd4c860f6ccc49bc80c7f1f29651a5983d75ce2630ff565f5ed81823afc0a` независимо совпал с Git-базой.
Математические limits, sparse policy и отсутствие Pine execution parity описаны в
`TECHNICAL_TREND_STATE.md` и `TECHNICAL_STATE_OSCILLATOR_REGISTRATION.md`.

KST сохраняет девять плоских числовых параметров, массивы создаются только внутри pure-вызова. Drive
allowlist расширена ровно longLength/shortLength, четырьмя ROC и четырьмя SMA keys.
SignalLength/length использовались ранее. Строгий validator отклоняет null/unknown/arrays/extras;
result history/warmup не попадают в переносимые instance params.

Fisher length1 математически неопределён: оба ряда null, warmupBars и recursive seedBars null,
alwaysUndefined присутствует только на result. Прежние42 result shapes и policies не ослаблены.

## Чистая агрегация минут

Включён source37366ddb: чистый readonly движок1m→4/6/7/8/9/45/180 с явно переданными
sessions/anchor/open windows/asOf/coverage/finality. Он не добавляет таймфреймы в меню, provider
transport/cache/stream, enum и portable schema не менялись. Пустые buckets не создают свечей,
missing minute остаётся incomplete даже при exhaustive coverage; никакие OHLC/volume не
forward-fill. Источники/сессионные якоря MOEX/TV не угадываются.

Независимое review37366ddb:20 tests и1400-request/18838-bucket oracle PASS, blockers нет. Это
математический контракт, не доказательство provider или TradingView session parity. Документы:
`DERIVED_INTERVAL_MATH.md` и `vps/artifacts/derived-interval-math-readonly-review.md`.

## Проверки и browser gate

- Полный `pnpm check`:817/817; strict OpenSpec47/47.
- Actual native renderer suite22/22: все45 definitions и отдельная Fisher1 empty-regression обоих
  adapters без camera reset/лишних primary writes.
- Логи: `vps/artifacts/release-0322-integration-check.log` и
  `vps/artifacts/release-0322-integration-spec.log`.
- Fresh browser worker проверил реальные Bybit spot/perpetual, Canvas обоих engines, TSI31/7/11,
  асимметричные KST периоды, Fisher17/1, JSON/layout/native gestures/camera и mobile375 RU/EN
  dark/light. Source/build не редактирует; обычный Chrome/реальные ключи/Google OAuth исключены.
- Артефакты browser QA: `vps/artifacts/release-0322-visual-qa`. Локальная приёмка PASS_WITH_LIMITS:
  25 скриншотов просмотрены, JSON/reload сохраняют параметры, порядок, панели и их высоту. Google
  OAuth, реальный банковский ключ и физические телефоны не проверялись.
- При первом быстром выборе одна история появилась только после reload. Причина исторического
  эпизода не установлена; начальные response/error listeners были подключены поздно. Два
  дополнительных быстрых прогона в собственном профиле и контроль после готовности загрузили историю
  без reload. Дневные запросы отменились, часовые вернули HTTP200. Попытка автоматизации выбрать
  глубину во время загрузки остановилась на disabled select; это не ошибка загрузки данных. Через
  промежуток loading=false при смене таймфрейма select остаётся недоступным по
  historyViewReady=false. Эти наблюдения не доказывают отсутствие любой конкурентной ошибки;
  отдельное source review проверяет границы маршрутизации до публикации.

Автоматическая публикация и проверка live public обновления остаются отдельными этапами после
локальной приёмки и exact-head CI. Общая цель активна; весь каталог127 ещё не реализован.
