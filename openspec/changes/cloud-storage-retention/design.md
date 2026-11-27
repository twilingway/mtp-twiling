# Design

## Context

См. proposal.md. `createLegacyArchive` пересобирает логические backups; он не сохраняет точные
физические файлы. `LegacyDriveCleanup` требует внешнего total writer fence, которого старые PWA не
соблюдают. `DriveSync` отвергает отсутствующих родителей. Новый протокол заменяет это отдельным
доказательством сохранности raw bytes и archive-aware чтением; существующий gate не подделывается.

## Goals / Non-Goals

**Goals:** удаление только покрытых точных версий, восстановление после reload и поздних старых
записей, независимые владельцы codec, I/O, overlay, coordinator и UI.

**Non-Goals:** блокировка всех старых PWA, OAuth retirement, scopes/backend/секреты, удаление
архивов или чужих файлов. Новая запись старого клиента не обязана прекратиться после очистки.

## Decisions

### Google contracts and ownership

Контракты данных заморожены для параллельных исполнителей. Совместные изменения согласуются через
координатора; один исполнитель владеет каждым указанным production-модулем.

- **Pure codec:** `src/services/drive/legacy-raw-archive-types.ts` и `legacy-raw-archive-codec.ts`.
  `RawLegacyFile` содержит `fileId`, `namespace` (`mtp-drive-v1` либо `mtp-drive-v2`), `kind`
  (`snapshot` либо `blob`), `key`, `version`, сильный `etag`, `size`, `sha256`, исходные
  `appProperties`. `RawArchiveIndex` содержит `formatVersion: 1`, `operationId`, `workspaceId`,
  обязательный `publicClientId`, `createdAt`, `files` (элементы `RawLegacyFile` с `offset`
  относительно начала секций). `ArchiveReceipt` содержит `fileId`, `size`, `sha256`, `indexDigest`.
  `CompactionRecord` содержит `formatVersion: 1`, `operationId`, `workspaceId`, `publicClientId`,
  `archive` (`ArchiveReceipt`), `inventoryDigest`, `v3: { fileId, revisionId, envelopeHash }`,
  `createdAt`. Кодек формирует и проверяет framing, канонический индекс, ссылки, размеры и hashes;
  значения времени и UUID приходят аргументами, HTTP/DOM/storage отсутствуют. Точные одинаковые
  секции можно дедуплицировать по SHA+size, сохраняя отдельную запись каждого исходного физического
  файла. `RawLegacyObject` имеет `{ file, body: Blob }`. `encodeRawArchive(objects, metadata)`
  возвращает `EncodedRawArchive { body: Blob, index, indexDigest, inventoryDigest, sha256, size }`.
  `decodeRawArchive(body: Blob, expectedReference?: { size, sha256, indexDigest? })` возвращает те
  же поля и `objects` (Blob slices). Также экспортируются `computeRawInventoryDigest(files)` и
  `verifyRawArchiveCoverage(index, files)`; все четыре операции асинхронные. Metadata включает
  `operationId`, `workspaceId`, `publicClientId`, `createdAt`. Перекрывающиеся секции запрещены,
  кроме точного dedup с одинаковыми size/hash; повтор физического fileId запрещён.
- **I/O:** `legacy-raw-archive-io.ts`, экспорт `LegacyCompactionHttp`. Новый namespace
  `mtp-drive-retention-v1`, `mtpKind`: `rawarchive`, `compaction`, `probe`; общий `DriveKind` и slot
  codec не расширяются. `LegacyCandidate` равен исходным listing-полям `RawLegacyFile` без `etag` и
  `sha256`. `captureRaw(candidate, signal)` возвращает `{ file: RawLegacyFile, body }` после
  согласованного v2 metadata → media → metadata и проверки точных байтов.
  `createImmutable(kind, body, { operationId, workspaceId, publicClientId, indexDigest? }, onReserved, signal)`
  резервирует свой ID, вызывает `onReserved(fileId)` до отправки и возвращает
  `{ fileId, size, sha256 }`. `readVerified({ fileId, size, sha256 }, signal)` проверяет полное
  повторное чтение. `listRetention(kind, signal)` обеспечивает обнаружение архивов и записей.
  Лимиты: контейнер 512 МиБ, индекс 1 МиБ, 2048 исходных файлов, отдельный источник 256 МиБ, запись
  переноса 1 МиБ. Превышение останавливает план до удаления; без усечения и новых зависимостей
  сжатия.
- **Delete proof:** тот же I/O владеет непрозрачным `DeleteProof` и его подлинностью, привязанными к
  активной авторизации и ревизии транспорта. `runDeleteProbe(signal)` использует только свои
  synthetic files: устаревший ETag DELETE возвращает 412 и файл остаётся, актуальный DELETE
  завершается подтверждённым отсутствием. Поддержка/CORS DELETE проверяется отдельно от PUT CAS.
  `deletePinned(file, proof, signal)` возвращает `deleted`, `changed` либо `unknown`; 412 всегда
  `changed`. Доказательство хранится в текущем экземпляре I/O, не требует нового durable storage.
  Собственные probe IDs журналируются и очищаются в finally или остаются явно pending.
- **Overlay:** `legacy-archive-overlay.ts` соединяет живой `DriveStore` с проверенными raw entries.
  `createLegacyArchiveOverlay(baseStore, namespace, verifiedArchives)` асинхронно возвращает
  read-only `DriveStore`; `create` завершает permission-ошибкой. Архивные virtual IDs включают
  namespace/sourceID/version/rawSHA, чтобы не подменять изменившийся живой физический ID. Логические
  snapshots индексируются по namespace/nodeId/hash, blobs по namespace/SHA/size; отсутствующие
  родители и blobs доступны из архивов. Совпавший ID с разным содержимым даёт конфликт. Archived
  baseline не показывается как новая поздняя запись. Живые identities вне baseline показываются для
  сверки и не принимаются автоматически. Overlay не удаляет и не публикует файлы; чистые проверки
  ссылок отделены от adapter чтения.
