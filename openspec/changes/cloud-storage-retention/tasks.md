# Tasks

## 1. Google codec

- [x] 1.1 Владелец codec: создать `legacy-raw-archive-types.ts` по замороженным data shapes design,
      включая обязательный publicClientId; проверить совпадение импортируемых типов I/O и overlay.
- [x] 1.2 Владелец codec: реализовать Blob encode/decode, inventory digest и exact coverage.
      Проверка: тесты byte-for-byte roundtrip, полного набора физических IDs, dedup и повреждённых
      секций/offset/hash, повторных IDs, лимитов и отсутствия скрытой проекции исходных байтов.

## 2. Google I/O

- [x] 2.1 Владелец I/O: реализовать captureRaw и immutable create/readVerified/discovery в новом
      namespace, журналируя reserved ID до create. Проверка: fake HTTP tests metadata/body/metadata,
      полного remote readback, неопределённого create и восстановления по прежнему ID.
- [x] 2.2 Владелец I/O: реализовать отдельный session-bound DELETE proof и deletePinned. Проверка:
      тесты stale 412 сохраняет файл, actual ETag удаляет только pinned версию, unknown response
      проверяется чтением; отмена аккаунта/авторизации и cleanup только собственных probe.

## 3. Google overlay

- [x] 3.1 Владелец overlay: реализовать read-only объединение live store с проверенными Blob
      archives и namespace-bound virtual IDs. Проверка: тесты отсутствующего parent/blob, точных
      дублей, конфликтующего nodeId/hash и запрета create через overlay.
- [x] 3.2 Владелец overlay: различить архивированный baseline и поздние живые snapshots для сверки.
      Проверка: тесты поздней старой записи после удаления зависимостей, неизвестного будущего
      формата без потери raw bytes и сохранения recovery после продвижения v3 head.

## 4. Google coordinator и UI

- [x] 4.1 Владелец coordinator: реализовать immutable plan/journal, проверку archive/record/v3 и
      возобновление без подделки LegacyCleanupGate. Проверка: тесты запрета DELETE до всех proofs,
      reload после частичного удаления, двух compactor и неизвестного ответа.
- [x] 4.2 Владелец coordinator: подключить provider discovery архивов по workspace/publicClientId,
      поздние legacy данные при существующем v3 scope и точное покрытие перед каждым удалением.
      Проверка: тесты stale 412, позднего ID вне плана, смены аккаунта и недоступности архива.
- [x] 4.3 Владелец UI: показать preview, предупреждение об обновлении старых клиентов, прогресс и
      отдельные счётчики archived/deleted/changed/pending. Проверка: состояние не обещает пустое
      legacy облако навсегда, не выдаёт частичную очистку за успех и не предлагает удаление архивов.

## 5. Яндекс и режим клиента

- [x] 5.1 Владелец Яндекс I/O: документировать проверенный контракт безопасной физической очистки до
      её включения, сверив conditional delete/protected set и конкуренцию. Проверка: отдельные
      реальные synthetic evidence плюс тесты; отсутствие доказательства не подменяется local lock.
- [x] 5.2 Владелец Яндекс retention: реализовать физический предел двух завершённых версий normal
      клиента после спокойной очистки. Проверка: три последовательных save оставляют вторую/третью
      физически, оба readable; другой normal клиент сохраняет собственные версии.
- [x] 5.3 Владелец Яндекс retention: защитить staging/pending и нерешённые ветви, различить save и
      cleanup pending. Проверка: тесты потерянного ответа, конкуренции, повторной очистки и отказа
      удаления чужих/неподтверждённых ресурсов.
- [x] 5.4 Владелец identity/UI: подключить root-контракт CloudClientMode/clientMode/clientLabel/
      setClientMode; normal UUID сохранить, Testing общий, saved mode приоритетен над DEV/query.
      Проверка: тесты нового тестового сеанса, сохранённого normal, invalidation preview/callbacks,
      сохранения старого pending journal и неизменности enabled/automatic/credentials.

## 6. Общая проверка координатором

- [x] 6.1 Координатор: выполнить `pnpm check` и `pnpm spec:validate` на единой согласованной версии;
      независимый reviewer проверяет pure boundaries и отсутствие удаления unarchived bytes.
- [x] 6.2 Координатор: проверить облачные операции в браузере на одноразовых файлах. Google
      подтвердил сохранность файла после stale DELETE 412 и отсутствие после точного DELETE. Яндекс
      подтвердил защищённое назначение, readback и точное удаление. Восстановление позднего снимка
      проверено локальными тестами. Границы приведены в [verification.md](verification.md).
- [ ] 6.3 Координатор: выполнить разрешённую очистку пользовательского набора только после всех
      gate-проверок и записать verified archive/record/v3, фактические counts и поздние остатки.
      Проверка: remote readback recovery после удаления и две версии Яндекса в спокойном состоянии.
- [x] 6.4 Координатор: провести изолированную визуальную проверку прогресса, Testing и отчёта;
      сохранить текстовый verdict и пути к артефактам, не смешивая static и real cloud proof.
