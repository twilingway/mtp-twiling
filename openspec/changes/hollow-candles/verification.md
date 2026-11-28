# Verification

## Контракт

- [Официальный TradingView](https://www.tradingview.com/support/solutions/43000745270-hollow-candle-charts-explained/):
  заливка сравнивает close/open, цвет сравнивает close/предыдущий close.
- Равный предыдущий close и первая свеча нейтральны; doji заполнен и имеет минимальную высоту один
  пиксель. Это явное правило проекта: официальный источник не уточняет эти случаи.
- KLine 9.8.12 `CandleBarView.drawImp` в `node_modules/klinecharts/dist/index.esm.js` выбирает цвет
  только по close/open. Использован публичный indicator draw API; сырая OHLC-серия остаётся
  источником данных и autoscale.

## Проверки исполнителя

- `node --test --experimental-test-isolation=none test/hollow-candles.test.mjs test/native-chart-type-adapters.test.mjs test/native-chart-type-intent.test.mjs`:
  **31 PASS**, включая 7 новых тестов.
- `node node_modules/typescript/bin/tsc --noEmit`: PASS. Для проверки в worktree скопирован
  игнорируемый `src/generated/app-version.ts` из корня; генератор версии и сборка не запускались.
- Scoped ESLint для 9 изменённых production-модулей: PASS.
- Scoped Prettier, `git diff --check`: PASS.
- `node scripts/spec.mjs validate hollow-candles --strict`: PASS.
- Обычный `node --test` получил средовой `spawn EPERM`; тесты успешно выполнены в том же процессе
  через `--experimental-test-isolation=none`.

## Остаётся координатору

Дополнительный tiny-fix после ревью: границы фитилей нормализованы через min/max пиксельных
high/low. Повторно выполнены `test/hollow-candles.test.mjs` (**8 PASS**, включая обратную проекцию
Y), plain tsc, scoped ESLint renderer и `git diff --check`: PASS. UI и сохранённые параметры
обратной шкалы не добавлялись.

Общая сборка/полная проверка и визуальный smoke обоих движков: четыре сочетания, пустой интерьер с
видимой сеткой, светлая/тёмная темы, скрытые компоненты, индикаторы/рисунки, смена типа и сохранение
камеры. Браузер и телефон исполнителем не запускались.
