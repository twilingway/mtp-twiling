# Proposal

## Why

После обновления старый анонимный workspace guest остаётся в IndexedDB, но новый public показывает
defaults. Нужны безопасное автоматическое продолжение пустого workspace и явный экспорт прежних
данных при конфликте.

## What Changes

- Один атомарный перенос exact raw guest в доказанно пустой public, включая историю и coverage.
- Отдельное решение миграции независимо от существующего v2 ready marker.
- Офлайн-экспорт прежнего guest через настройки; существующие public данные автоматически не
  заменяются.
- Source, ключи и настоящие bank owners остаются без изменений.

## Capabilities

### New Capabilities

- `guest-public-recovery`: сохранение анонимного workspace при переходе guest → public.

### Modified Capabilities

Нет.

## Impact

Новые scoped storage helpers, локальная recovery UI и узкий bootstrap/controller glue. Версия,
зависимости, сервер, browser runtime и банковская авторизация не меняются.
