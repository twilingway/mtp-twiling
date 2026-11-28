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
- Candidate optimized build: 0.3.47/cfacb89f57fe12bd, 98 assets, локальный порт 5299. Для сборки
  явно задан MTP_EXPERIMENTAL_RASTER_WORKER=1; значение не входит в buildId и фиксируется отдельно.
- Режим выбирается ?mtpRaster=worker или ?mtpRaster=native. Обычная production-сборка выключает
  эксперимент. Основная ветка и опубликованная версия не менялись.
- A/B замер, пиксели и actual Worker runtime: выполняются, результат пока не заявлен.
- Телефон при baseline был заблокирован PIN; его состояние не меняли.
