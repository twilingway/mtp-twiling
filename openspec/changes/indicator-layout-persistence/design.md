# Design

## Context

См. proposal.md. Адаптеры пересоздаются при изменении native render-config; UI-настройки не должны
входить в этот ключ. Настройки профиля уже сохраняются через IndexedDB и backup.

## Goals / Non-Goals

**Goals:** стабильный VOL на одном адаптере, общая per-owner доля и независимый legendCollapsed.

**Non-Goals:** перенос индикаторов по панелям, новые диалоги и изменение главной камеры.

## Decisions

- ProfilePreferences.indicatorPaneLayout.volume.heightRatio ограничен 0.05–0.8 и не входит в
  ChartRenderConfig. ChartSettings.legendCollapsed также не входит в native config.
- В KLine 9.8.12 публичный OnPaneDrag вызывается после изменения root bounding, но до обновления
  MAIN bounding в adjustPaneViewport. Измерение через getSize MAIN откладывается в microtask после
  завершения обработчика. SeparatorPane имеет пустой paneId; нельзя фильтровать только volume_pane.
- Единственный дополнительный native pane в текущей модели — VOL. Доля вычисляется из MAIN высот
  candle_pane и volume_pane; программное восстановление и resize не создают событие сохранения.
- Callback проверяет owner/source/revision, retired, readiness и import/barrier. Проверка
  повторяется после await внутри setPreferences через необязательный valid; иначе старое действие
  может перезаписать импорт того же владельца. Новых controller методов и полей нет.
- Старые профили используют 95 px при отсутствии доли. Новые размеры при resize применяются из
  текущей локальной доли адаптера, без React remount и обратного применения устаревшего seed.
- Легенда перенесена внутрь chart-heading после chart-price и использует position:static.
  Фиксированные top87/top74 больше не определяют её положение при переносе OHLC. Pointer-events
  включены для легенды; она находится вне ChartGestures. Chevron сохраняет только legendCollapsed.

## Risks / Trade-offs

- [Панель в очень маленьком окне] → соблюдаются native minHeight и допустимые доли.
- [Событие после destroy] → pending microtask проверяет disposed; подписка удаляется.
- [Браузерное поведение] → в этом этапе только deterministic native/lifecycle tests; визуальную
  проверку после объединения выполняет основной агент.

## Migration Plan

Поля optional и совместимы со старыми профилями. Переносить только scoped commit в canonical после
общего QA; текущий сервер и пользовательский профиль не затрагиваются.
