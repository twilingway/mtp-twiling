# Проверка совместимости текущего Drive reader

26.11.2026. Source-only исправление от `fa221a618b9394ae8e9dbc456828f93d278d0cd3`. Новый writer,
instance2/envelope3, IndexedDB migration и разрешение G5 сюда не входят.

## Поведение

- Перед accept/import/upload coordinator проверяет payload текущих heads даже при совпадении с
  `baseHeads`. `DriveSync.publish/resolve` независимо проверяет всех родителей перед первой записью.
- Обязательный trusted runtime API `validateHeads(inspection)` читает только JSON payload и сверяет
  manifest image count/index/mime/reference, наличие blob с соответствующими hash/size metadata.
  Изображения не скачиваются и не преобразуются в base64 ради format guard. Их bytes/hash
  проверяются настоящим `download`/import и существующим dedup при upload; format guard не
  утверждает, что image binary цел.
- Manifest protocol, backup envelope, TA instance/definition/params/styles и неизвестные remote keys
  проверяются до прежней allowlist projection. Неподдерживаемый remote subset не импортируется и не
  становится основанием нового староформатного снимка. Writer sanitizer по-прежнему исключает local
  owner, ключи, историю и котировки.
- В каждой операции сравниваются heads и content hashes всех наблюдавшихся manifests. Одинаковые
  копии manifest под разными Drive file IDs допустимы. Замена уже наблюдавшегося node ID с другими
  bytes — `remote-invalid`; смена каталога/heads — `conflict`, требующий новой проверки. В
  coordinator→publish передаётся непостоянная `expectedInspection`; writer копирует её до await.
- Неизвестная версия или неизвестные keys существующей local association вызывают
  `unsupported-format` до bootstrap/device/association writes. Известная повреждённая association
  тоже сохраняется без fallback. Только отсутствующая association создаётся заново.
- `unsupported-format` показывает RU/EN сообщение «Обновите приложение. Данные сохранены,
  автосинхронизация остановлена». Runtime становится error/disconnected/automatic=false и теряет
  ссылку для pending-marker writes. Сохранённый automatic, heads, digest и время не переписываются.
  Это состояние не изображается как успешное подключение Google. Новый явный connect повторит
  проверку; молчаливого принятия неизвестного формата нет.
- Пауза использует настоящий `DriveAuth.suspend()`, прерывающий handles без удаления сохранённого
  credential. Guard не вызывает invalidate/expire/disconnect/revoke и не меняет ciphertext,
  generation или expiresAt. Известный authorizationStored отражает retained credential; RU/EN
  подпись поясняет сохранение входа и прежнего срока доступа. При неизвестной association до auth
  restore stored flag не выдумывается. Штатный явный connect по-прежнему может заменить прежнюю
  generation новой авторизацией; format pause не удаляет эту новую сохранённую generation.

## Стоимость чтения

Каждая сверка получает свежий список снимков. Проверенные манифесты переиспользуются в памяти
текущего подключения по идентификатору, серверной версии, SHA‑256 и размеру. Снимки без серверной
версии загружаются заново. Payload JSON читается снова при каждой попытке, отдельно coordinator и
standalone writer. `validateHeads` хранит один payload за раз. Coordinator ограничивает preview
восемью конфликтующими heads. Бинарное изображение проверяется при загрузке и дедупликации.

Измерение coordinator/DriveSync через memory Store без серверных версий файлов, одно изображение 100
КиБ (102400 bytes), payload JSON 313 bytes:

| Same-head             | Payload reads/bytes | Image reads/bytes | Manifest reads | Upload               |
| --------------------- | ------------------: | ----------------: | -------------: | -------------------- |
| Clean                 |             1 / 313 |             0 / 0 |              2 | Нет                  |
| Dirty, изменена theme |             2 / 626 |        1 / 102400 |              8 | Один blob и snapshot |

Единственный dirty image read выполняет прежний content-addressed dedup: форматный guard binary не
читает. Snapshot reads включают сверки каталога, итоговую inspection и новый manifest. Это точный
bounded fixture, не замер Google latency и не обещание фиксированного числа запросов для любого
каталога.

## Проверки и provenance

