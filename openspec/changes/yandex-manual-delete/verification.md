# Проверка

Coordinator source-тесты подтверждают реальное уменьшение восстановимых версий previous N→N-1 без
нового revision ID, без импорта local workspace и без замены принятой association. Проверены
защищённый current, stale local preview, ошибка сохранения exact plan до сети, незавершённые
upload/apply, отказ DELETE после maintenance move, explicit cold retry, запрет автоматического
DELETE из generic sync, ошибка финального local clear без false success, позднее продолжение после
disconnect.

Отдельно проверены explicit same-account reauthorization с тем же operationId/планом, отказ другого
аккаунта и остановка при новом local intent во время rebind. UI-тесты проверяют отдельное
подтверждение, отмену без эффекта, protected reasons, отсутствие первоначально открытого destructive
confirm и начальное пояснение разницы OAuth и подтверждённого обмена. Подтверждение старого клиента
показывает ID, дату и число удаляемых версий.

Core reader/maintenance в отдельных source-тестах проверяет v3 generation, pruned peers, full
current readback, exact CAS DELETE и cold retries. Независимый reviewer обнаружил дополнительный
adversarial fake-plan риск. По подтверждению координатора, исправление прошло повторное core ревью:
47 проверок reviewer и 55 author checks PASS. Общая публикация остаётся отдельным действием
координатора.

После UI/context ревью auth-required удаления использует общий failure status: connected=false,
pauseReason=auth-required, активный reconnect. Проверены token expiry и 401 после сохранения exact
плана, включая abort при invalidation, сохранность pending maintenance, отсутствие false ack первого
обмена и подавление позднего callback после явного отключения. Scoped coordinator/UI/host/journal
batch после исправлений: 129/129 PASS.

Тесты используют только локальные fixtures. Реальные облачные DELETE, изменения аккаунтов и ручная
синхронизация телефона не выполнялись. Визуальный smoke, общий check/build и выпуск выполняет
координатор.
