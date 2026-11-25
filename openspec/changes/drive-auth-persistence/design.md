# Design

## Context

См. proposal.md. GIS token model выдаёт access token без refresh token. Его замена после expiry
требует пользовательского действия:
https://developers.google.com/identity/oauth2/web/guides/use-token-model. `prompt: none` управляет
запросом экранов Google и не превращает token model в refresh grant. Пользователь подтвердил строго
клиентскую архитектуру; другие OAuth-модели не внедряются.

## Goals / Non-Goals

**Goals:** переживать reload/reopen до исходного expiry; не переносить разрешение между банковскими
владельцами; возобновлять разрешённую автоматику при открытии приложения и восстановлении сети.

**Non-Goals:** бессрочный вход, фоновые окна OAuth, серверные посредники, изменения семантики
конфликтов и импорта, изменение банковского vault или экспорта credentials.

## Decisions

- Общий non-extractable AES-GCM device-key используется через экспортируемый helper с общей Promise
  и атомарным созданием. Новый vault record содержит только ciphertext/IV и идентификатор поколения.
  AAD и зашифрованный payload связывают owner, Client ID и scope.
- Сохраняются абсолютный expiry с прежним запасом 30 секунд, исходное время и scopes. Restore не
  продлевает срок. Ошибка сохранения не отменяет действующее подключение в памяти и видна отдельно.
- `suspend` очищает старые handles и abort-сигналы, но сохраняет ciphertext при lifecycle teardown.
  `disconnect` и bank logout удаляют запись; invalidate/expiry удаляют только своё поколение.
- Coordinator загружает настройки автоматизации и пробует restore один раз для подтверждённой
  банковской сессии. Поздний результат старой сессии отбрасывается. Restore не загружает GIS SDK.
- Offline hint блокирует export/API до первой операции. Перед экспортом проверяется действительность
  разрешения. Ошибки сети сохраняют dirty/baseHeads/digest; online/focus возобновляют существующую
  автоматику с ограниченным периодом, без отдельного ping и OAuth popup.

## Risks / Trade-offs

- Доступный origin JavaScript может использовать локальный ключ → существующий CSP и отсутствие
  plaintext в storage/backup; шифрование не обещает защиты от скомпрометированного origin.
- Google может раньше отозвать токен → 401 invalidates, удаляет запись и требует явного нового
  входа.
- Недоступен IndexedDB → текущая memory-сессия работает, но UI честно сообщает, что вход не
  сохранён.
- Реальное browser/PWA QA выполняет координатор после общей сборки; этот change проверяется source
  tests.

## Migration Plan

Старых persisted Google credentials нет. Первая успешная авторизация создаёт запись нового
namespace. Откат не читает эту запись; последующая версия удаляет её по expiry/отключению. Общий
device-key сохраняет прежний формат банковского шифрования.
