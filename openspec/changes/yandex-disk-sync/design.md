# Design

## Context

Клиентская PWA хранит canonical workspace на устройстве. Яндекс поддерживает PKCE без client secret;
secretless refresh не доказан. Disk REST не документирует conditional replace. Исследование:
`artifacts/mtp-pixel-render/artifacts/yandex-sync-research.md` соседнего DEV worktree.

## Decisions

- PKCE S256 + state/verifier в sessionStorage, точный callback, одноразовое потребление. Токен и
  account binding сохраняются AES-GCM в IndexedDB vault с device key; секреты не входят в portable
  backup. Restore не открывает OAuth. Истечение требует повторного входа, без обещания часового
  срока.
- Независимый enabled/epoch/AbortController. Disable закрывает операции и не показывает provider
  errors; Google и банк не затрагиваются.
- Все файлы в `app:/mtp-yandex-v1`; API использует OAuth header, uploader — временную HTTPS
  capability без токена. Host allowlist и метод проверяются; скачивание допускает только
  документированные семейства и browser redirects, без пересылки токена произвольному host.
- Неизменяемая ревизия — самодостаточный бинарный bundle prepared payload + images с SHA-256 и
  собственными parent IDs. Persisted operation UUID фиксируется до сети; retry проверяет старый
  путь, не заменяет содержимое.
- Локальный single-writer lock, собственный device namespace, обнаружение fork и повторное
  стабильное перечисление. Новая версия полностью читается и проверяется до success. UI выбирает
  текущую и предыдущую версии каждой причинной ветви, сохраняя все unresolved branches.
  Автоматическая физическая очистка отключена до отдельно доказанного protected-set контракта. MD5
  delete доступен только для явно созданного diagnostic probe, обычные ревизии не удаляются.
- CAS capability всегда false. Неизвестный protocol/повреждённый bundle блокирует автоматическую
  запись. Schema v2 guard и подготовка изображений переиспользуются без потери будущих полей.

## Runtime gates

Публичный ClientID и DEV callback зарегистрированы отдельным исполнителем. Настоящий OAuth exchange
и transfer CORS/redirect в этом worktree ещё не проверены. Эти ограничения не оправдывают размещение
client secret в клиенте или добавление credential proxy.
