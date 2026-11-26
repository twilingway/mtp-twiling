# Версия 0.3.20: исходная интеграция

Ветка `feat/release-0320`, worktree `vps/artifacts/release-0320-worktree`. Проверенный исходный cut
`7095365`, build `f6f831b361430895`. Эта версия ещё не опубликована; отдельная браузерная приёмка
завершена со scoped PASS. Main0.3.19 `3be4cc44b7ae19b23cfd7b349c7ddada186a93a8` уже опубликован и
включён в ветку через docs-only merge `2f6cd5b`. Production inputs побайтно совпадают с7095365.

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

- Первый полный `pnpm check`:722/722. После Guest fix и мобильного CSS:726/726, включая build,
  TypeScript, ESLint и Prettier.
- `pnpm spec:validate`:42/42.
- Логи: `vps/artifacts/release-0320-integration-check.log` и
  `vps/artifacts/release-0320-integration-spec.log`.
- Последний полный лог: `vps/artifacts/release-0320-mobile-settings-check.log`.
- Независимое source review: `vps/artifacts/trend-0320-source-review.md`,51 focused tests PASS,
  material findings нет. Его пределы не включают Pine execution или полную tie parity.
- Первый build sandbox остановил на `spawn EPERM` для esbuild. Повтор с разрешённым запуском
  дочернего процесса прошёл без изменений исходников.

## Браузерная проверка

Отдельный worker проверяет собственные Chrome/профиль5225, без обычного Chrome и реального банка или
Google OAuth. Broad source `ef2b633` / build `e2883e84c9dbc548`: все35 добавлены через UI, шесть
новых имеют реальные нижние Canvas plots, DMI3/Aroon2/VI2 outputs; реальный Bybit. Перенос пяти
экземпляров в общую панель, порядок, collapse/visibility/sidebar не дают новых запросов истории.
Настройки/JSON import/export/reload сохраняют params/layout/provider. Native wheel и separator drag
выполнены реальной мышью в обоих движках.

Первое смешанное сравнение камеры имело разную geometry. Отдельный ограниченный случай
KLine1d→1h→1d→LW1d→KLine1d после history settle подтвердил одинаковые1241bars/last timestamp,
barSpace/rightOffsetBars/anchor и реальный pixel gap. Округление legacy offsetRight менее1px при
JSON import отмечается отдельно от нового camera model. DOM metrics не заменяли просмотр Canvas.

Найден унаследованный мобильный дефект: глобальный dialog input делал checkbox247×42, подписи стиля
обрезались. Узкий CSS7095365 фиксирует16×16 и левое выравнивание output label. Scoped rerun того же
профиля через штатную кнопку Обновить уже подтвердил RU dark/EN light375, три DMI checkboxes,
DI17/11, width3/dashed/opacity65%/color и повторное открытие. Дополнительно проверены EN dark/RU
light, desktop, сохранение -DI visibility и доступность остальных controls. Failed screenshots
сохраняются; transient loading capture13 не используется для приёмки. Все 34 captures реально
просмотрены только worker; root получил текст и пути. JS errors и HTTP≥400 не обнаружены, есть
только предупреждения о deprecated apple-mobile meta.

Native/source fixtures не заменяют browser gate. Финальный report:
`vps/artifacts/release-0320-visual-qa/report.json`. Реальные Google login/sync и bank vault здесь не
использовались. Guest bootstrap fix уже перенесён; его .19 приёмка завершена отдельным scoped
report, не выдается за повтор всех его сценариев в .20.
