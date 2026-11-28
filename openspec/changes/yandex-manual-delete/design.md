# Design

## Context

v2 объединяет current и previous; простой DELETE карточки previous удалил бы оба payload. accepted
peer references требуют наличия peer metadata. API предоставляет immutable staging move и MD5
conditional DELETE, но не conditional overwrite.

## Goals / Non-Goals

Цель: реальное сокращение истории без нового logical revision и с повторяемой явной операцией. За
пределами: автоматическое уничтожение независимых heads, очистка legacy/неизвестных форматов и
изменения Google.

## Decisions

- v3 magic `MTPYDX03`; имя остаётся `slot_DEVICE_generation.mtp`, видимое старому reader. Для v2
  generation равен current.seq. v3 generation увеличивается отдельно от logical seq; maintenance
  сохраняет current целиком.
- v3 допускает previous=null при logical seq>1. Во время staging старый и новый контейнеры могут
  иметь одинаковую logical seq только при одинаковом version hash. Выбирается большее physical
  generation.
- Удалённый dominated peer замещается prunedPeers proof exact device/seq/revision/hash/accepted;
  surviving accepted обязан покрывать proof. Будущие writer переносят proof. Независимый head
  защищён.
- План фиксирует полный список файлов, heads, protected current hashes,
  staging/destination/body/reference и точные кандидаты. Журнал привязывает его к аккаунту,
  credential generation и writer device; незавершённые upload/apply операции блокируют maintenance.
- Только explicit UI confirmation запускает план. Запись immutable, readback полного сохранённого
  current, затем CAS DELETE по точному MD5, повторный обход и отсутствие selected payload перед
  подтверждением. UI перечитывает список; локальный workspace и accepted digest не заменяются.
- Повтор плана допускает лишь ожидаемые собственные завершённые шаги; неожиданный файл или
  изменённый current блокирует удаление. Ни headers, ни signed download URLs не служат
  подтверждением payload.

Явное повторное подтверждение после нового входа допускает смену только credential generation
сохранённого плана. Сравнивается проверенный Yandex UID из authorization и writer ID; аккаунт не
выводится из логина или подписи. Перед заменой сохраняется одна bounded audit-запись на аккаунт с
operationId, исходным и новым поколением, без токенов. UUID операции, exact Blob, references и
облачные pins не меняются; executor заново связывает план с фактическими полными байтами облака.
Обычная синхронизация этого не выполняет.

## Risks / Trade-offs

- Старое PWA уже выполняет write до обнаружения v3 → отсутствие глобального server lock нельзя
  скрыть; повторный scan сохраняет позднюю неизвестную ветвь и требует сравнения.
- Аккаунт изменился или credential generation обновилось без нового подтверждения → старый план
  сохраняется, автоматического удаления нет.
- Пользователь обновил интерфейс после partial commit → сохранённый план предлагается повторить
  явно, без смены operationId.

## Migration Plan

v1/v2 остаются читаемыми новым клиентом. Только подтверждённое удаление переводит нужные контейнеры
в v3; обычные публикации после этого сохраняют v3 proof и физическую generation. Откат приложения к
v2 требует обновления reader; перезаписывать v3 старой оболочкой нельзя.
