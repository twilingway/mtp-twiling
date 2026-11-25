# Design

## Context

Образец towerdefander использует GitHub hosted CI и pull watcher main на сервере. В MTP уже есть
content buildId, package version и PWA с ACTIVATE_UPDATE. Основной target — Linux VDS с nginx; Mac
test остаётся отдельной последующей настройкой.

## Goals / Non-Goals

**Goals:** воспроизводимый SHA, атомарная статика, проверка публичных файлов, безопасный откат.

**Non-Goals:** серверный API, передача пользовательских ключей, изменение UI или соседних сервисов.

## Decisions

- GitHub запускает CI на hosted runner; VDS сам читает main и GitHub Actions API. Серверных SSH
  секретов в GitHub нет; private repo требует read-only deploy key и локальный Actions-read token.
- Контроллер установлен отдельно от checkout. На каждый SHA git archive создаёт чистый build; frozen
  install и pnpm check/spec:validate выполняются на сервере до публикации.
- Release manifest сборщика служит allowlist. Пути, symlink и скрытые/секретные файлы отклоняются.
- Полный каталог releases/SHA переключается rename временного symlink current. Прошлый релиз
  остаётся на диске. Lock через flock принадлежит systemd service; ручные операции используют тот же
  lock. Релиз не требует reload nginx.
- deployment.json имеет SHA и hashes всех файлов. Health проверяет их через публичный HTTPS;
  несовпадение возвращает прежний symlink. Диск не очищается автоматически, чтобы не удалить
  пригодный для ручного отката релиз; лимит диска контролирует оператор.
- Semantic version повышает автор PR при изменении входов сборки; контентный buildId вычисляет
  существующий builder. Ни CI, ни watcher не делают bot commits.

## Risks / Trade-offs

- Недоступный GitHub или сеть → отказ от новой публикации, старая статика продолжает работать.
- Ошибка public health из-за CDN → откат; шаблон nginx исключает длительное кэширование.
- Права build-пользователя → отдельный mtp-deploy user, только свой каталог и read-only GitHub.
- Первый релиз без предыдущего → при ошибке current удаляется, успех не записывается.
- Credentials, DNS, TLS и remote пока не настроены → инструкция фиксирует внешние prerequisites;
  локальные проверки не считаются реальным deploy.

## Migration Plan

Интегрировать и проверить ветку, создать private repository и main, дождаться GitHub CI. На VDS
проверить существующие nginx routes, сделать backup, добавить отдельный vhost и HTTPS, выполнить
nginx -t и reload. Установить отдельный controller, config и systemd timer. Первый deploy делать
явно, затем проверить public SHA/version/buildId и сценарий PWA через отдельного reviewer.
