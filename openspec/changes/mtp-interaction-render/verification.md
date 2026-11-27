# Verification

Дата: 2026-11-27. База: 04a9d2d, ветка perf/mtp-interaction-render. Изолированная рабочая копия
artifacts/mtp-interaction-render. Сервер, приложение, активный DEV, публикация и другие ветки не
изменялись. Использованы skills openspec-workflow и performance-optimization.

## Измерения CPU до и после

Команда: `$env:MTP_EMPTY_BENCHMARK='1'; node test/mtp-interaction-render.test.mjs`. Node 22.22.1 на
настольном Windows. Реальная математика MtpModel, 15083 детерминированных свечи только в тесте. Это
не реальные котировки и не production fixture; схема данных соответствует исходным close/30m. Canvas
— счётчик операций. Растеризация, SDK графика, GPU и FPS телефона не измерены. Послеизменённые
sub-microsecond CPU числа близки к шумовому порогу; существенны нулевые счётчики.

Пустой primitive, 7 пакетов по 1000 кадров после 1000 прогрева:

| Сценарий          | До, median ms/frame | После, median ms/frame | Extrema/bounds до | Extrema/bounds после |
| ----------------- | ------------------: | ---------------------: | ----------------: | -------------------: |
| Normal, шаг 1,015 |           0,0042214 |              0,0000340 |           1 / 231 |                0 / 0 |
| Fit, шаг 0,0155   |           0,1320726 |              0,0000602 |         2 / 30166 |                0 / 0 |

До: 2 X, 1 bitmap scope, 6 canvas операций на кадр в обоих сценариях. После: всё по нулю; Y был и
остаётся нулём. Для Fit исходный raster сканировал всю историю, затем projection повторял видимые
экстремумы. Для Normal raster отказывал по шагу и оставался один видимый обход.

Отдельный offline replay тяжёлого normal, 151 период, 229 видимых баров, 300 кадров: нативный обход
34881 vertices + 151 strokes/frame = 0,53116 ms/frame; прогретый аффинный preview 0,005618 ms/frame
с нулём повторных захватов. Это сравнение математики с submission в тестовый canvas, а не speedup
реальной растеризации или телефона. Холодный новый кадр может стоить дороже: расширенный захват плюс
точный нативный draw.

## Доказательства геометрии и регрессий

- Новый heavy normal тест: один захват, 20 pan/Y кадров и Y x2 используют его; после pointerup и 180
  ms — новый захват и возврат false, вызывающий нативный draw исходного диапазона.
- Все 151 линии сохраняются; значения, цвета, opacity и width совпадают с прямым MtpModel.draw.
  Каждый сегмент внутри viewport, включая точные пересечения левой/правой границы, совпадает строго
  через deepEqual. Расширенный слой не используется для установившегося кадра, поэтому
  дополнительные offscreen joins не влияют на окончательные пиксели.
- Это геометрическое равенство, не визуальная проверка изображений и не измеренная побайтовая
  идентичность пикселей. Скриншоты не открывались; physical Android проверка остаётся координатору.
- Проверены отключённые draw/autoscale/extrema/raster, нулевые вызовы и отсутствие доступа к bounds,
  обновление/append выключенного MTP и точное повторное включение.
- Сохранены no-op revision increments, close prefix, все 151 SMA; independently summed tail SMA
  совпадают в пределах 1e-7, reset prefix и bounds строго совпадают с новым полным расчётом.
- Существующие dense tests плюс новые normal tests покрывают modes 0/2/3, отказ mode1/unknown,
  nonaffine transforms, стили, DPR, размеры, reset/append/tail, coverage miss, sampling phase, лимит
  16 MiB/4096 и освобождение surface до замены.

## Выполненные проверки

- Scoped strict TypeScript 6
  (`--ignoreConfig --noEmit --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --verbatimModuleSyntax --target ES2023 --module ESNext --moduleResolution Bundler --lib ES2023,DOM,DOM.Iterable --skipLibCheck src/model/mtp.ts src/model/mtp-raster-cache.ts`)
  — успешно.
- ESLint обоих изменённых production файлов и Prettier изменённых файлов — успешно.
- `node test/mtp-interaction-render.test.mjs` с benchmark — 8 pass.
- `node test/mtp-raster-cache.test.mjs` — 9 pass.
- `node test/mtp-projection.test.mjs` — 7 pass, 1 optional benchmark skip.
- `node test/mtp-pixel-render.test.mjs` — 6 pass, 1 optional benchmark skip. Несмотря на имя, этот
  тест проверяет геометрию и допуск simplifier, не настоящую canvas rasterization.
- `openspec validate --all --strict` — 118 pass, 0 fail.
- `git diff --check` — успешно.

Вызов `node --test` встретил sandbox spawn EPERM; прямой `node test/file.mjs` выполнил те же
node:test проверки без дочернего test runner. Полный tsc без prepare-version остановился только на
отсутствующем generated/app-version. Старые mtp-combined/mtp-layer tests требуют public/mtp.js,
поэтому без разрешённой общей сборки не выполнились. Общую сборку, pnpm check, независимое ревью,
видимый browser smoke и matched physical phone replay выполняет координатор на интеграции.

## Ограничения

Fit свечи/объёмы и общий pan lag не исправлены и не объявлены исправленными. GPU bottleneck не
установлен. Установившиеся ordinary кадры сохраняют нативную стоимость; ускоряется покрытое движение
тяжёлого MTP. Padding ограничен бюджетом; выход за него честно требует нового захвата.