Новые source tests: **66/66 PASS**, включая same/changed/unlinked heads, clean/dirty, manual и
настоящий 1500ms auto-debounce, standalone publish/resolve, immutable same-ID replacement,
revision/owner/session/disconnect, stale conflict choice, local loader/store и actionable copy.
Automatic pending marker разрешён до попытки sync; он не меняет принятые heads/digest/time. После
unsupported pause новые pending-marker writes не выполняются.

Четыре из этих 66 проверок воспроизводят **исторические writer payloads**, а не только нынешние
defaults: envelope1 с drawings/images/camera и envelope2 с provider/TA pane/dotted style. Оба
читаются из namespace `mtp-drive-v1` и `mtp-drive-v2` без потери данных. Fixture
`test/fixtures/drive-reader-legacy.json` получен через настоящий `prepareDriveBackup` из commit
`8836aa0374eb41aff42312e3bc51bc7caaafd62a`, `src/services/drive/backup.ts` SHA256
`fd3d7d3d4747cc817171aa6c0cacce28edfc4f26efa90c5dc2f734a37d7a9dec`: неизменённая историческая
`test/drive-sync.test.mjs` fixture плюс поддерживаемые provider/TA/style fields. Данные
искусственные, настоящие пользовательские Google backups не читались.

Существующие Drive/auth/abort/bootstrap/transfer tests: **108/108 PASS**. Whole-source strict
TypeScript: 0 diagnostics с единственным виртуальным отсутствующим `src/generated/app-version.ts`,
экспортирующим только APP_VERSION/BUILD_ID. Scoped ESLint/Prettier и OpenSpec strict проверяются без
prepare-version/build. Coordinator — 498 физических строк; runtime state/reader seams вынесены в
`coordinator-reader.ts`, capability/identity — в `reader-guard.ts`.

Follow-up после независимого P2 review добавляет **7/7 PASS tests** с настоящими DriveAuth,
EncryptedDriveAuthVault и AES-GCM/WebCrypto на memory backend. Проверяются exact ciphertext двух
owners, отсутствие guard-induced vault writes/removal, abort старых handles, отсутствие скрытого
автовозобновления, failed local restore → manual connect, remote manual/automatic, смена owner во
время чтения и повторное открытие совместимого reader без Google prompt. Исходный expiry не
продлевается; настоящий expiry удаляет только свою generation, сохраняя другую/более новую.

Команды:

```text
node --test --experimental-test-isolation=none test/drive-reader-guard.test.mjs
node --test --experimental-test-isolation=none test/drive-reader-auth-pause.test.mjs
node --test --experimental-test-isolation=none test/drive-coordinator.test.mjs test/drive-sync.test.mjs test/drive-sync-body.test.mjs test/drive-v2-migration.test.mjs test/drive-import-abort.test.mjs test/drive-auth-persistence.test.mjs test/guest-drive-bootstrap.test.mjs test/backup-transfer-queue.test.mjs
node scripts/spec.mjs validate --all --strict
```

## Границы гарантии

- До первой записи guard отклоняет уже наблюдаемые неизвестные родители и гонки во время чтения.
  Перед snapshot commit каталог сверяется ещё раз. Если новый head появился **после начала blob
  upload**, уже отправленный blob может остаться orphan; тест подтверждает отсутствие snapshot
  commit/accept при обнаруженной поздней гонке. Нет обещания zero-all-uploads для любой гонки.
- Google Drive append-only transport не даёт атомарного CAS каталога. Изменение после последней
  inspection и до server create не может быть исключено клиентской проверкой. Старые snapshots не
  удаляются, accepted head не подменяется непроверенным новым descendant.
- Проверяются актуальные heads; уже опубликованный старым reader поддерживаемый потомок неизвестного
  ancestor этим изменением автоматически не восстанавливается. Старые выпущенные clients сохраняют
  прежний пробел. Новый формат и совместимость downgrade требуют отдельного G5 решения.
- Не проверялись реальные Google/OAuth, browser startup, native IndexedDB timing или latency. Fetch
  запрещён в новых probes, fetchCalls=0; transport/storage заменены ограниченными memory boundaries.
