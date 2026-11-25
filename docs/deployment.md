# Публикация MTP TWILING

Схема повторяет реальный towerdefander: PR → hosted GitHub CI → merge в main → pull watcher на
сервере → локальная сборка → атомарная статическая публикация. Сервер не запускает приложение, API и
хранение ключей остаются в браузере. GitHub не имеет SSH-доступа к VDS.

## Состояние подготовки

Публичный repository `https://github.com/twilingway/mtp-twiling` создан, Issues включены. CI run,
установка watcher, TLS и публичный deploy подтверждаются отдельно. Наличие файлов не доказывает
выполненную публикацию. Release branch: `main`. Primary origin: `https://mtp.twiling.ru` на
существующем VDS. Настройка `mtp-test.twiling.ru` на Mac — отдельный target, не часть Linux service.

## Версии и CI

При изменении `src/`, `public/`, builder, worker template, lockfile, package.json или tsconfig автор
PR повышает стабильную `major.minor.patch` в package.json. PR CI сравнивает с base SHA; main CI и
повторные запуски не сравнивают commit с ним самим. CI ничего не коммитит.

Существующий builder вычисляет content buildId и пишет version.json, worker и allowlist
`.release-assets.json`. Deploy добавляет deployment.json:

```json
{
  "sourceSha": "full 40-character Git SHA",
  "version": "0.3.8",
  "buildId": "16-character content hash",
  "files": { "index.html": "SHA-256 of published bytes" }
}
```

BuildId относится к фактической сборке на сервере; не подменять его сокращённым Git SHA.
prepare-version нормализует пути и исключает generated outputs, включая licenses: чистая и повторная
сборки одинаковых исходников получают одинаковый ID. Typecheck и lint сначала готовят реальную
version metadata, поэтому проходят в чистом checkout без ручной подстановки версии.

В настройках GitHub включить Actions и защиту main: PR, успешный `gate` workflow `CI`, запрет
прямого push. Не устанавливать self-hosted runner на VDS с соседними сервисами. У workflow только
`contents: read`; deploy secrets в GitHub не нужны.

## Разовая установка на Linux VDS

Сначала проверить текущие сайты, nginx include-структуру, занятые домены и DNS A/AAAA. Подготовить
резервную копию действующей nginx-конфигурации. Не копировать конфигурацию всего чужого vhost, не
менять tmeet routes/upstream и не перезапускать соседние процессы.

Предварительно нужны Node >=22.21.0 (CI использует 24), pnpm версии из packageManager, git, tar,
util-linux flock, nginx и HTTPS certificate для домена. Пользователь `mtp-deploy` имеет отдельный
home `/srv/mtp`, без sudo. Node/pnpm должны быть доступны через PATH systemd:
`/opt/mtp-deploy/bin:/usr/local/bin:/usr/bin:/bin`. Существующий поддерживаемый Node сохранять; pnpm
можно установить отдельным wrapper через corepack, не меняя глобальные пакеты соседних apps.

Структура:

```text
/opt/mtp-deploy/controller/scripts/deploy-*.mjs  reviewed controller, root-owned
/opt/mtp-deploy/controller/scripts/deploy-static.sh
/etc/mtp-deploy/config.json                    non-secret config
/etc/mtp-deploy/credentials                    optional local GH_TOKEN/GIT_SSH_COMMAND, 0600
/srv/mtp/repo                                  deploy clone, no manual edits
/srv/mtp/releases/<full-SHA>/                   immutable static releases
/srv/mtp/current -> releases/<full-SHA>         atomic pointer read by nginx
/srv/mtp/state/                                lock, pause, query and status files
```

Создать `/srv/mtp/{state,releases}` с владельцем mtp-deploy, правами чтения nginx. Controller и
unit-файлы устанавливает оператор из конкретного проверенного commit. Не запускать production
controller из изменяемого рабочего дерева.

