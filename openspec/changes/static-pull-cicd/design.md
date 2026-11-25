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
  секретов в GitHub нет. Публичный repo не требует credentials; private остаётся optional с
  read-only deploy key и локальным Actions-read token. Общий cooldown 300s не зависит от SHA,
  максимум 24 API вызова/час с повторным gate. Rate headers и HTTP 403/429 откладывают публикацию
  без обхода.
- Контроллер установлен отдельно от checkout. После exact-SHA push CI git archive создаёт чистый
  build; VDS выполняет frozen install с пониженным параллелизмом и прямой builder. Hosted CI
  оставляет полный check, deploy-тесты и spec:validate обязательными. Повторение этих проверок на
  VDS исключено из-за малого запаса RAM; перед активацией снова проверяются текущий main и CI того
  же SHA.
- Прямой builder сам готовит version metadata и использует тот же esbuild, что pnpm build; tsc имеет
  noEmit. Эквивалентность проверяется version/buildId и SHA-256 всех allowlist assets на чистой и
  повторной сборках. Никакой готовый bundle из CI на сервер не переносится.
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

Для разовой reviewed попытки watcher один раз читает optional `MTP_DEPLOY_EXPECTED_SHA`, проверяет
полный lowercase 40-hex и сравнивает с первым latest main до query/cooldown/build. Перед activate
сверка повторяется для выбранного SHA; существующий повторный main/CI gate также сохраняется.
Обычный timer без pin работает прежним образом. Оператор задаёт pin только в MTP drop-in и убирает
его после public/browser gate до включения timer, сохраняя resource profile.

- Недоступный GitHub или сеть → отказ от новой публикации, старая статика продолжает работать.
- Ошибка public health из-за CDN → откат; шаблон nginx исключает длительное кэширование.
- Права build-пользователя → отдельный mtp-deploy user, только свой каталог и read-only GitHub.
- Первый релиз без предыдущего → при ошибке current удаляется, успех не записывается.
- Пик frozen install и builder под VDS cgroup неизвестен → одна ограниченная попытка после свежего
  resource snapshot; OOM/timeout не ослабляет CI или health. Снижение параллелизма не доказывает,
  что установка поместится в выбранный бюджет. Память и swap соседних сервисов не изменяются.
- Credentials, DNS, TLS и remote пока не настроены → инструкция фиксирует внешние prerequisites;
  локальные проверки не считаются реальным deploy.

## Migration Plan

Интегрировать и проверить ветку, опубликовать main в созданном public repository, дождаться GitHub
CI. На VDS проверить существующие nginx routes, сделать backup, добавить отдельный vhost и HTTPS,
выполнить nginx -t и reload. Установить отдельный controller, config и systemd timer. Первый deploy
делать явно, затем проверить public SHA/version/buildId и сценарий PWA через отдельного reviewer.
