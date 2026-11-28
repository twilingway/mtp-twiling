# Design

## Context

См. proposal.md. Текущий controller будит sync раз в 60 секунд, по focus/visibility/online; Yandex
resume планирует inspect даже без pendingChanges. Уже существующий digest исключает exportedAt и
рыночные поля watchlist, а совпадение heads+digest не публикует версию. Поэтому обращение к облаку
не доказывает лишний upload: нужны отдельные счётчики inspect/publish/delete. Camera/view уже входят
в portable digest, capture предварительно сбрасывает очередь камеры. Нового параллельного формата
смыслового состояния не требуется: закрепляем существующий контракт тестами и исправляем только
обнаруженный ложный trigger.

Список показывает legacy рядом с current/previous slot версиями разных устройств. Retention удаляет
obsolete carriers только своего writer; legacy исключён из manual delete. Поэтому 7–9 карточек сами
по себе не доказывают нарушение предела одного клиента. Текущее хранение может помещать current и
previous в один физический контейнер: предел относится к полным версиям, а не к двум файлам с
потенциально четырьмя payload. Delete выставляет syncing до ожидания writer lock; общий deadline
отсутствует, а существующие per-request retries и poll имеют собственные задержки. Нет
доказательства nested-lock deadlock или публикации от часов; disabled reducer уже нормализует
состояние при отключении.

## Goals / Non-Goals

**Goals:** понятные причины публикации; сохранение всех смысловых пользовательских изменений;
конечные и возобновляемые операции очистки; физическое удаление доказанных устаревших carriers.

**Non-Goals:** удаление независимых normal устройств по возрасту, обход future-format guards, смена
аккаунта или сброс авторизации, переписывание данных ради уменьшения числа карточек.

## Decisions

- Смысловой selector охватывает сохранённые view/camera, инструмент/интервал, layout, settings,
  watchlist и drawings/images. Классификация события общая для digest и dirty state; quote tick,
  candle clock, sync metadata, checkedAt/progress и transient draft исключены. Координаты камеры
  становятся dirty при пользовательском изменении, а не при live-follow нового бара. Сравнение
  canonical snapshots предотвращает ложный dirty от повторной записи тех же значений.
- Trailing debounce 750 ms имеет max-wait 5 секунд от первого dirty события. Занятый writer
  сохраняет dirty intent; после завершения заново захватывает последнее состояние. Snapshot,
  опубликованный во время новых изменений, подтверждает только свой digest; более новый draft
  остаётся dirty. Совпадение с принятой проверенной версией пропускает upload и logical revision.
  Периодический read-only inspect допустим для получения чужих версий и восстановления; он сам не
  порождает dirty, новый snapshot или фиктивное время успешной отправки.
- Normal сохраняет существующий device UUID; test использует прежний общий workspace-scoped id.
  Reload, URL/DEV-дetection и повторная авторизация не меняют сохранённый выбор. Нельзя объединять
  независимые normal браузеры по подписи, дате или одинаковым данным. Смена режима не меняет OAuth и
  не перепривязывает pending/maintenance другого writer.
- Cleanup строит граф проверенных версий и exact candidates, а не сортирует карточки по времени.
  Кандидаты — obsolete собственного writer и явно распознанные retired legacy/test carriers, чьи
  точные revision/hash покрыты проверенными accepted/ancestry references durable current. Сам факт
  наличия нового current, совпадение названия или mode недостаточны. Независимый current другого
  normal клиента, unresolved head, future/corrupt/unknown файл, pending staging и journal-pinned
  версия защищены. Существующее разрешение на cleanup применяется без нового вопроса;
  неоднозначность даёт pending/conflict, не удаление наугад.
- UUID legacy head и accepted slot tuple сами по себе не доказывают исходные байты. v3 envelope
  получает optional `acceptanceProofs`; поле находится вне SlotVersion, поэтому прежние
  versionHash/priorVersionHash не меняются. Формат заморожен в `slot-acceptance.ts`:

  ```ts
  type SlotAcceptanceProof =
    | {
        kind: "legacy";
        revisionId: string;
        bundle: { size: number; sha256: string };
      }
    | {
        kind: "slot";
        deviceId: string;
        seq: number;
        revisionId: string;
        versionHash: string;
      };
  // Только v3:
  // acceptanceProofs?: readonly SlotAcceptanceProof[]
  ```

  Legacy reference содержит размер и SHA-256 всего original binary, включая header и изображения, не
  только digest workspace. Slot proof содержит hash полного исходного SlotVersion, включая bundle
  SHA. Каждому удаляемому legacy ancestor нужен собственный original proof: hash head и его parents
  UUID не разрешают удаление изменённого предка. Fixed test retire требует exact tuple и original
  versionHash кандидата, не coversClaim с большей seq. Только после этой проверки существующий
  maintenance записывает durable prunedPeers перед DELETE.

