# Proposal

## Why

Пять записей каталога ещё не имеют независимой проверяемой математики. Нужен source-only контракт
для дальнейшей регистрации без смешивания builtin Chandelier с community-скриптами.

## What Changes

- Чистые ALMA, LSMA, Keltner, Donchian и builtin Chandelier, aligned readonly серии.
- Проверенные public IDs/versions/source hashes, defaults, history и presentation gates.
- Независимые численные ledgers, проверки gaps, overflow, causality и ресурсов.

## Capabilities

### New Capabilities

- `technical-channel-average`: причинная математика средних и каналов с явными display offsets.

### Modified Capabilities

Нет.

## Impact

Только новый channel-average пакет, собственные tests/docs/OpenSpec. Shared types, registry, UI,
native, cache, Drive, package/version/build не меняются; зависимостей нет.
