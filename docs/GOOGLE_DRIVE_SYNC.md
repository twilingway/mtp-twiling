# Google Диск: синхронизация личного профиля

Ядро `src/services/drive/` подключено к разделу аккаунта, controller queue/barrier/recovery и
локальной привязке IndexedDB. В Chrome подтверждены реальный вход и условная запись технического
файла. Проверка фактического двоичного контейнера на двух устройствах остаётся отдельной задачей.

## Условная запись файла клиента

Слот хранит текущую и предыдущую версии в одном двоичном файле `appDataFolder`. Перечисление,
резервирование ID и создание идут через Drive API v3. Полное чтение содержимого v3 обрамляют два
чтения метаданных v2 без кэша. Полное чтение требует совпадения номера версии, размера, метки и
серверного SHA-256. SHA-256 скачанных байтов должен совпадать с серверным. Если контрольную сумму не
удалось подтвердить за три попытки, клиент завершает чтение без условной замены.

Замена использует документированный PUT v2 с `If-Match`. Повторное чтение сверяет ID, размер,
сильный ETag ответа и ожидаемый двоичный контейнер. В живой пробе `version` в ответе PUT отличался
от `version` позже согласованного чтения при одинаковом ETag. Ответ `412` показывает конфликт. При
неопределённом ответе журнал сохраняется для повторного чтения.

## Автоматическая проверка записи v3

При первой пользовательской записи клиент сначала собирает полный пакет current+previous и
автоматически проверяет достаточную ёмкость условной записи. Ручная «Проверка записи» остаётся
необязательной диагностикой. До успешной проверки durable pending пользовательского слота и его
запись не создаются. После проверки повторно сверяются локальная ревизия, credential, enable epoch и
текущие облачные головы; устаревшее действие не продолжается.

Правка локального графика во время технической пробы не отменяет независимое доказательство аккаунта
и его очистку. Старая пользовательская запись отменяется до pending/reserve; при включённой
автоматике следующая операция берёт свежую копию и использует уже сохранённое доказательство.
Отключение, смена аккаунта и credential по-прежнему отменяют саму пробу.

Синтетическая проба использует тот же двоичный кодек 1 и условный PUT v2: два конкурента получают
один успех и один `412`, итоговый пакет подтверждается сильным ETag и фактическим SHA-256 тела.
Обычный fixture с изображением 1 MiB проверяет **2 099 151 байт полного пакета**. При необходимости
используется существующий bounded fixture с изображением до 2 MiB, максимум **4 196 303 байта**
полного пакета. Более крупная пользовательская версия получает `limit` без удаления локальных
данных; resumable для слотов v3 не реализован. Размер изображения не считается размером пакета.

Несекретные доказательства живут до 24 часов в приватной записи preferences
`private:google-write-capability:v1`: credential ID, публичный Client ID, protocol/codec, revision
транспорта, точный проверенный полный размер и время. Максимум 16 доказательств. Reload того же
credential восстанавливает действительное доказательство. Новый OAuth credential может использовать
его только после свежего `about.get(fields=user(permissionId))` с текущей авторизацией; permissionId
хешируется в памяти и не сохраняется/не логируется. Email, profile и дополнительный OAuth scope не
запрашиваются. Если личность недоступна, новая проба привязывается только к текущему credential. Эти
записи не меняют workspace/account migration и не экспортируются в пользовательский backup.

Одна вкладка объединяет параллельные запросы проверки. Web Lock аккаунта либо credential вместе с
revision транспорта координирует вкладки; после получения lock доказательство перечитывается.
Enable/account dispatch fence распространяется также на DELETE. Блокировка защищает отправку, а не
ожидание ответа: отключение не ждёт зависший запрос Google.

Перед create зарезервированный собственный ID записывается в приватный журнал (не более 16 записей).
Очистка рассматривает максимум четыре адресных записи за проход и не перечисляет legacy или
пользовательские слоты. Только свежие metadata с совпадением сгенерированного ID, имени,
`mtp-drive-cas-probe`, `device-slot` и точного key разрешают DELETE. Успешный DELETE и следующий 404
снимают запись. Немедленный 404 после неопределённого create её сохраняет: файл ещё может появиться
позднее. Повторная очистка использует только тот же credential либо свежеподтверждённый аккаунт;
отменённое задание A не очищает свои файлы авторизацией B.

