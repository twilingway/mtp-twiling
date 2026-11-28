# Design

## Context

См. proposal.md. MtpRasterCache уже сохраняет ограниченный прозрачный слой и проверяет аффинную
проекцию. OffscreenCanvas сейчас создаётся в основном потоке. Fit меняет камеру, но не вызывает
полный reset средних. Нативный SDK продолжает рисовать свечи и шкалы на main thread.

## Goals / Non-Goals

**Goals:** измеряемый перенос тяжёлого cache miss МТП в Worker с тем же итоговым слоем.

**Non-Goals:** перенос SDK, всех индикаторов и KLine; изменение периодов или sampling phase;
автоматическая публикация неподтверждённого эксперимента.

## Decisions

- Сначала измерить draw/reset/update и main-thread long tasks на реальных данных baseline.
- Одна same-origin module entry `mtp-raster-worker.js`, без blob и новых зависимостей. URL от
  app/base URL; build и dev включают entry, dev разрешает только same-origin worker.
- До работы ready handshake сверяет protocol/build. Startup/render deadline и messageerror дают
  единичный переход в fallback при зависании; deadline не задерживает успешный ответ.
- Worker получает копию используемой части prefix, периоды/стили, exact sampled X и проверенную
  аффинную Y-проекцию. Оригинальный buffer модели не передаётся; прогрев до 640 баров сохраняется.
- X lookup содержит dense значения индексов диапазона либо union с явными индексами: каждый период
  начинает с max(start, period-1), затем шагает своим +step. Общая sampling phase запрещена.
- Settled слой строится ровно для исходного диапазона. Расширенная геометрия допустима только для
  preview: дополнительные сегменты могут менять stroke joins даже внутри экрана.
- Main владеет SDK/camera и окончательным blit. Worker возвращает ImageBitmap. Неподдерживаемые
  проекции/нет Worker/ошибка используют прежний синхронный путь, без скрытой бесконечной retry.
- Отдельная dev A/B настройка выбирает worker или baseline без изменения переносимых настроек.
- Очередь ограничена выполняемой и последней запрошенной работой. Ключ включает экземпляр слоя,
  revision/reset, стили, камеру X/Y, размер/DPR/режим; obsolete bitmap закрывается. destroy
  завершает worker и освобождает все ресурсы. Пока идёт работа, допустим только корректный прежний
  preview или пустой слой с последующим requestUpdate, без повторения тяжёлого синхронного paint.
- Ограничение очереди применяется main-side до postMessage. CSS X/Y и physical bitmap/padding явно
  разделены; ratios применяются worker setTransform и обратным масштабом при main blit.
- Ответ не рисуется из callback: следующий actual draw заново сверяет X/Y/DPR/revision/стили и
  полный актуальный ключ. Захваченный до resize ключ сам по себе не подтверждает актуальность.
- Лимит поверхности прежний: 4 млн пикселей и 4096 по стороне; один готовый слой и ограниченный
  переходный bitmap. По тикам передавать только новую revision; не запускать React progress per
  tick.
- Для одной поверхности учитывать ready/result/worker backing одновременно (до 48 МиБ при лимите 16
  МиБ на слой). Закрывать replaced/stale/error/destroy bitmap. Массовое включение во всех окнах без
  отдельной проверки общего бюджета не входит в эксперимент.
- Не менять simplifier, lineCap/lineJoin/miterLimit, порядок/цвет/width/opacity или guards
  filter/shadow/composite. Приёмка: одинаковые path-команды и RGBA отдельного слоя на одной камере.

## Risks / Trade-offs

- Ошибка проекции/альфы меняет линии → пиксельное сравнение на одинаковой камере и проверка SDK.
- Worker не ускоряет нативные свечи → отдельно учитывать MTP и общий main-thread long task.
- Устаревшая очередь при движении → latest-only/coalescing и проверка полного ключа перед blit.
- Несовпадение версии Worker в PWA → same build entry/manifest, ошибка загрузки включает fallback.

## Migration Plan

Только отдельная dev-ветка и A/B стенд. Сначала unit/lifecycle, затем одинаковые реальный dataset и
камера в браузере/на телефоне. При отсутствии выигрыша или нарушении точности оставить baseline.
