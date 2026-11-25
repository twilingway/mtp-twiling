# Версия 0.3.20: исходная интеграция

Ветка `feat/release-0320`, worktree `vps/artifacts/release-0320-worktree`. Проверенный исходный cut
`8bc3aa9`, build `710325f7e1074200`. Эта версия не опубликована; её браузерная приёмка ещё не
выполнялась. Публичный main остаётся0.3.18, отдельный кандидат0.3.19 проходит Guest recovery QA.

## Состав

К прежним29 вычислениям добавлены Aroon, Aroon Oscillator, DMI, ADX, Vortex и Choppiness Index.
Теперь35 вычислений,36 доступных ТА с объёмом и40 записей библиотеки вместе с четырьмя MTP.
Нереализованные алгоритмы каталога не включены. Формулы, seeds и ограничения Pine parity описаны в
`TECHNICAL_TREND_STRENGTH.md` и `TECHNICAL_TREND_REGISTRATION.md`.

Root добавил ровно два параметра `diLength` и `adxSmoothing` в строгую Drive allowlist, читаемые
RU/EN подписи и JSON/Drive roundtrip с нестандартными DI/ADX периодами. Native fixtures обоих
адаптеров охватывают все35 расчётов, их timestamps, нижние панели, отсутствие лишних primary writes
и сохранение камеры. Для CHOP length1 отдельно доказан пустой результат без подстановки нулей:
`warmupBars:null` и `alwaysUndefined:true` остаются metadata результата, не persisted instance.

Исследование `DERIVED_INTERVAL_RESEARCH.md` включено только как docs/OpenSpec proposal. Новые
таймфреймы, provider transport/cache и формат portable данных не менялись. Производные интервалы ещё
недоступны, а TradingView session parity не заявляется.

## Проверки

- Полный `pnpm check`:722/722, включая build, TypeScript, ESLint и Prettier.
- `pnpm spec:validate`:42/42.
- Логи: `vps/artifacts/release-0320-integration-check.log` и
  `vps/artifacts/release-0320-integration-spec.log`.
- Первый build sandbox остановил на `spawn EPERM` для esbuild. Повтор с разрешённым запуском
  дочернего процесса прошёл без изменений исходников.

Native/source fixtures не заменяют визуальную проверку: оба движка, нижние панели, настройки,
перенос/скрытие/сворачивание и reload этой версии должны пройти отдельный Chrome gate. Реальный
Google login/sync и bank vault здесь не использовались. Исправление Drive bootstrap blocker0.3.19
ещё нужно перенести после его приёмки; публикация0.3.20 до этого не разрешается.
