# Проверка

Исходный source regression воспроизвёл обратную отправку: два независимых host делят journal и cloud
fixture. A принял P1 и отправил P2; неизменённый B при sync отправил старую P1, увеличив число
uploads с 2 до 3. Это конкретный подтверждённый дефект, а не вывод о причине любого сообщения на
телефоне.

После исправления проверены: unchanged B получает P2 без лишнего snapshot; самостоятельные edits B
сохраняются с conflict; delayed auth сохраняет opening baseline; неизвестная история всё ещё требует
явного направления; failed refresh останавливается до export flush; current camera A остаётся
байт-в-байт в canonical store, а B сбрасывает только свой cache. Metadata snapshot читает только
association values current namespace в readonly IDB transaction и не читает auth values/не создаёт
device ID.

На реальном телефоне readonly getter выполнен отдельным оператором 28.11.2026,
`mtp-phone-y-1795857170167-{chrome,pwa}-cloud-readonly.json` в диагностическом каталоге
`artifacts/mtp-phone-viewport-vertical-20261128`. Оба контекста имели один origin,
normal/enabled/automatic/connected, phase conflict, pendingChanges=true и четыре видимых версии двух
других клиентов. В проекции проверенного текущего namespace были settings, но не были найдены
deviceId/association/pending/apply-intent, lastSyncedAt также отсутствовал. Legacy namespaces и
прошлые действия пользователя этим getter не проверялись. Это не доказывает, что пользователь раньше
не выполнял обмен, и не связывает текущий телефонный banner автоматически с source rollback repro.

После независимого ревью исправлен повтор восстановления shared runtime: временный owner-scoped
журнал сохраняет mode до camera действий, в том числе для холодного retry; старый adapter заранее
лишается persistence. Проверены ошибки prepareProfile/client.start/loadHistory, обычный UI retry без
аргумента, новая инстанция retry и сохранение canonical camera A. Обычный import retry по-прежнему
очищает старые shared-camera записи; успешное завершение не оставляет sticky preserve mode. CAS
clear не удаляет более новую операцию или запись другого owner.

Scoped batches после этих исправлений: chart/import/queue 30/30 PASS; Яндекс
coordinator/UI/host/journal 129/129 PASS; Drive reader/future reader/lifecycle 105/105 PASS. Эти
проверки используют fixtures.

Третий P2 воспроизведён RED-before на production storage-v2 → storage.ts с native-boundary IDB
fixture: успешный ordinary import оставлял shared-runtime receipt. После atomic receipt fix 6/6
regressions PASS: onCommitted throw, postcommit guard, отсутствие отдельного postcommit receipt PUT
при квоте, cold default retry и rollback ошибки первой/второй native записи. Committed данные
связаны с mode import/operationId/nativeImportId/storageOwner одной транзакцией; failed commit
сохраняет прежний shared receipt. Все проверки используют локальные fixtures, не реальное облако.

Облачные записи, синхронизация, импорт и DELETE на реальных аккаунтах в этой задаче не выполнялись.
Сборка, визуальный smoke и выпуск принадлежат координатору.

## Холодный запуск после native commit

Независимое release-ревью обнаружило, что durable receipt читался лишь явным retry. Actual new
controller.start воспроизвёл старую shared camera вместо импортированной (RED). Запуск теперь читает
owner-scoped receipt до первого chart read, запрещает запись старого вида до обязательного flush и
сохраняет барьер при ошибке. Сохранённый ключ банка восстанавливается до финальной загрузки истории;
пустой watchlist считается успешным восстановлением без графика.

10 новых cold-start регрессий проверяют оба режима камеры, foreign owner, read/reset/client/history
failure с реальным public recoverBackup, пустой список и сохранённый bank token. Совместный scoped
batch: 62/62 PASS. Эти проверки используют локальные native-storage/market-boundary fixtures.