- Новые proofs захватываются только в существующей explicit reviewed chooseLocal/rebind операции по
  проверенному снимку; capture полностью читает каждый выбранный legacy ancestor и fixed-test
  candidate и связывает bytes/header/listing с reviewed fingerprint до эффекта. Already committed
  pending retry и автоматическая публикация не создают proof свежим чтением прежнего accepted ID.
  Автоматические изменения наследуют известные proofs, metadata maintenance сохраняет их без
  изменений. Старый accepted ID без original proof остаётся protected/pending; доступен обычный
  выбор проверенной версии для нового точного подтверждения. Это путь согласования версии, а не
  новый запрос разрешения уже авторизованной очистки.
- Proofs canonical key: `legacy:revisionId` или `slot:deviceId:seq:revisionId`. Conflicting hashes
  одного ключа дают conflict, не last-wins. Два legacy файла с одним revision UUID и разным
  содержимым также дают conflict. Поле absent остаётся absent; v2 shape прежний. Старый strict v3
  reader отвергает неизвестное поле до write, не пересохраняет его без proofs. Новый reader читает
  старые envelopes, но не повышает UUID-only acceptance до destructive eligibility.
- Proof array ограничен 10000 записями и 256 KiB общим slot header; сохраняются прежние byte budgets
  и предел 10000 файлов. Ancestry обход итеративный, с visited/cycle guard и конечным лимитом узлов.
  Превышение лимита даёт limit/pending до удаления; proofs не обрезаются ради помещения в header и
  неполный обход не считается успешной очисткой.
- Перед первым DELETE полностью перечитывается новый current и проверяются payload/images/hash,
  подтверждение и идентичность account/writer. Перед каждым DELETE повторяются scope/settings guard,
  listing fingerprint и точные bytes/MD5 кандидата. Новый файл или ветвь требуют пересчёта плана.
  Delete conditional; 404 считается успехом лишь после проверки отсутствия точного кандидата и
  сохранности protected set. Ошибка cleanup не отменяет подтверждённый upload.
- Список группирует normal browser и общий test; внутри current/previous, а obsolete accepted
  history и unresolved branches получают отдельный статус. Pending уборка не скрывает физически
  оставшиеся версии. Совпадающий id не рисуется как несколько устройств.
- Операция удаления получает deadline, включающий ожидание local writer lock, сеть и readback:
  максимум 90 секунд одной попытки. Все шаги используют один abort signal; lock wait отменяется.
  finally освобождает busy, текущая эпоха получает confirmed/review/unconfirmed/cancelled статус.
  Durable maintenance journal хранится до проверенного результата; retry использует ту же operation
  identity и exact bytes, не создаёт повторную logical версию. Не более трёх автоматических retry с
  backoff; дальше явная доступная кнопка повтора без зависшего spinner.
- Между вкладками один writer lock; перед эффектом перечитываются enabled, automatic, mode и journal
  generation. Disable/logout/account change отменяют попытку и не удаляют токены/журнал. Запоздалый
  callback не снимает busy новой операции и не меняет другой scope.

## Risks / Trade-offs

- Слишком узкий selector теряет camera/layout → тесты каждой категории и round-trip snapshot;
  документировать точный список portable fields рядом с selector.
- Старый legacy/test не имеет original proof → оставить видимым с причиной pending и обычным выбором
  версии; не получать разрешение на DELETE из свежего SHA под прежним UUID и не объявлять глобальные
  две версии достигнутыми.
- Сеть оборвалась после эффекта → unconfirmed и тот же persisted retry plan; отсутствие ответа не
  означает ни успешное удаление, ни сохранённость кандидата.
- Поздняя вкладка публикует во время cleanup → rescan защищает новую ветвь; предел двух версий
  проверяется в спокойном состоянии, конфликты могут временно превышать его.

## Migration Plan

Сохранить IDs, auth vault, accepted baseline и recovery journals. Сначала доставить semantic
trigger/finite-operation guards; затем построить cleanup из проверенных текущих данных. Новая
durable current проверяется до удаления любых прежних fallback. После cleanup перечитать облако и
подтвердить физические current/previous, не только UI. Откат не восстанавливает удалённую историю;
текущая и предыдущая версии остаются полностью восстанавливаемыми.

Старые envelopes без acceptanceProofs продолжают читаться без изменения JSON shape. Их UUID-only
accepted entries пригодны для прежнего сравнения истории, но не для новой destructive cleanup.
Повторный автоматический sync не мигрирует такие записи свежими hashes. Новое exact подтверждение
возникает только через существующий reviewed version-selection путь. После появления proofs older
reader должен остановиться до mutation; downgrade не должен удалять поле из envelopes.

## Evidence

- `controller-cloud-sync.ts:154`, `yandex/coordinator.ts:302`: фоновые wake/inspect.
- `drive/backup.ts:115`, `controller-cloud-host.ts:183`: camera в digest и flush перед capture.
- `yandex/coordinator-publish.ts:54`: unchanged выполняет retryPrune без publish.
- `yandex/slot-retention.ts`: собственные obsolete carriers; `yandex/revisions.ts:158`: legacy
  manual deletion не разрешён прежним planner.
- `yandex/coordinator-delete.ts:80`, `yandex/journal.ts:357`: busy до lock, ожидание без общего
  deadline. Эти ссылки фиксируют исходную реализацию; результат проверяется по новой версии.