Ошибка очистки сохраняет доказанную ёмкость. `GoogleStatus.writeCapability` показывает
`checking | ready | cleanup-pending`, `verifiedBytes`, `requiredBytes`, `cleanupPending`;
`uploadProbeBytes` остаётся числовым совместимым полем. Автоматическая проверка входит в
`driveProgress` этапа `prepare-upload` и его время, независимо от открытого окна настроек.

Регрессии: `drive-write-capability.test.mjs`, `drive-device-slot-store.test.mjs`,
`drive-device-slot-explicit-link.test.mjs` и `drive-device-slot-media-validator.test.mjs`. Ни
unit-тесты, ни ранее выполненная живая проба d7c2b11 не подтверждают пользовательскую синхронизацию
между двумя реальными устройствами после этого изменения.

## Авторизация

Статическая PWA обращается прямо к Google, без backend и client secret. Каждый человек выбирает свой
Google-аккаунт. Единственный запрашиваемый scope — `https://www.googleapis.com/auth/drive.appdata`;
`include_granted_scopes: false`. Публичный Client ID:
`570894753392-14e7houtg7kc4cdeq6ndpjo7e7sbvnc1.apps.googleusercontent.com`.

`DriveAuth.prepare()` только загружает GIS. После его завершения UI включает кнопку подключения.
`connectFromUserGesture()` вызывается непосредственно в обработчике клика, без предварительного
`await`: это синхронно открывает выбор аккаунта с `prompt: select_account`. Авторизация никогда не
начинается из таймера, восстановления страницы или обработчика сетевой ошибки.

Access token шифруется в локальном vault и привязан к владельцу профиля и OAuth Client ID.
Перезагрузка может восстановить действующий токен до первоначального срока с запасом 30 секунд.
После истечения или ответа 401 нужен новый вход по клику. Каждый успешный вход или восстановление
возвращает отдельный `DriveAuthorization` с непостоянным `connectionId: UUID`, `signal`,
`getAccessToken()` и `invalidate()`. Истечение и отключение отменяют текущий signal.

`auth.suspend()` останавливает сессию в памяти и оставляет действующий токен в vault для
восстановления. `auth.disconnect()` также удаляет сохранённый токен. `auth.disconnect(true)`
дополнительно отзывает доступ, если есть действующий токен. Окно подключения имеет timeout 120
секунд, загрузка GIS — 20 секунд.

