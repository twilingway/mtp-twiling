# Design

## Context

Контракт согласован координатором до изменения общих типов. TBank UID остаются прежними. Для новых
серий canonical ID — `bybit:<category>:<nativeSymbol>`; `symbol` и opaque `uid` равны ему, `ticker`
содержит native symbol. Provider reference хранится во всех переносимых путях.

## Goals / Non-Goals

Цель — подключение Bybit к существующему терминалу с безопасной совместимостью локальных и облачных
профилей. Новые банковские операции, торговля, серверный market proxy и OKX не входят в этот source
scope.

## Decisions

- `MarketClient` владеет смешанным порядком и persistence. TBank получает фильтрованный cache и
  только банковские IDs; транспорт дополнительно проверяет запросы.
- `marketReady` отделён от `authenticated`. Публичный logical owner — `public`, банковский
  profileKey/credential vault не меняются.
- `storage-v2` отображает переносимые owner в `profile-v2:<logical>`; images возвращаются с logical
  owner. Atomic seed v1 защищён ready marker в той же транзакции. История банка читается также из
  старого cache без destructive DB upgrade.
- Экспорты2 строго сохраняют refs; reader1 запрещает публичный namespace. Старый локальный writer
  продолжает видеть свой v1 поток.
- Drive namespace `mtp-drive-v2` и binding `drive-v2:<owner>` изолированы. Старый `mtp-drive-v1`
  transport/sync запрещает записи; explicit migration повторно проверяет heads и owner/revision
  перед guarded import.
- Import/profile transition блокируют edits и Drive; portable copy ожидает facade mutation queue.
  Public→bank копирует лишь публичные rows/docs/images/views/flags, без замены банковских
  предпочтений.
- Bybit public REST/WS работает напрямую с credentials omit; CSP разрешает только официальные
  API/stream hosts. Отдельный remote proxy не вводится.

## Risks / Trade-offs

Локальные fake-only тесты проверяют реальные facade, storage transactions, schema и readonly Drive
boundary. Визуальная проверка обоих движков и живой браузерный CORS/WS smoke остаются gate
координатора; unit tests их не заменяют. OKX fallback пока отсутствует и не имитируется
при403/429/network errors.

Root TA commits интегрируются отдельно: их optional `technicalIndicators`/`technicalPaneLayout`,
validators и Drive allowlist необходимо объединить с provider fields. Миграция сохраняет layout
fields без ручного урезания; private vault остаётся вне physical prefix.

## Migration Plan

Первый запуск создаёт отдельный локальный v2 snapshot атомарной копией; v1 остаётся. Новый Drive
stream стартует отдельно после явного legacy выбора. При откате оболочки старое приложение читает
прежний v1; данные v2 не удаляются, но недоступны старой оболочке. Версия релиза, публикация и
браузерная приёмка выполняются координатором отдельно.
