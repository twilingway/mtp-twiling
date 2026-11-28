# Design

## Canvas pass ordering

Actual OffscreenCanvas isolation found deferred-backend interactions between the exact core pass
and the clipped edge pass: unchanged core drawing commands still produced 6–18 changed interior
pixels. A Worker-only `getImageData(0, 0, 1, 1)` fence before clearing/clipping the side strips
preserves exact core pixels. It runs only when an actual edge pass is needed, creates no second
surface, and uses the existing Worker failure/fallback path if readback fails. Diagnostic repeats
measured approximately 13–18 ms additional Worker round-trip time; this is not a free operation or
a claim of improved FPS. Final production-build pixel and gesture checks remain required.

## Context

См. proposal.md. Версия 0.3.47 имеет physical padding, но snapshot только текущих индексов; covered
preview не инициирует refill, а coarse запускается лишь при потере 15% покрытия. Следовательно,
пользователь видит полосу раньше следующего Worker результата. Существующий coarse ограничен 4096
реальными SMA-вершинами и измерен отдельно; новый Worker paint нужно измерить заново.

## Goals / Non-Goals

**Goals:** реальный X-запас, ранний refill и отсутствие открытого пустого края при неизменном exact
core.

**Non-Goals:** новые формулы/периоды SMA, подгрузка дополнительной истории, React-рендеринг, облако,
увеличение лимита поверхности или глобальный Worker pool.

## Decisions

1. Разделить исходный core и расширенный capture. Цель X-запаса — 96 CSS px с каждой стороны, с
   адаптацией к прежним 4 Mi-pixels/4096 px. Хранить реально достигнутый запас. Сохранять исходные Y
   anchors и исходный sampling step; новые X получать через SDK только при разрешённом dispatch.
2. Один bitmap, два paint-прохода в Worker: сначала прежний exact core path без изменения команд,
   затем clear только боковых padding-полос в целых device pixels и расширенные phase-aligned пути
   под clip этих двух полос. Core не перерисовывается и не получает новую альфу. Однопроходное
   расширение отвергнуто: оно меняет начало, density, caps/joins и видимые AA-пиксели. Когда
   расширенных реальных индексов нет, лишний проход не нужен. Новая frame-семантика явно
   версионируется.
3. Pure geometry вычисляет безопасное покрытие и остаток X-запаса. При расходовании половины
   фактически доступного запаса (порог остатка до 48 CSS px), разрешён ранний refill, даже пока
   viewport покрыт. Сохраняются 150 ms cap, один in-flight и дешёвый latest marker.
4. Любое реальное uncovered покрытие, а не только <85%, использует полный текущий coarse вместо
   partial bitmap. Уже покрывающий raster остаётся быстрым путём; при reject допускается лишь
   повторно проверенный безопасный clip. Coarse не завершает pending.
5. Warmup работает из прежнего полного prefix. Не создавать бары за историческими границами.
   Математика/геометрия остаются вне React; SDK probes, часы, canvas и очередь остаются в
   адаптере/Worker. Не добавлять обходов истории в frame/timer/response; существующие safety guards
   сохраняются.

## Risks / Trade-offs

- Двойной paint повышает Worker cost → пропускать лишний проход без extra indices, измерить actual
  canvas/ready latency.
- Погрешность core или seam → RGBA pixel regression с DPR 1/2.75, sampling 3000/3001,
  wide/alpha/cap/join/miter.
- Недостаток памяти → уменьшать фактический X-запас, не превышая прежний лимит и не создавая второй
  большой backing.
- Ответ после разворота/смены данных → сохранить current-key, лучший пригодный слой, close и
  cancellation guards.
- Быстрый жест опережает резерв → bounded current-data coarse без пустой полосы и без нового
  тяжёлого main draw.

## Migration Plan

Изолированная версия 0.3.48; сначала scoped tests и независимое ревью, затем точные пиксели и
actual-canvas жесты на ПК/телефоне. Публикация через PR и зелёный CI; ?mtpRaster=native сохраняет
контрольный путь.