- **Coordinator:** `legacy-compaction.ts` и существующий provider glue. Владеет immutable планом,
  журналом, фазами и проверками аккаунта/авторизации/v3; использует публичные codec/I/O/overlay.
  `LegacyDriveCleanup.assertOldWritersFenced` не заменяется константой true и не переиспользуется
  как разрешение нового протокола.
- **UI:** существующие Google settings/controller glue показывают preview, последствия перехода,
  прогресс и подтверждённые счётчики. Решения о покрытии, условии удаления и результате находятся в
  сервисах. UI не вызывает низкоуровневый DELETE.

### Google sequence and recovery

1. Зафиксировать кандидатов и прочитать точные версии. Неполное listing не даёт полного плана;
   поздние новые IDs не расширяют уже выданный план.
2. Создать неизменяемый raw archive, полностью скачать и проверить все секции. Новый namespace
   доступен через существующий appdata scope. Properties содержат только случайные IDs и hashes; в
   payload нет добавленных токенов, банковского owner или локальных ключей.
3. Проверить выбранную v3 версию и неизменяемый `CompactionRecord` полным чтением из облака. Для
   нового migration workspace допустима существующая ссылка `legacyArchive`; для уже существующего
   scope она не меняется произвольно. Sidecar record связывает архив с v3 без смены протокола
   каждого слота. Последующие штатные v3 записи сохраняют архивную возможность recovery.
4. После готовности archive-aware reader и DELETE proof удалять только зафиксированные покрытые
   versions, сначала snapshots, затем blobs. Перед отправкой сверить metadata с индексом и отправить
   точный `If-Match`. Появление нового ID не отменяет сохранность baseline; изменение самого
   кандидата сохраняет его для следующего архива.
5. При неизвестном ответе читать исходный ID: отсутствие подтверждает завершение только для
   покрытого кандидата при актуальной авторизации; существующая иная версия сохраняется. После crash
   заново прочитать архив/record и получить действующее delete proof. Архивы и records не являются
   кандидатами этой очистки, включая архивы параллельного клиента.
6. Новые клиенты обнаруживают архивы/records без локального журнала и проверяют поздние legacy
   записи даже при существующем v3 scope. Новая v3 версия остаётся рабочей до явного выбора. Поздние
   данные допускают отдельный delta archive/план после сверки; сама упаковка не разрешает конфликт
   содержимого.

### Yandex boundary

Зафиксирован результат: в спокойном состоянии одного normal клиента остаются две завершённые
восстанавливаемые версии; третий успешный save приводит хранилище к этому пределу, а не просто
скрывает старые файлы. Pending операции и нерешённые ветви защищены, cleanup pending виден отдельно
от подтверждённого сохранения. Testing использует общий клиент workspace и ту же политику.
Транспортный механизм физической очистки и доказательство безопасности определяет отдельное
исследование Яндекса до его реализации; отсутствие доказательства нельзя заменять listing либо
локальной блокировкой. Google контракты от этого исследования не зависят.

Общий UI-контракт заморожен root в `src/model/cloud-sync.ts`: `CloudClientMode = 'normal' | 'test'`,
опциональные `status.clientMode`, `status.clientLabel`, `setClientMode(mode)`. Normal сохраняет
существующий UUID; первый DEV запуск и `sync-client=testing` выбирают Testing лишь без сохранённого
режима. Автоматическое определение incognito не обещается. Смена режима инвалидирует preview и
устаревшие callbacks; неподтверждённый durable intent сохраняет исходный clientId/mode и не служит
ack нового клиента. Политика не меняет enabled/automatic/credentials.

## Risks / Trade-offs

- [Старый PWA не понимает архив] → переход формата явно обозначен; нужен обновлённый reader до
  удаления. Гарантируется восстановление обновлённым клиентом, а не совместимость старого кода.
- [Late snapshot с удалёнными зависимостями] → overlay восстанавливает parent/blob из archive; late
  bytes сохраняются и требуют явного выбора.
- [Сервис не исполняет If-Match DELETE] → отдельная реальная synthetic proof, при отсутствии
  доказательства нет пользовательского удаления. Справка метода сама по себе не доказывает CAS.
- [Не хватает места для временной второй копии] → показать ошибку, не удалять источники до
  проверенного remote archive.
- [Пользователь удалил appData либо архив] → остановить оставшееся удаление; это не защита от
  внешнего удаления всего облачного хранилища.
- [Две очистки или потерянный ответ] → pinned versions, immutable archive/record и повторная
  проверка отсутствия; без расширения плана и без безусловного DELETE.

## Migration Plan

Поставить codec, overlay и обнаружение архивов до включения cleanup. Затем проверить synthetic
DELETE, переход и поздние записи на изолированных данных; только после этого выполнять разрешённую
пользовательскую очистку с полным отчётом. После удаления откат к старому reader небезопасен:
восстановление использует новый reader либо точные исходные файлы из архива. Публикацию
согласованной версии и общие проверки выполняет координатор.

## References

- [Google files.delete: permanent deletion и существующий appdata scope](https://developers.google.com/workspace/drive/api/reference/rest/v2/files/delete).
  Документ не заменяет доказательство If-Match DELETE.
- [Google appDataFolder: доступ приложения, ограничения и внешнее удаление](https://developers.google.com/workspace/drive/api/guides/appdata).
