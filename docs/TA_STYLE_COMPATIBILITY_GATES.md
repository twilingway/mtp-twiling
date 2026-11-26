# G5: совместимость нового оформления и старых клиентов

26.11.2026. **Proposal/evidence, не разрешение нового writer или миграции.** Instance2/envelope3 и
новая версия локальной базы не внедрены. Реальный Google/OAuth/пользовательские хранилища не
проверялись и не изменялись.

## Подтверждённый пробел

Независимый read-only report `vps/artifacts/drive-newer-backup-readonly-review.md`, probe и
evidence.json проверили50 наблюдений: по25 на public reader8836aa0 и release source9e8eeff.
Transport/storage в fixtures имитируются; fetchCalls0. Production код и реальные данные не менялись.

При **уже сохранённой association с тем же unknown head** engine не читает payload на fast path.
Clean sync принимает/checkpoints такой head; dirty/manual и actual auto-debounce создают дочерний
староформатный latest head. Bytes ancestor остаются в Drive tree, поэтому это не удаление файла, но
текущий снимок теряет newer оформление. Fixture проверяет envelope3, instance2 и неизвестный style
key. Это material downgrade/future-writer gate; нынешние v1 writers ещё не создают эти payload.

Changed/unlinked unknown heads и latest-head race отклоняются с remote-invalid до portable import,
upload или accept. Bootstrap/pending association metadata writes проверены отдельно: нельзя обобщать
эти сценарии как «вообще zero local writes». Manual backup import отклоняет unknown format до
flush/storage.

Текущий `loadDriveRecord` (`src/services/drive/local.ts`) не проверяет exact keys. Schema1 с
futureMinimumReader99 принимается после отбрасывания неизвестного поля; baseHeads сохраняются.
Unknown record schema2 вызывает fallback: новый device record и replacement association schema1 с
пустыми heads/automatictrue, две metadata writes. Поэтому добавление minimumReader field или bump
только DriveRecord.schemaVersion **не обеспечивает старому клиенту fail-closed**.

## Проверенный исходный механизм локальной базы

`src/services/storage-db.ts` обоих текущих readers открывает IndexedDB `twiling-personal-terminal` с
явной версией2. Existing connection на versionchange закрывается. Production не мигрировался.

Отдельный native Chrome prototype `vps/artifacts/g5-indexeddb-prototype-qa/report.json` проверил 8/8
сценариев на копиях actual storage module с собственным именем базы и версиями2/3. Existing pending
transaction завершилась перед upgrade; portable/vault sentinel bytes сохранились. Закрытая old
connection получила InvalidStateError, fresh old module не открыл newer database (native
VersionError); old writes после new commit0, clears0. Не закрывшаяся fixture connection вызвала
storage-blocked без partial writes; после её закрытия upgrade завершился. Own Chrome/server закрыты.
Это проверка механизма локального version fence, не production migration, не реальный Google и не
закрытие всего G5. Откат к reader с explicit2 после такой миграции не откроет базу3.

## Предлагаемая полная граница до первого advanced edit

1. Новый engine валидирует совместимость текущих remote heads также перед fast accept/upload,
   независимо от persisted baseHeads. Кеш, если потребуется, должен быть привязан к проверенному
   reader/format epoch и immutable payload identity, не только совпадению head ID.
2. Неизвестный newer Drive/local record не переписывается default association и не включает
   autosync. Reader сообщает unsupported/update-required, сохраняя bytes, heads и checkpoint.
3. Рассмотреть bump локальной IndexedDB2→3 **до первой записи нового portable instance**: old live
   connections закрываются, old reader с explicit2 не открывает newer database. Так клиент, однажды
   записавший newer schema, не сможет после downgrade нормализовать её старым reader. Это материален
   для rollback/доступности: откат должен сохранить новый reader; в3→2 молча не понижать. Сам bump
   ещё не принят и не исполнялся.
4. На другом устройстве без нового writer его old association остаётся на прежнем v1 head; changed
   newer remote payload должен отклоняться до upload. Проверить этот exact multi-client сценарий, а
   не только независимые parser unit tests. Device ID/ключ банка не переносить.
5. Реальная атомарность: все v1 данные сохраняются; read/import/period-only не повышают instance.
   Только явный advanced edit создаёт instance2 и envelope3. Старые экземпляры/legacy styles не
   переписываются. Unsupported remote не проецируется на известный subset.

## Обязательные проверки и решение

- Actual isolated IndexedDB old-open/live-tab→new-upgrade→old-reopen: нет partial writes или silent
  deletion; блокировка апгрейда видима. Открытые пользовательские профили не использовать.
- Прогон обоих exact old readers против будущего writer/checkpoint: same/changed/unlinked heads,
  dirty/clean/manual/auto, old/new DB version, blocked upgrade и rollback. Проверять raw bytes,
  portable/local metadata writes, upload/accept/checkpoint и latest-head смысл отдельно.
- Actual form→new JSON/Drive whitelist→read поддерживает auto+width/opacity, cross size и fill
  style; reset меняет только color mode. V1 fixtures остаются точными.
- До этого required approval compatibility trade-off и формат должны быть конкретны и доступны для
  review. OpenSpec workflow требует отдельного согласования material compatibility decision. Пока
  продолжаются native renderers с прежними v1 сохранениями; этот документ не закрывает G5.
