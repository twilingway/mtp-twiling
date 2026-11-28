# Проверки эксперимента

- Baseline: artifacts/mtp-worker-raster-benchmark/report.json. Реальные Bybit BTCUSD 1h, 5425
  свечей, 151 период, 18 одинаковых SHA и начальных камер, reset/update в замере 0.
- Desktop draw p95: Fit 19,2 мс; вертикальный масштаб 22,1 мс; pan 17,5 мс. CPU ×4 — отдельная
  эмуляция: MTP занимает 67–77% конкретной растровой длинной задачи и 11,78% sampled non-idle
  времени полного контрольного сценария. Это не замер физического телефона.
- Worker unit 16/16; исходный raster cache 9/9; остальные scoped baseline 25. TypeScript, scoped
  ESLint/Prettier и strict OpenSpec — PASS.
- Independent review закрыл: неограниченный import; промежуточный backing 64 МиБ; повторную тень при
  blit; проверены индивидуальная sampling phase, exact-range, actual-draw key и cleanup.
- Fit readiness: 12 unit PASS; отдельное ревью исправления сброса settle-счётчика после pending —
  PASS.
- Первый candidate optimized build: 0.3.47/cfacb89f57fe12bd, 98 assets, локальный порт 5299. Для
  сборки явно задан MTP_EXPERIMENTAL_RASTER_WORKER=1; значение не входит в buildId и фиксируется
  отдельно.
- В предыдущих dev-сборках режим выбирался ?mtpRaster=worker или ?mtpRaster=native, production
  выключал эксперимент. Эти измерения предшествуют решению включить ленивый auto после проверки.
- Первый A/B подтвердил actual Worker runtime и нулевую разницу RGBA с direct paint, но выявил
  регрессию жестов из-за полного snapshot каждый redraw и feedback ответов. При CPU ×4 cold Fit main
  cache max сократился со 106–126 до 3,5–5,3 мс; вертикальный жест вырос примерно со 120 до 430 мс
  main cache total. Этот вариант не принят для включения по умолчанию.
- Второй вариант: perf/mtp-worker-gesture, optimized build 0.3.47/a246a87eda1672c8, 98 assets,
  локальный порт 5300, тот же явный experimental build flag. Source frozen для Desktop/Phone A/B.
- V2: 25 worker + 9 cache + 7 projection + 12 interaction unit PASS; camera fixtures 14/14,
  TypeScript/ESLint/Prettier/strict spec PASS. Независимо перепроверены one-shot force и kinetic
  idle tracker, включая смену камеры до ответа и движение между timer/confirming draw.
- V2 A/B выполняется; численный выигрыш пока не заявлен. Телефон перед запуском оказался включён,
  разблокирован, Chrome Main на переднем плане; проверка идёт в отдельной dev-вкладке.
- Телефон при baseline был заблокирован PIN; его состояние не меняли.

## Итоговые dev-проверки

- Общая локальная ветка feat/mtp-worker-final-integration: 0.3.47/f207b1dd0b6e3baa, порт 5301,
  experimental build flag=1, Worker включается только через ?mtpRaster=worker. Основной сайт не
  публиковался; рабочие данные телефона не изменены.
- Полный V2 Desktop: artifacts/mtp-worker-raster-benchmark/candidate-v2/report.json. Все 42 проверки
  реальных данных, камеры, Y-проекции и priceFormat совпали. Worker, native cache и direct paint
  имеют 0 отличий RGBA. Во время held жеста 0 jobs/snapshots/пустых кадров, после idle 1 exact job.
- Desktop CPU ×4: MTP cache pan 80–83 → 27–29 мс total; чередующийся контроль RAF p95 36,5/36,4 мс,
  общего роста FPS не заявляем. Есть задержки ввода вне измеренного MTP-кеша.
- Физический M2101K6G: artifacts/mtp-worker-phone-v2/manifest.json. Вертикальный жест: cache max
  примерно 40 → 9–14 мс, RAF p95 44–60 → 34–37 мс. 134 Worker frames без пустого слоя. Общее время
  Fit не доказанно быстрее; горизонтальный Android OS gesture не дал валидного continuous pan и
  исключён без атрибуции разрыва приложению. Производственная вкладка VTBR восстановлена точно.
- Final V3: artifacts/mtp-worker-raster-benchmark/candidate-v3/report.json. Два actual held жеста с
  повтором последней реальной свечи: SHA не меняется, bitmap остаётся открытым/видимым, 0 jobs при
  удержании, после idle 1 exact новой revision. Performance повторно не измерялся; protocol/paint не
  менялись, unchanged fast path сохраняет одну сериализацию.
- Центрирование загрузки: artifacts/mtp-watchlist-loader-center-review/candidate-smoke.json.
  Реальная сборка 5301 без CSS injection: desktop/mobile, обе темы, loading/error/Retry и короткая
  панель проверены визуально; центр группы 0/0 px, обрезания нет.
- Финальная сборка/typecheck/format/lint проходят, strict OpenSpec 134/134. Полный тестовый прогон:
  2605 PASS, 1 устаревший layer-order fixture не имел непустых данных, 4 optional SKIP. Fixture
  исправлен без изменения assertions и отдельно перепроверен: node test/mtp-layer.test.mjs — 1 PASS.
  Полного повторного прогона после этого единственного test-only исправления не было.

## Выпуск с ленивым AUTO

- `cf95134`: автоактивация по первому тяжёлому поддерживаемому LW-кадру. Независимо 31 worker + 9
  cache tests PASS. Начальные disabled/light/native-override состояния не запускают Worker.
