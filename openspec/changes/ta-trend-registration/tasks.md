# Tasks

## 1. Регистрация и контракт

- [x] 1.1 Добавить шесть definitions и точные public IDs после старых 29 без изменения defaults.
- [x] 1.2 Реализовать nullable warmup/alwaysUndefined CHOP1 и сохранить strict persisted schema.
- [x] 1.3 Проверить manual golden/default/history/JSON fixtures и записать границу Drive/native.

## 2. Проверки source

- [x] 2.1 Выполнить focused regression tests, TypeScript, scoped lint/format и strict spec
      validation.
- [x] 2.2 Проверить ownership diff и сохранить отдельный source commit после math cherry-pick.

## Workflow follow-up

- [x] Root добавил только diLength/adxSmoothing в Drive allowlist и проверил все шесть roundtrips.
- [x] Root обновил native 35 fixtures; оба adapters проходят полный source suite.
- [x] Отдельная browser QA проверила поиск/добавление35, Canvas новых6, параметры, pane/layout,
      native gestures, reload/import и ограниченный camera roundtrip. Унаследованный mobile checkbox
      defect исправлен7095365 и повторно проверен RU/EN dark/light375.
- Архивировать change после .20 интеграционной приёмки.