Публичный repository клонируется по HTTPS без credentials; GitHub Actions API опрашивается без PAT.
Не переносить личный GCM token на VDS. Watcher имеет общий cooldown 300 секунд независимо от смены
SHA: максимум 12 initial CI запросов и 12 повторных проверок перед активацией в час. Для уже
опубликованного неизменного SHA — ноль API запросов. Это максимум 24/час на watcher при
unauthenticated GitHub лимите 60/час на IP; другие клиенты IP расходуют общий остаток. HTTP 403/429,
Retry-After и X-RateLimit-Reset откладывают публикацию; remaining=0 блокирует следующий запрос.
Повторный exact-SHA gate перед активацией обязателен. `resume` не сбрасывает rate cooldown.

При будущем переводе в private repository добавить отдельный read-only deploy SSH key. Закрепить
проверенный GitHub host key в отдельном known_hosts; не использовать StrictHostKeyChecking=no. Ключ
и SSH config хранить вне repo, например `/srv/mtp/.ssh`. `ProtectHome=true` исключает ключи в чужом
`/home`/`root`. Локальный credentials может задать
`GIT_SSH_COMMAND=/usr/bin/ssh -F /etc/mtp-deploy/ssh_config`. Для Actions API нужен локальный
fine-grained `GH_TOKEN` с Contents/Actions read только этого repo. Не выводить token, SSH private
key или credentials. GitHub workflow не получает эти credentials.

Пример non-secret операций после подготовки пользователя и доступа:

```bash
sudo -u mtp-deploy git clone --no-checkout https://github.com/twilingway/mtp-twiling.git /srv/mtp/repo
sudo install -d -m 0755 /opt/mtp-deploy/controller/scripts /etc/mtp-deploy
sudo install -m 0644 scripts/deploy-lib.mjs scripts/deploy-rate.mjs scripts/deploy-static.mjs scripts/deploy-version.mjs \
  /opt/mtp-deploy/controller/scripts/
sudo install -m 0755 scripts/deploy-static.sh /opt/mtp-deploy/controller/scripts/
sudo install -m 0644 deploy/static/config.example.json /etc/mtp-deploy/config.json
sudo install -m 0644 deploy/static/mtp-deploy.service deploy/static/mtp-deploy.timer \
  /etc/systemd/system/
```

Прочитать config.json и сверить repository, root, publicOrigin. Не переносить пример поверх
существующего config без сравнения. Все credential-файлы исключены из статического allowlist.

В отдельном HTTPS server block `server_name mtp.twiling.ru` подключить содержимое
`deploy/static/nginx.conf`. TLS path/параметры взять из реально выпущенного certificate. HTTP
redirect делать только для этого домена. Проверить после изменения:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Если nginx -t неуспешен, восстановить backup и повторить проверку, reload не выполнять. Reload при
установке vhost — отдельная операция; каждый обычный deploy переключает symlink без reload.

Прежде чем включать timer, дождаться зелёного CI точного main SHA. Первый запуск выполнить через
`systemctl start mtp-deploy.service`, проверить журнал и публичные файлы, затем:

```bash
sudo systemctl daemon-reload
sudo systemctl start mtp-deploy.service
sudo journalctl -u mtp-deploy.service --no-pager -n 100
sudo systemctl enable --now mtp-deploy.timer
sudo systemctl list-timers mtp-deploy.timer
```

Watcher раз в минуту читает origin/main; новый цикл GitHub CI начинается не чаще раза в пять минут
глобально, даже если SHA меняется каждую минуту. Публикует только latest successful push run
`.github/workflows/ci.yml` для exact main SHA. Пропущенный, pending, cancelled или failed CI ничего
не публикует. При смене main во время сборки активация откладывается. Сервер выполняет frozen
install, check, deploy-тесты и spec:validate в чистом archive-каталоге; публикуется только manifest
allowlist из public. Secrets и исходники в release не попадают. Повторная сборка SHA обязана
совпасть с имеющимся immutable payload.

## Проверка релиза