- Реальный plain-URL AUTO smoke `4ae04bd329283b05`: 1/6/16 owners/bitmap, resize и 16→1 cleanup
  проходят; нативные контроли дают 0 Worker. Однако длинный pan выявил 18/22 пустых held кадров (не
  менее 2,07 с), тогда как native имел 0/22. Этот вариант не принят для выпуска.
- `4112a56`, build `b69bdf9e23e27054`: safe clipped preview и bounded refill устранили исчезновение
  слоя. Натуральный pan повторяет камеру baseline; 1-bar/pan/reversal/vertical дают 79 held draw
  frames, 0 пустых. Refill: максимум 1 job, минимальный фактический интервал 181,1 мс при лимите 150
  мс; native MtpModel.draw 0. Данные SHA совпали, итоговая revision актуальна, pending false.
  Дополнительный resize 6/16 и cleanup 16→1 прошли. Но после idle/replay свечи найдены 2 пустых main
  frames на 17 мс; этот переход потребовал отдельного исправления.
- `a18a8fe`, build `eaefb7a24e3c6ca8`: same-hard soft-tail preview сохраняется и между жестами до
  нового exact blit; hard guards, full content key и pending не ослаблены. Автор: 42 worker tests,
  TS/lint/format PASS. Независимо проверены 3 целевых теста settled soft/hard/unchanged metadata.
- Артефакты: `artifacts/mtp-worker-raster-benchmark/release-auto-4ae04bd329283b05` и
  `release-auto-b69bdf9e23e27054`; PNG просмотрены только в изолированном UI-агенте.
- Телефонный plain-URL AUTO `4ae` подтвердил реальный запуск и видимый слой. ADB оборвался до
  формального Fit/axis повтора; этот запуск не добавляет нового жестового performance-замера.
  Удалённая очистка тестовой вкладки не подтверждена; локальные подключения закрыты.

Последующий narrow smoke `eaef` подтвердил 65/65 painted main frames при held→idle и settled
same-close replay (0 пустых), но расширенный горизонтальный burst выявил новый предел покрытия.
Touchpad deltaX ±1400, 12 событий с интервалом 8 мс, сдвигает реальный viewport больше чем на экран:
9/23 пустых кадров без screencast, 14/29 в визуальном повторе. Старый bitmap остаётся открытым, но
безопасный clip пуст; кадры 03/04/06 показывают исчезновение/возврат веера при видимых свечах.
Обычный deltaX70, repeated drag, zoom-out и эмулированный touch на 4,8 экрана проходят.
Следовательно, эти контроли не являются доказательством отсутствия проблемы на резком touchpad jump.
Артефакты: `release-auto-eaefb7a24e3c6ca8/extended-horizontal`; live feed для repro не требуется.

## Завершение fast-touchpad исправления

- Полный локальный check неизменяемого pre-emergency снимка `a18a8fe` / `eaef`: 2631 PASS, 0 FAIL, 4
  optional SKIP, test duration 234973 мс. Лог `artifacts/mtp-release-pre-emergency-check.log`. Это
  отдельный checkpoint до нового helper.
- `0f085b5` / `bd961bf67137be72`: bounded current-data emergency при нулевом clip устранил резкий
  скачок; actual canvas CPU1: 23 frames/0 blank, 9 calls total 5,2 мс/max 1,2 мс; CPU×4: 22/0, 18,5
  мс/max 3,3 мс. Однако при partial clip 1,54% оставались лишь полоски 38–42 px. Это визуальный
  FAIL, несмотря на формальный счётчик painted frames. Пять PNG просмотрены изолированно.
- `3ca385c` / `cd708bfdaf221166`: при coverage <85% coarse заменяет малый partial, covered/exact
  путь остаётся прежним, при reject применяется повторно проверенный clip. Независимо 46 worker + 5
  helper tests PASS; бюджеты и exact renderer не менялись.
- Actual canvas final: normal fast burst 23 frames/0 blank, 9 emergency calls total 5,2 мс/max 1,3
  мс, whole-cache max 1,7 мс; CPU×4: 19/0, 7 calls total 14,9 мс/max 3,0 мс, whole-cache max 4,8 мс.
  Long tasks 0, MtpModel.draw 0; стоимость emergency измерена отдельно, а не спрятана под этим
  счётчиком. 4077 vertices/paint. CPU×4 — desktop stress, не новый физический телефонный замер.
- Final partial 0,95 viewport и обратное движение показывают полный веер: frames 03/04/06, плюс
  fast-burst frame 03; все четыре PNG просмотрены. Covered control: 2 exact blits/0 новых emergency
  attempts. Итоговая revision 3, camera 2300..2700, pending false, SHA реальных данных не изменился.
  Отчёт: `artifacts/mtp-worker-raster-benchmark/release-auto-cd708bfdaf221166/`.

Финальный полный `pnpm check` source `3ca385c` / build `cd708`: format/lint/typecheck/build PASS,
2640 PASS, 0 FAIL, 4 optional SKIP, test duration 265467 мс. Лог
`artifacts/mtp-release-0347-final-check.log`. Strict OpenSpec: 134/134 PASS.

При последующей жалобе с физического телефона readonly проверка обнаружила действительно загруженный
старый `4ae` (BTC-AUD/OKX, день, 365 дней, 835 свечей, MTP160+440), старые JS chunks и видимый
баннер обновления. После отключения Wi-Fi ADB reverse был потерян; восстановлен только ранее
разрешённый 5310. Это объясняет, почему обновление локального сервера само по себе не подтверждает
обновление открытой страницы. Вкладка/настройки/разметка сохранены, автоматических жестов до
обновления не было.
