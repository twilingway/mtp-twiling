# Версия 0.3.22: TSI, KST и Fisher

Ветка `feat/release-0322`, worktree `vps/artifacts/release-0322-worktree`. Финальный source cut
`5d3e2e00699c1bfe5d8294c59ead27a343a17289`, build `59e00dca6d4d2d16`. Ниже локальная приёмка;
exact-head CI, автоматический deploy и public PWA update подтверждаются отдельно после PR9.

## Вычисления и перенос

Добавлены TSI, KST и Fisher Transform: 45 вычислений, 46 доступных TA с объёмом и 50 записей
библиотеки с четырьмя MTP. Все три находятся в нижних панелях, по два ряда каждый. TSI содержит
value/signal, KST — value/signal, Fisher — value/trigger. Supertrend и SAR остаются math-only до
правильного cross/linebr/fill rendering; DPO явно unresolved, не вычисляется по угаданному offset.

Математический пакет49bfcf7 сохранён неизменным. Независимый review регистрации2cb86e9 не нашёл
blockers: 41 focused test, whole-source compiler host, lint/format и spec46 PASS. Frozen42 witness
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

## Исправления, выявленные при приёмке

- Period/pane-only submit больше не материализует отсутствующие output styles. Sparse/legacy записи
  сохраняются точно; только изменённый output получает полный явный стиль. Ручной цвет, совпавший с
  default, остаётся ручным. Независимый review8138:25 focused tests и4 actual action probes PASS.
  См. `TA_SETTINGS_STYLE_PRESERVATION.md`.
- Быстрые независимые symbol/TF/engine intents объединяются перед commit, одинаковое поле получает
  последнее значение. Сохранение старой камеры предшествует изменению preferences. Reload атомарно
  устанавливает historyViewReady=false, поэтому выбор глубины не отменяет запуск новой истории во
  время сохранения настроек. Network не удерживает очередь critical work.
- Sticky owner/client/revision/import/depth guards сохраняются между ожиданиями. Отмена отдельного
  depth intent не поглощает независимый valid forceReload intent. После carry перечитываются свежие
  nonrouting preferences. Уже committed camera key не удаляется при позднем действии. Независимый
  follow-up reviewfa996: исходные11 probes и7 дополнительных PASS; авторские19 routing, прежние8
  depth и11 lifecycle PASS. См. `CONTROLLER_PREFERENCE_ROUTING.md`.

## Финальные проверки и browser gate

- Полный `pnpm check`:842/842; strict OpenSpec49/49.
- Actual native renderer suite22/22: все45 definitions и отдельная Fisher1 empty-regression обоих
  adapters без camera reset/лишних primary writes.
- Логи: `vps/artifacts/release-0322-final-integration-check.log` и
  `vps/artifacts/release-0322-final-integration-spec.log`. Первый sandbox build завершился
  spawnEPERM; тот же scoped check без изменения кода прошёл в разрешённой среде.
- Fresh browser worker на финальном source/build: PASS_WITH_LIMITS, просмотрены24/24 screenshots.
  Реальные Bybit Spot/Linear BTCUSDT, оба Canvas, быстрый startup/TF/engine/instrument switch без
  recovery reload; depth365→5→365 сохраняет camera при неизменной области графика.
- Actual settings UI сохраняет absent/sparse styles и manual default color; JSON/IndexedDB,
  группировка/высота/порядок/collapse панелей, рисунок и reload проходят. Fisher1 пуст в обоих
  engines,17 восстанавливается. Mobile375 RU/EN dark/light и checkbox16×16 проходят.
- LW reload сохранил camera точно. KLine сохранил шаг8.8 и временной якорь; ширина plot913→940 из-за
  native оси изменила rightOffsetBars33.5909→35.0682, то есть адаптацию на половину ширины. Exact
  right-gap equality доказана для depth checks с одинаковой plot width.
- Артефакты: `vps/artifacts/release-0322-fixed-visual-qa/{report,manifest,isolation-audit}.json`.
  Ошибок приложения/Bybit нет, две deprecation warning. Own Chrome/server5230/9332 закрыты, порты
  ECONNREFUSED; чужие процессы/обычный Chrome сохранены. Parent image delta0, worker24; это
  structural audit, не измерение сетевых bytes.

Предыдущий source50b5873/build6556 имел25-image baseline gate в
`vps/artifacts/release-0322-visual-qa`. При первом выборе история появилась после reload; причина
этого исторического эпизода не установлена. Source regressions доказаны отдельно и не объявляются
автоматически причиной того browser эпизода. Финальная fresh приёмка recovery reload не использует.

Ограничения: desktop Chrome responsive emulation, физический touch/PWA install/реальный Google
OAuth/банк/private profile не проверялись. GIS SDK loading не считается входом Google. Полный
native45 matrix остаётся также в source tests; эта fresh browser matrix нацелена на routing/style
исправления и не выдаётся за повтор всех формул или Pine execution parity.

Автоматическая публикация и live public PWA update — отдельные gates после локальной приёмки и
exact-head CI. Общая цель активна; весь каталог127 ещё не реализован.