Public health сравнивает sourceSha/version/buildId и SHA-256 **каждого** manifest-файла через HTTPS.
Redirect, HTTP error, старый payload или повреждённый asset вызывают откат pointer. Новый
`deployed-sha` записывается только после health. У failed SHA остаётся блокировка повторных попыток
до `resume` или нового main SHA. При первом неудачном релизе без предыдущего current удаляется;
релиз не считается опубликованным.

Для ручной сверки получить `/deployment.json`, `/version.json`, `/service-worker.js` с cache-bust
query и сопоставить полный SHA с GitHub main/CI. TLS проверка остаётся включённой. Затем отдельный
browser reviewer подтверждает открытие страницы, отсутствие ошибок ресурсов и PWA обновление. Не
считать статические проверки доказательством визуального сценария.

## PWA обновление

У существующего PWA worker новый buildId создаёт новый cache. Новый worker precache-ит весь
allowlist и остаётся waiting. Приложение проверяет обновление каждую минуту, при возвращении на
вкладку и online; готовый worker вызывает плашку. «Позже» скрывает плашку, «Обновить» сначала
сохраняет данные, затем отправляет ACTIVATE_UPDATE и перезагружает страницу при controllerchange.
nginx отдаёт все файлы с no-store, чтобы unversioned entry points и version.json не застревали в
HTTP cache. Данные IndexedDB и токен сервер не получает.

Проверка двумя релизами: открыть A, опубликовать B с новой semantic version/content buildId,
дождаться плашки, выбрать «Позже», убедиться в продолжении A, затем «Обновить» и проверить B с
сохранёнными локальными данными. Автоматические unit-проверки контракта уже есть в
test/pwa.test.mjs; реальный сценарий браузера и опубликованный origin проверяются отдельно.

## Пауза и откат

Ручные операции запускать тем же controller с теми же EnvironmentFile, user и flock. Удобно временно
поменять только ExecStart через transient `systemd-run`:

```bash
sudo systemd-run --wait --pipe --collect --unit=mtp-deploy-manual \
  --property=User=mtp-deploy --property=Group=mtp-deploy \
  --property=EnvironmentFile=/etc/mtp-deploy/credentials \
  --setenv=MTP_DEPLOY_ROOT=/srv/mtp --setenv=MTP_DEPLOY_CONFIG=/etc/mtp-deploy/config.json \
  /bin/bash /opt/mtp-deploy/controller/scripts/deploy-static.sh pause
```

Для отката заменить последний `pause` на `rollback <full-SHA-из-releases>`, для возобновления —
`resume`. Если credentials не используется, убрать EnvironmentFile property. Lock одинаков для timer
и manual; занятый lock прекращает второй запуск. Rollback проверяет public health и оставляет
watcher paused, чтобы он сразу не вернул неудачный main. Существующие вкладки PWA получат откат как
очередное обновление с тем же подтверждением пользователя.

При failed health отката pointer возвращается в состояние до ручной операции. Не удалять current,
целевой и предыдущий релизы. Автоматической очистки нет: проверять свободное место, старые SHA
архивировать отдельно после доказанного успешного релиза. Удалять только явно выбранные каталоги в
`/srv/mtp/releases`, сверив realpath; чужие сайты и процессы не затрагивать.

## Локальные проверки change

```bash
node --test scripts/deploy.test.mjs
pnpm build && pnpm check
pnpm spec:validate
bash -n scripts/deploy-static.sh
```

Atomic symlink/rename test выполняется на Linux CI; на Windows явно пропускается. GitHub
repository/CI, nginx/systemd, DNS/TLS, реальный public health и визуальный PWA smoke требуют
отдельного live подтверждения перед объявлением публикации завершённой.

Локально проверено 25.11.2026 на базовом 2ab4dc3 с этим change: Windows pnpm check — 159/159; strict
spec validation — 8/8; WSL Ubuntu deploy-тесты — 9/9, включая Linux atomic rollback; bash -n —
успешно. Отдельная чистая копия без src/generated и build manifest прошла полный check; две
последовательные сборки дали одинаковый buildId. Упаковка реального payload прошла allowlist и
метаданные (39 файлов). Это результаты локальной подготовки, не live CI/deploy.
