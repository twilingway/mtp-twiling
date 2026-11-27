# Яндекс Диск: клиентский provider

Factory: `createTerminalYandexSync(host, config)` из `controller-yandex-sync.ts`. Общие UI/host и
публичная конфигурация принадлежат общему исполнителю. `resume()` запускает локальное чтение
сохранённых флагов; отключённый provider не вызывает OAuth или сеть. Native apply использует общий
host и точный `acceptedRevision` из commit callback.

OAuth-приложение зарегистрировано отдельным исполнителем. Публичный ClientID:
`5eb8206c526a4c5593716703d091fa8d`. Единственное право — `cloud_api:disk.app_folder`. Callback —
`/__dev/app/yandex-callback.html` на localhost/127.0.0.1:5290 и `/yandex-callback.html` на
`mtp-test.twiling.ru`/`mtp.twiling.ru`. Страница должна загружать обычный app shell; callback
обрабатывает включённый provider после готовности canonical workspace. Клиентский secret не нужен.

Authorization Code + PKCE S256, `state`/verifier в sessionStorage на 10 минут; URL очищается до
token exchange. Базовый account id/client id проверяется через Yandex ID без дополнительных profile
scopes. Access token хранится в отдельном AES-GCM vault, не связан с банком и не попадает в backup.
Используется исходный `expires_in`; недоказанный secretless refresh не реализован, истечение требует
нового явного входа. Официальные контракты: [PKCE](https://yandex.ru/dev/id/doc/ru/codes/code-url),
[базовый user info](https://yandex.ru/dev/id/doc/ru/user-information).

Неизменяемые `.mtp` bundles в `app:/mtp-yandex-v1` содержат prepared portable Backup2 и бинарные
изображения с SHA-256. ID и точные байты операции сохраняются до сети, account и credential
generation входят только в локальный журнал. `overwrite=false`; CAS capability всегда false.
Неизвестный аккаунт/история, включая пустой новый Диск, требует выбора направления. Known forward
remote update применяется автоматически только при неизменённом локальном содержимом.

Обход использует только bounded headers: сначала 12 байт, затем точный размер JSON header. `Range`
применяется при поддержке сервера; ответ 200 читается до нужного префикса и отменяется. Полные тела
скачиваются только для выбранной версии и проверки текущих heads перед публикацией. Сводка header
проверяется по полным байтам перед принятием; исторические binary bodies не скачиваются ради списка.
Лимиты: 10 000 файлов, 32 MiB новых headers за проход, 512 MiB полных тел за операцию, 256 MiB на
bundle. Превышение даёт явную ошибку, без очистки и ложного успеха.

Логически доступны current/previous каждой причинной ветви; unresolved branches сохраняются.
**Автоматическая физическая очистка отключена**: строго два физических файла не обещаются. Native
file history и read+overwrite не используются как замена CAS.

Перед native import сохраняется durable apply intent, commit callback синхронно фиксирует
acceptedRevision. Сбой UI restore после commit не повторяет native write при retry. После reload
совпадение canonical digest с целевой версией также позволяет завершить receipt без нового импорта;
при неясном или изменённом состоянии сохраняется indeterminate и требуется явный выбор.

Диагностика: `runTerminalYandexSyntheticProbe(provider, cleanup)` возвращает только проверенные
флаги и имя случайного probe-объекта. Не читает workspace; токен, account id и signed href не
выходят из closure. `cleanup=true` удаляет только собственный `probe_<uuid>.mtp` с MD5 guard;
обычные ревизии этот API удалить не может. Запускать после настоящего входа, без token logging.

Реальные PKCE callback, upload/readback, transfer host/CORS/redirect, PWA reload и отмена ещё должны
быть проверены координатором на DEV. Unit mocks не являются доказательством работы настоящего
аккаунта. Production/сервер в этом change не запускались.
