# Контракт идентичности

Logical owner — device, physical — profile-v2:device. prepareDeviceWorkspace получает
preferredOwner, valid и signal и возвращает owner/primaryOwner/cloudOwner/legacyOwners/conflicts.
Текущий готовый видимый workspace имеет приоритет. Ready journal идемпотентен; legacy не
импортируется заново при каждом ключе. IDB копируется атомарно, localStorage staged в журнале и
применён до ready. Исходники не изменяются, конфликты сохраняются для восстановления. История,
coverage и камеры включены.

Flow сохраняет прежний client до готовности кандидата. После commit отмена блокирует UI adoption, но
не выдумывает rollback. Cold failure — явный recovery/retry без пустого готового workspace. Google
cloud session отделена от market session; выбранный cloudOwner сохраняет AAD namespace, credentials
не переименовываются и независимые heads не объединяются.
