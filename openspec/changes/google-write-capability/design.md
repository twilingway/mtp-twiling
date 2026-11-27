# Design

## Context

Текущий WeakMap обнуляется при новой OAuth generation. Условный PUT Drive v2 с сильным ETag,
metadata SHA256 и фактическим hash тела уже проверен и сохраняется. Правила workspace/account
migration не меняются.

## Goals / Non-Goals

**Goals:** автоматическое доказательство полной ёмкости, безопасное восстановление, координация
вкладок, адресная очистка.

**Non-Goals:** resumable upload, расширение OAuth scope, удаление legacy или пользовательских
слотов, изменение привязки рабочих пространств.

## Decisions

- Техническое доказательство зависит от аккаунта, credential, lifecycle и durable fence, но не от
  portable revision. Правка графика во время пробы сохраняет её результат и очистку; строгая
  проверка ревизии после ensure отменяет старую пользовательскую запись, после чего автоматика берёт
  свежую копию без повторной пробы. Настоящие облачные конфликты и recovery block остаются
  блокирующими.

- Отдельный capability manager вызывает текущую бинарную пробу. Store подготавливает
  current+previous, затем ensure(requiredBytes), повторно проверяет головы и только после этого
  сохраняет pending.
- IDB preferences хранит ограниченные proof records и probe journal; запись выполняется
  транзакционно с проверкой signal. TTL 24 часа, максимум 16 proofs и 16 journal entries.
- Proof minimum binding: credentialId + public client ID + protocol 3 + codec 1 + transport
  revision + exact maxBytes. Свежий about.get user(permissionId) хешируется в памяти. Исходный
  permissionId не сохраняется и не логируется; alias применяется только после ответа текущей
  авторизации.
- Singleflight вкладки и Web Lock аккаунта либо credential fallback. После lock proof
  перечитывается. Сетевые изменения сохраняют существующий dispatch fence; DELETE также проходит
  fence.
- Probe reserve записывается до create. Создание помечается uncertain до отправки. finally выполняет
  ограниченную очистку через свежую точечную metadata-проверку. Немедленный 404 uncertain create
  журнал не снимает; успешный DELETE и подтверждённый 404 снимают. Чужие namespace/key/kind не
  удаляются.
- Default image fixture 1 MiB; при необходимости до 2 MiB. Проверяется полный package size; packages
  сверх максимума поддерживаемой пробы получают limit.
- Provider job и диагностическая операция вынесены из разросшегося provider. Новые production
  modules до 500 строк.

## Risks / Trade-offs

- Недоступна личность → безопасный fresh probe по credential без межcredential reuse.
- Отмена после отправки create → журнал переживает отмену и очищается при следующем подтверждении
  владельца.
- Неудачная cleanup → proof остаётся действительным, статус cleanup-pending.
- Неудачная IDB-запись → create не отправляется; отсутствие Web Locks в браузере блокирует опасную
  конкуренцию.

## Migration Plan

Новая приватная запись preferences не затрагивает существующие workspace records. Откат оставляет
безвредные приватные записи и не меняет облачные пользовательские файлы.