Основание:
[GIS token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model) и
[JS reference](https://developers.google.com/identity/oauth2/web/reference/js-reference).

## Точный публичный API

Дальнейшие разделы описывают сохранённый API/транспорт legacy v1/v2. Текущий UI файлов клиентов v3
использует `GoogleSlotProvider`; его ограничения и проверка записи описаны выше.

Импортировать из `src/services/drive/index.ts` (в TS imports проекта — `./services/drive/index.js`).

```ts
const auth = new DriveAuth();
await auth.prepare(); // заранее, до клика

// Непосредственно внутри click handler:
const pending = auth.connectFromUserGesture();
const authorization = await pending;
const sync = new DriveSync(new DriveTransport(authorization));
const remote = await sync.inspect();
```

| API                                           | Результат                                                             |
| --------------------------------------------- | --------------------------------------------------------------------- |
| `sync.inspect()`                              | `{ snapshots: RemoteSnapshot[], heads: string[], conflict: boolean }` |
| `sync.download(nodeId)`                       | Проверенная и очищенная `Backup` v1, ничего не импортирует            |
| `sync.publish(backup, { deviceId, parents })` | `{ nodeId, inspection }`, максимум один родитель                      |
| `sync.resolve(backup, { deviceId, parents })` | Такой же результат, минимум две текущие вершины                       |
| `sanitizeDriveBackup(unknown)`                | Глубокая проекция разрешённых полей и проверка существующим validator |
| `driveBackupDigest(unknown)`                  | SHA256 разрешённых данных без меняющегося `exportedAt`                |

`RemoteSnapshot` содержит `manifest` и метаданные `file`. Манифест включает `protocol: 1`, случайные
`nodeId/deviceId: UUID v4`, `parents`, `createdAt`, SHA256/размер JSON payload и каждого
изображения. `deviceId` создаётся один раз для установки, не из bank key. `createdAt` служит
подписью времени, порядок графа и выбор актуального снимка определяются только родителями.

`DriveConflictError` содержит `code: "conflict"` и актуальные `heads`. Остальные `DriveError.code`:
`auth-required`, `auth-cancelled`, `not-ready`, `busy`, `network`, `quota`, `permission`,
`remote-invalid`, `limit`; `status` может содержать HTTP status. Тексты ответов Google и токены не
включаются в ошибки приложения.

## Контракт UI/storage bridge

1. Хранить локальную `DriveLocalAssociation` отдельно от авторизации Google и bank owner:
   `{ schemaVersion: 1, markerId: UUID, deviceId: UUID, baseHeads: string[], lastSyncedDigest? }`.
   `markerId` — устойчивый локальный идентификатор связи с профилем. При смене bank key переносить
   эту связь как связь профиля; не вычислять её из нового токена/отпечатка. Ничего из этой записи
   целиком не загружать на Drive. В манифест идут только deviceId/parents.
2. После каждого входа сначала `inspect()`. Сохранённые `baseHeads` должны присутствовать в
   проверенном каталоге снимков, включая историю текущих вершин. Если хотя бы одна вершина
   отсутствует, возможен другой аккаунт или удаление данных. Отправка локального снимка или
   применение облачного требуют явного выбора, даже если облако пусто или локальные данные чистые.
   Google email/sub не запрашиваются.
3. Пустой Drive и новый профиль без ранее принятой вершины допускают `publish` с `parents: []` при
   первом входе. При подключении нового профиля к непустому Drive сначала показывается выбор.
   Успешный вход запускает первую проверку и при отключённой автоматической синхронизации.
4. Создавать копию через `storage.createBackup(localOwner, { includeHistory: false })`. Передавать
   её только `DriveSync`, а не `DriveTransport.create`. Ядро всё равно повторно удалит историю,
   котировки и неизвестные поля. Для dirty-check использовать `driveBackupDigest()`.
5. Локальное изменение после принятого снимка: `publish(backup, { deviceId, parents: baseHeads })`.
   Требуются точное совпадение с текущими вершинами и максимум один родитель. Гонка другого
   устройства после этой проверки всё ещё создаст безопасную параллельную ветвь. Проверять
   возвращённый `inspection.conflict`; не объявлять пользовательские конфликты автоматически
   разрешёнными.
6. Если у чистого профиля есть единственная новая облачная вершина из той же истории, скачать её и
   применить через существующий импорт. При локальных изменениях, нескольких вершинах или отсутствии
   ранее принятых вершин показать выбор сохранённого варианта.
   `resolve(chosenBackup, { deviceId, parents: allObservedHeads })` создаёт новый снимок со всеми
   родителями. Данные старых ветвей остаются на Drive; автоматического объединения отдельных
   рисунков/настроек нет.
7. После успешного publish сохранить `baseHeads: [result.nodeId]` и digest именно опубликованной
   локальной копии. Если в процессе были новые локальные изменения, их digest отличается: оставить
   dirty. После импорта сохранить head/digest импортированной копии. Не делать первый auto-import
   без выбора пользователя.
8. Проверять неизменность локального профиля, `connectionId`/signal и UI generation перед импортом,
   сохранением локальной ассоциации и обновлением состояния после любого `await`. Отключение
   отменяет HTTP, но уже полученная в памяти Backup сама по себе не привязана к текущему UI.
9. При `auth-required` включить кнопку переподключения; при offline/quota сохранить dirty и дать
   повторить. Не открывать OAuth автоматически. Повторный `inspect()` обязателен после
   неопределённого исхода publish: снимок мог уже сохраниться до потери ответа/отключения.

В одном Google Drive namespace содержит один личный workspace. Два разных аккаунта Google не
обмениваются им. Shared Drive, выдача разрешений другому человеку и bank account API не
используются.

## Формат и целостность

Файлы создаются только в `parents: ["appDataFolder"]`, читаются через `spaces: appDataFolder` и
фильтр `appProperties` namespace `mtp-drive-v1` плюс `mtpKind: snapshot|blob`. `mtpKey` — UUID узла
или SHA256 blob, `mtpHash` — SHA256 содержимого файла. Имена не включают owner, ключ или их хеши.
Все страницы listing читаются; incompleteSearch/повтор страницы/превышение лимитов останавливают
sync.

Сначала загружаются content-addressed blobs, затем неизменяемый JSON manifest. JSON blob содержит
валидную Backup v1 с пустыми `images[].data`; бинарные изображения хранятся отдельными blobs.
История отсутствует. Метаданные watchlist сохраняют UID/FIGI/ticker/name/brand/currency/step,
тип/даты инструмента и пользовательские mark/color; цены, время котировок, previousClose,
change/changePercent, runtime availability/note удаляются. Сохраняются тема, настройки индикаторов,
панели инструментов/шаблонов, drawings/images/views. Неизвестные поля на любом уровне удаляются.

Перед импортом проверяются manifest SHA256, схема, граф родителей, SHA256/размер payload и каждого
изображения, число/типы изображений и существующий Backup validator. Отсутствующий родитель, цикл,
конфликт двух разных manifest с одним nodeId или повреждение файла блокируют импорт. Совпадающий
blob перед повторным использованием тоже скачивается и проверяется.

Нет mutable head pointer, PATCH существующих снимков, last-writer-wins и удалений. Listing не
транзакционен; новая ветвь, созданная уже после listing, будет обнаружена следующим inspect.
Короткий период отсутствия родителя в listing вызывает безопасный отказ, который можно повторить.

[appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata) является скрытой
папкой приложения, её нельзя share/trash. Пользователь может удалить данные приложения средствами
Google. Это не заменяет отдельную резервную копию.

## Транспорт, размеры и retry

- Multipart/related для файлов до 5 MiB; более крупные идут resumable с частями 1 MiB.
- После потери ответа или временной ошибки части запрашивается подтверждённое смещение через
  `Content-Range: bytes */total`; учитывается серверный `Range`, а не предположение об отправленных
  байтах. Сессия 404 запускается заново, максимум три сессии на операцию.
- `files.generateIds(space=appDataFolder)` выдаёт ID до создания. Повтор POST с тем же ID после
  неопределённого ответа приводит к 409; тогда проверяются метаданные существующего файла.
- 429/5xx и 403 rateLimitExceeded/userRateLimitExceeded повторяются максимум четыре запроса с
  exponential backoff/jitter/ограниченным Retry-After; permission denied не повторяется. Четыре
  ответа resumable без прогресса останавливают передачу. Пользователь может повторить sync.
- Authorization не передаётся на URL из произвольного ответа: resumable Location допускается только
  на HTTPS www.googleapis.com `/upload/drive/v3/files`; redirects отключены. Cookies не идут.
- Лимиты core: JSON payload 16 MiB, одно изображение 21 MiB, payload+изображения 256 MiB, manifest
  512 KiB, 1000 изображений, 10000 файлов каждого вида и 64 MiB каталога manifest. Существующий
  Backup validator дополнительно ограничивает base64 одного изображения 28 MiB. Приложение может
  вводить более низкий лимит загрузки изображений.
- Сессия resumable живёт только в памяти текущей операции. После reload данные повторно отправляются
  с нового ID; завершённые проверенные blobs переиспользуются. Автоматического retention нет.

Google описывает
[uploads и возобновление](https://developers.google.com/workspace/drive/api/guides/manage-uploads),
[generateIds](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds),
[pagination](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list),
[ошибки](https://developers.google.com/workspace/drive/api/guides/handle-errors) и
[изменяемые quotas](https://developers.google.com/workspace/drive/api/guides/quotas). Документы
прочитаны 25.11.2026; численные тарифы/quota не зашиты в код.

## Проверка и границы результата

`node --test test/drive-sync*.test.mjs` проверяет реальные модули TypeScript через in-memory
transpile, без сборки приложения и без сетевых запросов. Покрыты deep allowlist, roundtrip,
SHA256/повреждение, неизменяемые ветви и явное resolve, stale parent, failed upload, fake GIS,
expiry/cancel/reconnect, namespace/pagination, multipart retry/idempotency, resumable
lost-response/status/restart/stall, 401/quota/permissions и запрет произвольного Location. Отдельные
body-stream regressions проверяют отключение/expiry/reconnect уже после получения HTTP headers:
ошибки сохраняют `auth-required`, обрывы активной сети возвращают `network`, полностью полученный
некорректный JSON — `remote-invalid`. Проверки охватывают binary, listing, ответ создания файла и
чтение причины 403; браузерные DOMException/TypeError не выходят в UI.

Typecheck/ESLint/Prettier выполняются отдельно. Из fake tests не следует готовность реального OAuth,
Google popup/cross-origin headers, визуального UI, двух устройств или публикации.
Production-переключение OAuth и privacy в Google Console это ядро не меняет.

## Подключённый интерфейс и автоматическая работа

`GoogleDriveSettings` находится в окне аккаунта. До готовности GIS кнопка выключена; вход
запускается по клику. Есть статус/время, кнопка sync, автоматический режим и disconnect. Отключение
не отзывает consent и не удаляет файлы: управление доступом/скрытыми данными описано в
`public/privacy.html`.

`controller-drive.ts` владеет coordinator на экземпляр controller (WeakMap), подпиской на portable
изменения, focus/visibility и периодом 60 секунд только видимой страницы. Обычные изменения
объединяются debounce 1500 мс; цены/свечи не входят в signature/digest. При открытом другом
редакторе, active tool, загрузке истории или import/recovery автоматический перенос ждёт. Отключение
автоматики оставляет явную кнопку. Никаких фоновых popup/refresh tokens нет.

Локальная запись `preferences/drive-v2:<owner>` содержит случайные marker/device UUID, baseHeads,
последний digest/time и auto flag. `preferences/drive-device` хранит идентификатор установки. Обе
записи исключены из createBackup; owner и экземпляр банковской сессии проверяются до применения и
смена любого из них сбрасывает Google OAuth, запросы и старый preview.

Первое подключение показывает выбор при непустом облаке и создаёт снимок при пустом облаке. При
повторной синхронизации чистый профиль автоматически принимает единственную новую вершину той же
истории. Расхождение локальных данных и облака, несколько вершин или исчезновение ранее принятой
вершины требуют явного выбора. Интерфейс показывает количество инструментов, рисунков и изображений
и даты доступных снимков (до восьми). Выбор повторяет export/digest/revision/inspect. Новые
изменения после preview или во время скачивания отменяют импорт.

`controller.importBackup(backup, { replacePortable: true, valid, onCommitted })` использует ту же
per-owner очередь и import barrier. Полный layout/watchlist/drawings/images/views заменяется одной
IDB-транзакцией; history/vault/чужие owner/Drive record сохраняются. Режим никогда не импортирует
history. Guard проверяется после очереди/flush/saveView, перед transaction и перед writes в ней.
`onCommitted` переключает подавление собственного restore echo; затем экспортируется фактически
восстановленный профиль с default/migration полями, чтобы не публиковать повторный снимок. Ошибки
после commit оставляют retired adapter и существующий recovery, не повторяя запись backup.

`importWritable` блокирует новые изменения preferences/watchlist/рисунков/жестов только во время
import/recovery, с повторными проверками после await. Export/pull остаются интерактивными: новые
изменения отменяют stale incoming apply. В интерфейсе controls становятся inert с пояснением;
аккаунт/выход/disconnect доступны. Login/logout синхронно публикуют `authenticated:false`, чтобы
остановить Google ещё до завершения банковского flush/закрытия.

Allowlist включает locale/timeZone/favoriteIntervals/indicatorPaneLayout/legendCollapsed, toolbar,
панели, глобальные индикаторы, цвета меток/фильтр. Флаги ограничены семью цветами и uid/legacy
ключами. Backup v1 по-прежнему использует текущие RF symbol namespaces. Bybit и Backup v2 в эту
интеграцию не входят, автоматической identity migration нет.

`test/drive-coordinator.test.mjs`, `test/portable-import.test.mjs` и queue/camera regressions
проверяют реальные TS-модули с fake store/IDB boundary: no echo, нормализацию, owner/session abort,
истечение, preview race, локальную правку во время pull/commit, atomic delete/update/rollback и
обычный merge. Настоящая Google-сессия, реальные quota и два устройства ими не подтверждаются.

Локальный `server.mjs` и `deploy/static/nginx.conf` содержат одинаковые узкие CSP Google endpoints и
COOP `same-origin-allow-popups` по
[официальному OAuth setup](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid).
Страница privacy опирается на
[appDataFolder](https://developers.google.com/workspace/drive/api/guides/appdata),
[token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model),
[управление скрытыми данными](https://support.google.com/drive/answer/6374270) и
[Google User Data Policy](https://developers.google.com/terms/api-services-user-data-policy).
Реальные server headers необходимо проверить после публикации, включая отсутствие второго
унаследованного CSP/COOP, блокирующего Google.

Проверено 25.11.2026 в `feat/drive-sync-ui`: `pnpm check` PASS (format, ESLint, strict TypeScript,
изолированная сборка `749c961e0cf8df1a`, 280/280 тестов), `pnpm spec:validate` PASS 12/12. Общий
localhost:5210, браузер, OAuth и Google Cloud этим прогоном не менялись.
