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
- Режим выбирается ?mtpRaster=worker или ?mtpRaster=native. Обычная production-сборка выключает
  эксперимент. Основная ветка и опубликованная версия не менялись.
- Первый A/B подтвердил actual Worker runtime и нулевую разницу RGBA с direct paint, но выявил
  регрессию жестов из-за полного snapshot каждый redraw и feedback ответов. При CPU ×4 cold Fit main
  cache max сократился со 106–126 до 3,5–5,3 мс; вертикальный жест вырос примерно со 120 до 430 мс
  main cache total. Этот вариант не принят для включения по умолчанию.
- Второй вариант: perf/mtp-worker-gesture, optimized build 0.3.47/a246a87eda1672c8, 98 assets,
  локальный порт 5300, тот же явный experimental build flag. Source frozen для Desktop/Phone A/B.
- V2: 25 worker + 9 cache + 7 projection + 12 interaction unit PASS; camera fixtures 14/14,
  TypeScript/ESLint/Prettier/strict spec PASS. Независимо перепроверены one-shot force и kinetic
  idle tracker, включая смену камеры до ответа и движение между timer/confirming draw.
- V2 A/B выполняется; численный выигрыш пока не заявлен. Телефон перед запуском оказался
  включён, разблокирован, Chrome Main на переднем плане; проверка идёт в отдельной dev-вкладке.
- Телефон при baseline был заблокирован PIN; его состояние не меняли.
