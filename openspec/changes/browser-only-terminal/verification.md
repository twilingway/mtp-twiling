# Проверка актуальности манифеста, 2026-11-28

## Scope

Изменён только маршрут точного `manifest.webmanifest` в шаблоне service worker: network-first с
`cache: "no-cache"`, query допустим; текущий build cache служит fallback при сетевой ошибке или
non-OK. Сетевой ответ не записывается в кеш. URL манифеста, id, start_url, scope и файлы значков
сохранены. Сторонние API и прежние GET/origin/scope/version-исключения сохранены.

## Automated verification

- `node test/service-worker-manifest.test.mjs`: **28/28 PASS**. Корневая `/`, `/quotes/` и
  `/nested/terminal/` области; свежий манифест поверх старого кеша, query, offline fallback, HTTP
  404/503 с кешем и без, исходное исключение без кеша, отсутствие перезаписи кеша, offline
  shell/активы, точные границы пути, API/origin/method/version-исключения, одна полная precache
  batch, явный `ACTIVATE_UPDATE`, очистка только своего scope, отказ install при ошибке batch.
- `node test/service-worker-navigation.test.mjs`: **13/13 PASS** существующих регрессий документов,
  shell aliases и границ перехвата.
- `pnpm spec:validate`: **138/138 PASS**, strict.
- Scoped Prettier для шаблона, нового теста и артефактов этого change: PASS.

Обычный `node --test ...` в sandbox завершился `spawn EPERM` до запуска тестов. Прямые команды выше
используют тот же `node:test` без дочернего процесса и завершились успешно на Node v22.22.1. VM
проверяет контракт единого `cache.addAll` и распространение его ошибки; атомарность браузерного
Cache API и реальное обновление service worker требуют отдельного browser smoke.

## Browser verification

Статическая сборка 0.3.50 / `32e02be63eac255b` проверена в собственном свежем профиле Chrome с
разрешённым service worker. Старый manifest подставлялся только в CacheStorage тестового профиля:
онлайн вернулся актуальный manifest с четырьмя PNG, при настоящем offline через Playwright context
вернулся старый кеш. Offline reload загрузил оболочку, 47 CSS и правильную версию. Кеш и сеть
восстановлены; собственные браузеры закрыты. PNG-брендинг просмотрен внутри изолированного агента.

На той же сборке Text → ввод → курсор без Save оставил видимый объект; reload сохранил запись
IndexedDB. Использованы ранее записанные реальные BTC-свечи, без искусственных цен. Повторная
отрисовка этой аннотации после reload этим узким smoke не утверждается: полная матрица объектов
описана отдельно в text-drawing-tools. Ошибок страницы нет. Отчёт и три просмотренных PNG:
`artifacts/mtp-pwa-final-smoke/manifest.json` основного workspace, ignored.

DevTools Offline на странице не отключал сетевые запросы service worker; для доказательства fallback
использован отдельный Playwright context с `serviceWorkers: "allow"` и настоящим
`context.setOffline(true)`. Ручная активация покрыта VM-регрессиями, актуальное переключение
пользовательской вкладки проверяется отдельно после публикации. Фактическая смена значка уже
установленного Android-приложения не подтверждена: расписанием управляют браузер и ОС, телефон
пользователь оставил себе.

Дополнительный пакет PWA/navigation/manifest: 46/46 PASS. Первоначальный sandbox `spawn EPERM` в
тесте временного статического сервера устранён разрешённым повторным запуском без изменения кода.
