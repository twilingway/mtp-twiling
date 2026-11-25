# Proposal

## Why

Пользователь требует React и TypeScript для поддержки растущего терминала и обнаружения ошибок до
запуска. Существующий JavaScript-прототип уже хранит личные настройки и историю; миграция должна
сохранить поведение и данные.

## What Changes

- Перенос production-кода в React + strict TypeScript; pure models и chart adapters отделяются от
  UI/DOM.
- Сборка статической PWA, отдельная проверка типов, ESLint/Prettier и общий `pnpm check` по правилам
  соседних приложений.
- Сохранение IndexedDB v2, backup v1, самостоятельного подключения к банку, двух движков и
  пользовательского обновления.
- Название продукта и целевой адрес: `mtp.twiling.ru` по прямому указанию пользователя.

## Capabilities

### New Capabilities

Нет новых пользовательских функций в этой миграции. `.openspec.yaml` содержит `skip_specs:true`:
требования поведения сохраняются, сценарии регрессии указаны в design/tasks.

### Modified Capabilities

Нет. Google Drive — следующий отдельный change, не часть миграции типов.

## Impact

Новые исходники `src/`, сборка esbuild, React/React DOM, TypeScript6, ESLint/Prettier, pnpm и
OpenSpec. Backend остаётся статическим. Секреты не попадают в сборку или облако.
