# Design

## Context

См. proposal.md. Association не содержит capability epoch; совпадение node ID не доказывает
читаемость payload. Drive transport предоставляет content-addressed blobs и manifests, но не
атомарный compare-and-swap каталога.

## Goals / Non-Goals

**Goals:** ограниченный reader guard без новых persistent fields и сохранение epoch/revision guards.

**Non-Goals:** новый writer, schema, DB migration, восстановление неизвестных подмножеств или
межклиентная транзакция Google.

## Decisions

- Повторно проверять текущие payloads без кеша: это устраняет привязку к устаревшему reader epoch и
  неоднозначной identity. Обязательный validateHeads проверяет только JSON и manifest image
  metadata, без binary/base64. Настоящий download/import по-прежнему проверяет bytes изображений.
- Сверять список heads и content identities manifests. При замене уже наблюдавшегося node ID
  операция отклоняется; новые heads требуют новой проверки/выбора.
- Standalone writer читает всех родителей до первой записи и повторно сверяет каталог перед snapshot
  commit. Неподдерживаемый payload не проецируется в известное подмножество.
- Только отсутствие association разрешает bootstrap. Неизвестная association и capability расширения
  останавливаются с unsupported-format; форма явно сообщает обновить приложение и сохранить данные.
  Runtime pause не переписывает automatic в неизвестной association.
- Format pause вызывает `DriveAuth.suspend()` — abort handles без забывания saved credential.
  `invalidate/expire` остаются для настоящего expiry/401; guard не должен удалять vault record.
  Статус сохраняет известный stored flag, а UI поясняет сохранение прежнего срока доступа.

## Risks / Trade-offs

- Дополнительные JSON payload/manifest reads при каждой синхронизации → простая корректная граница
  без persistent кеша, существующие лимиты размера сохраняются. Same-head clean не читает image
  binaries; dirty читает их только прежним unchanged-blob dedup.
- Каталог может измениться после последней проверки → Drive append-only не предоставляет CAS;
  финальная сверка предотвращает commit после наблюдаемой гонки, уже загруженные blobs могут
  остаться orphan при поздней гонке. Не обещается серверная атомарность.
- Старые выпущенные readers остаются прежними → этот bugfix не закрывает G5 и не разрешает новый
  формат.

## Migration Plan

Миграции нет. Сначала source tests и независимое review. Возврат старого reader возвращает известный
пробел защиты; неизвестные bytes не понижать.
