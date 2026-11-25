# Proposal

## Why

Для подключения криптовалют нужен проверяемый публичный источник с отдельной идентичностью серий.
Исследование подтвердило Bybit V5, но контракт банка пока нельзя расширять независимо от общей
миграции.

## What Changes

- Изолированный Bybit foundation: свои normalized types, anonymous HTTP, полный каталог и поиск.
- История и quotes сохраняют родные валюты, UTC время и rolling24h basis.
- Публичный WS с snapshot/delta, bounded reconnect и явным dispose, проверенный fake транспортом.
- UI, общий facade, storage, backup/Drive, OKX и торговые операции остаются следующими задачами.

## Capabilities

### New Capabilities

- `bybit-public-data`: публичный Bybit каталог, история, котировки и управляемый поток.

### Modified Capabilities

Нет.

## Impact

Только новый src/services/providers/bybit, собственные тесты, документация и OpenSpec. Нет ключей,
серверов, новых зависимостей или подключений к текущим контроллерам.
