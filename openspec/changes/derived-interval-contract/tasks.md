# Tasks

## 1. Исследование, текущий scope

- [x] 1.1 Проверить interval/history/client/cache/JSON границы базы dc98e376 и существующий план
      feefd45; результат и file ownership записаны в исследовании/design.
- [x] 1.2 Проверить первичные T‑Invest/Bybit/TradingView источники; ссылки, source candidates,
      anchor limitations, неполные бары и чистые OHLCV vectors записаны в исследовании.
- [x] 1.3 Подготовить отдельные proposal/design/tasks без production changes; проверить Prettier,
      строгую OpenSpec validation, локальные ссылки и diff scope перед source commit.

## 2. Предлагаемые gates перед implementation

Ни один следующий пункт не авторизует код, запрос приватных котировок или запуск браузера сейчас.

- [ ] 2.1 Согласовать schema 2 / native-only schema 1 export и availability policies; результат —
      явное решение root/пользователя и обновлённый design, до любых serializer/Timeframe changes.
- [ ] 2.2 Подтвердить Bybit native D/W/M bounds и выбранный custom UTC-day anchor; результат —
      датированные публичные API fixtures и точный предел TradingView comparison, без секретов.
- [ ] 2.3 Подтвердить хотя бы один MOEX symbol/class/date/session/source profile с boundary
      evidence, включая break/auction/вечер/выходные; иначе отметить этот profile unavailable.
      TradingSchedules alone не считается проверкой TradingView parity.
- [ ] 2.4 В отдельном implementation change обновить behavioral `candle-intervals` с сохранением
      timezone/history/camera контрактов; проверка — сценарии и строгая OpenSpec validation.

## 3. Предлагаемые пакеты реализации после gates

- [ ] 3.1 Добавить pure registry/resolver/bucket/quality contract с immutable hand fixtures из
      исследования; проверка — source typecheck и focused tests всех target, timezone invariant,
      sparse coverage, straddle rejection и overflow, документация каждого policy.
- [ ] 3.2 Подключить provider source metadata, bounded pagination/backfill и shared subscription;
      проверка — mocked REST/live/reconnect/cancellation/generation tests, source-mode isolation и
      обновлённая документация лимитов. Ни один незавершённый request не становится coverage.
- [ ] 3.3 Подключить native revision/cache invalidation и derived memo; проверка — duplicate
      snapshot, late correction с прежней длиной, clear/import/offline metadata loss, empty coverage
      fixtures.
- [ ] 3.4 Реализовать только согласованную persistence/Drive migration; проверка — прежние schema 1
      golden fixtures без изменений, derived roundtrip и атомарный отказ старого reader/unknown ID.
- [ ] 3.5 Подключить общий output к controller/двум renderers/TA/axis/countdown и favorites;
      проверка — focused integration tests плюс отдельная разрешённая визуальная проверка
      camera/history, timezone и corrected historical indicators на обоих engine; docs состояния
      поддержки.
- [ ] 3.6 Отдельно включить календарные 3/6/12М после source-label evidence; проверка — leap year,
      quarter/half-year/year boundaries, missing months и partial final period, JSON/Drive fixtures.

## Workflow follow-up

- Текущий результат — docs/spec source commit; implementation tests/browser/build не запускались.
- Нереализованные пункты остаются открытыми. Архивировать после согласованного завершения либо
  переноса gates/пакетов в отдельные changes, с сохранением evidence limitations.
