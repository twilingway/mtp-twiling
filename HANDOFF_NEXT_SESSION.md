# Передача — mtp.twiling.ru

Обновлено 25.11.2026. Это актуальный вход для нового чата; исторические статусы в CONTINUE.md читать
после этого файла. Пользователь хочет короткие ответы по-русски и параллельную работу.

## Актуальный этап 0.3.7 — читать первым

Canonical HEAD ещё24bf6de, текущие изменения НЕоткатывать: build0.3.7/cb508bf9d82d2abf,
`pnpm check`159/159 PASS, strict spec7/7 PASS. Независимое review восстановления истории PASS
(`vps/artifacts/history-range-final-review.md`) и transfer persistence PASS
(`vps/artifacts/transfer-race-final-review.md`,17 независимых import/queue/lifecycle тестов).

- Ранее потерянный left2022 при importA восстановлен: загружаются весь saved window и фактические
  warmup bars;18 новых history тестов. Legacy anchor использует фактическую ширину и backfill,
  offline требует полное coverage до сохранённого right, MA20/EMA50 учтены; refresh отменяет старую
  загрузку. `historyViewReady` не даёт записать промежуточный вид, KLine теперь пишет from/to
  seconds.
- Пользователь заменил бренд: только цветные кириллические **МТП**, без сетки/линий/TWILING внутри
  SVG. М синяя, Т бирюзовая, П фиолетовая; font184,
  SHA9cac2d2501e5ed246118f97dbaa0f2b13412754d6f947dea9e996d3f370b1cdf. Icon25/32/192/512+maskable
  просмотрены в isolated worker; safezone0 pixelsoutside. Manifest application name MTP TWILING,
  id/origin unchanged. Evidence `vps/artifacts/mtp-brand-visual`.
- Тёмная палитра теперь#000000, нейтральные raised/input/borders; light/custom preserved. OHLC
  вынесен в компонент: нейтральные labels, цветныеvalues/delta/% по previousClose, firstbar body
  fallback без выдуманного delta. Точный TV zero-rule локальными bundles не доказан.
- Actual QA0.3.6 (9e602bc98d441451) подтвердила fullhistory+МТП440 обоих движков и бренд, но нашла
  P1 быстрый import→export / первыйrestore, перезаписывавшийA исходящимB. НЕвыдавать тот pass за
  финальный: `vps/artifacts/history-brand-qa/report.json`. Исходный профиль после повторного
  восстановления exact, браузер закрыт.
- P1 исправлен в0.3.7: `TerminalBackups` очередь perowner, owner/client guards, файл резервирует
  очередь ДОfile.text/JSON; global busy переживает закрытие accountdialog. `retired` sticky отдельно
  от transient persistView; global importingBackup блокирует новые/remounted adapters. Commit
  немедленно меняет revision; postcommit failure retire+recovery lock. `recoverBackup` повторяет
  только restore profile, без повторной записи backup. Все saveView/helper/liveView/cleanup guards
  согласованы. Prior recovery не сбрасывается неудачным новым commit.

СЕЙЧАС fresh `/root/black_ohlc_transfer_qa` владеет профилем
`D:\MySource\ReactJS\vps\artifacts\pwa-react-qa\profile` и проверяет EXACT0.3.7/cb508bf9d82d2abf. Не
менять сборку/CSS, пока он не завершит. Evidence `vps/artifacts/black-ohlc-transfer-qa`. Проверка:
black+OHLC оба движка/mobile, fullA+быстрыйexport, первыйrestore exact. После PASS обновить статусы
ниже, сохранить canonical commit. Goal полный и активный, далеко не завершён.

### Параллельные задачи, уже запущенные по новым указаниям пользователя

- `/root/intervals_menu`: worktree `vps/artifacts/intervals-worktree`, branch feat/intervals-menu,
  base24bf6de. Pure registry/menu/aggregation commit **a6486c27d08a4f8ede4ac236fb3d2b11e8369feb**,
  15 тестов/scopedTS/lint/spec PASS, только newfiles, НЕинтегрирован. Union18:8 минутных,
  4часовых,1d/1w/1M/3M/6M/12M. Теперь actor реально подключает13 native API+live/cache/validation/
  Toolbar, переносит старый #range lookback отдельно. Persisted Timeframe=NativeIntervalId13;
  45m/3h/3M/6M/12M честноdisabled до source/calendar glue. Полная цель18 остаётся в плане. 45m/3h
  требуют явной торговой сессии. Native1M календарный, не30дней. Добавлена задача подписи шкалы:
  day→months/hour→days, реальные boundary ticks, crosshair полнаядата. Работает ТОЛЬКО вworktree,
  общий build там допустим, canonical/server не трогает. Ждать отдельный integration commit;
  cherry-pick аккуратно разрешить общие файлы относительно новых root history/controller.
- `/root/chart_types`: worktree `vps/artifacts/chart-types-worktree`, branch feat/chart-types,
  base24bf6de. Пишет ТОЛЬКО новые model/chart-series/**, screens/terminal/chart-types/**,
  public/chart-types.css, tests/OpenSpec. Registry21 TVtypes, commonnative
  Candles/Bars/Line/Area/HA, дополнительные LWnative, остальные explicitdisabled. PureHA
  batch/incremental/prepend без изменения реальных OHLCV, component callbacks и integration plans.
  Коммита ещё не сообщал. Root подключит тип в ChartSettings/adapters/Toolbar после проверки. Нельзя
  копировать целиком старые sharedfiles поверх текущих!

Новые вопросы пользователя: `/` внеinput открывает общий каталог, полеwatchlist фильтрует только
список. Цены вкаталоге требуют batch GetLastPrices для новых UID, ужеwatchlist можноизWS; это пока
объяснение, не реализованная новая функция. Т-Технологии(T) корректно материнская компания Т-Банка,
проверено по https://www.tbank.ru/invest/stocks/T/ .

Foundation identity audit готов: `vps/artifacts/canonical-identity-contract-review.md`. ДляBybit/OKX
нужны versioned InstrumentRef/rowId, Backup2+Driveprojection, unresolved legacy scopes безугадывания
UID; это ещё НЕреализовано. Следовать очереди пользователя: menu/axis/charttypes/indicators, затем
identity/providers/Drive/staticdeploy. Старые разделы ниже — историческое объяснение, не
currentgate.

## Где продолжать

- Открыть проект `D:\MySource\ReactJS\tradingview-personal` в новой сессии. Основная ветка
  называется `master`, remote отсутствует. Checkpoint исходников `c7240d7`
  (mobile/toolbar/theme/camera); исходный baseline `9f75db7fc3224473abe2f487b57f0c085c5d50e0`.
  Текущий HEAD уточнять через Git.
- Не откатывать/не заменять исходники старым `vps/artifacts/pwa-ts`. Версия 0.3.5, build
  `8d7c16e44f955542`, полный check120/120 PASS; после последнего key fix повторно strict
  build/scoped lint/format и120/120 тестов PASS.
- Текущий сервер `http://127.0.0.1:5210/` уже запущен. Не создавать дубль и не завершать чужие
  процессы. Пользовательский Chrome/его графики сохранить. Визуал — свежий isolated-ui-review.
- `.env`, `.secrets`, vault и браузерные профили не выводить/не добавлять в Git/не отправлять в
  Drive.

## Агенты: почему нужен новый запуск

По явному запросу пользователя в глобальном `C:\Users\AlekseiHome\.codex\config.toml` и проектном
`.codex/config.toml` установлено:

```toml
[agents]
max_concurrent_threads_per_session = 12
```

Это лимит дочерних исполнителей, основной координатор считается отдельно. Раньше в проекте было3. В
уже открытой сессии лимит остался4 total; после изменения TOML пятая реальная независимая задача
отклонена с `agent thread limit reached`. Не утверждать, что новый runtime принял12 без проверки.
Название тарифа ChatGPT не установлено: страница подписки не загрузилась. Это не доказанный лимит
подписки. Официальные источники и проверка: `vps/artifacts/openai-agent-limits/report.md`.

Создан навык `parallel-task-execution`, глобальная и проектная копии валидированы. В
`task-queue-discipline` добавлено разрешение на независимые готовые параллельные задачи. Резервные
копии: `C:\Users\AlekseiHome\.codex\backups\parallel-agents-20261125-171321`. AGENTS.md содержит
ссылку на навык. Практический DAG на12 работ:
`D:\MySource\ReactJS\vps\artifacts\parallel-work-review\plan.md`.

## Главный текущий этап: hotfix и темы

Пользователь обнаружил сдвиг графика при каждом выборе инструмента и невидимые рисунки. В сборке
0.3.1/84a7087379343f1c QA действительно воспроизвела сдвиг≈390px на клик и замену7canvas. Причины
исправлены в 0.3.2:

- Chart lifecycle зависит от нормализованных native rendering настроек; magnet/last-tool/favorites/
  keep-drawing больше не создают новый adapter. hide/show вызывает redraw текущего canvas.
- LW5.0.9 setters применяются через RAF. Старый restore читал ещё старую геометрию после setter.
  Теперь offset вычисляется сразу из сохранённых spacing/anchor и применяется одним вызовом после
  fit/layout; getView не сохраняет промежуточное состояние, destroy отменяет собственные RAF.
- Добавлены реальный hook regression на26 изменений и deferred-native camera tests на6 remount.
- Центры standalone/split иконок выровнены, стрелка меню absolute; при глобальном скрытии рисунков
  отображается перечёркнутый глаз. Дерево остаётся в правой панели.
- Глобальное hide не удаляет рисунки: в предыдущей QA это подтверждено hide/off/reload и IDB.
- Во время загрузки график приглушается opacity0.35→1, текста загрузки нет. Реальный provider200 был
  удержан без изменения ответа; сценарий PASS.
- Тёмная/светлая тема в настройках сохраняется/переносится в backup. Canvas обоих движков,
  меню/панели/поля используют палитру. Пользовательские цвета сохраняются. Light backup без
  background тоже даёт белый фон; DEFAULT_CHART_SETTINGS больше не задаёт принудительный тёмный.

На 0.3.2 большой drift уже устранён, но KLine cursor менял autoaxis на12px и опорную точку на6px. В
0.3.3 введена стабильная ценовая ось с учётом шрифта/цены/precision и responsive cap. Начало новой
QA подтвердило: KLine plot927→927, anchorX400→400, spacing/rightOffset без изменения; пять кнопок и
режимы сохраняют существующие canvas в обоих движках.

Полная visual QA0.3.3 завершена: `/root/chart_theme_final_visual`, собственный профиль
`D:\MySource\ReactJS\vps\artifacts\pwa-react-qa\profile`, артефакты
`vps/artifacts/chart-theme-final-visual`. Основные сценарии PASS, найден импорт камеры A поверх B,
который до reload оставлял живой canvas на B. Исправлено через chartRevision после успешного
импорта; ошибочный импорт не меняет ревизию. Независимый source review LW/RAF:30 циклов реальных
internals, ошибка offset0, блокеров нет. Прежнее окно getView до RAF после initial fit/focus
остаётся P3; не приравнивать к старому drift.

Новая QA завершена: `/root/mobile_terminal_qa`, exact build0.3.5 `8d7c16e44f955542`, артефакты
`vps/artifacts/mobile-terminal-qa/report.json`. Mobile375/320/667landscape, обе темы, fullscreen
search и возврат к графику PASS; desktop3× collapse/open сохраняет380px.27 скриншотов просмотрены, 0
page errors,204 HTTP200. Исходный backup восстановлен и проверен экспортом; браузер закрыт,
persistent QA profile свободен. Физическая soft keyboard и explicit context-open дерева не
проверены.

ОСТАЛСЯ P2: KLine imported A возвращается без reload, LW camera fields тоже возвращаются сразу, но
загруженный участок истории сокращается (на A был2022, после import видимые данные с конца2023).
Слева остаётся пустота и A визуально не совпадает даже после2.5с. Вероятная причина reset candles и
initial load только rangeDays+warmup без загруженного ранее prepend/границ incoming view. Не
закрывать fixed-price-pan integration как полностью пройденную; следующий fix должен учитывать
видимую левую границу/anchor и догружать данные до применения камеры, сохраняя отмену/owner guards.
Независимый read-only диагноз: `vps/artifacts/camera-import-range-review.md`.

Мобильная панель открывается поверх canvas, геометрия не меняется. По умолчанию показан график,
снизу dock. Выбор бумаги/кнопка «График» закрывают панель. Временный mobilePanelOpen не
экспортируется. Эпоха closeMobile отменяет позднее завершение pending open; 5 независимых panel
navigation tests. Поиск: пустой ввод показывает actual watchlist, запрос350ms+abort, category chips,
безопасные brand логотипы, classCode/currency/expiry. Устаревшие результаты скрываются сразу,
duplicate UID keys различаются индексом. Независимое ревью панели без блокеров; P3 focus после
keyboard Enter остаётся.

Референс actual TradingView mobile проверен отдельно в обычном Chrome375×667 без изменения исходных
вкладок: search fullscreen; chart без sidebar. Способ открыть TV watchlist при такой ширине не
найден, поэтому собственный fullscreen list не объявлять точной копией неподтверждённого поведения.

## Что реализовано и где есть границы

- React/TypeScript strict, LW5.0.9 + KLine9.8.12, индивидуальный bank token в device IndexedDB;
  REST/WS напрямую, сервер только static/PWA updates.
- История IndexedDB, lazy prepend, импорт/экспорт без credentials; MTP из Pine, SMA/EMA/объём.
- Clipboard/clone/Ctrl-drag/undo/redo, locked-safe delete confirmation, объекты/слои, right tree.
- Watchlist delete, empty list restart/offline, divider resize, drag reorder с сохранением UID.
- Левый реестр:92 пункта, разделы/подменю/SVG. Реальная геометрия только8 DrawingTool + курсоры и
  изображения.78 геометрий, палитра и некоторые utilities явно disabled. НЕ выдавать все инструменты
  готовыми по наличию меню. Полный Фибо также остаётся в плане.
- UID-selection исправляет reorder, но namespace drawings/images/views ещё owner+symbol; нужны
  canonical provider/instrument IDs до полноценной криптоинтеграции и изоляции одинаковых тикеров.
- Backup import объединяет рисунки: пустой backup не является командой удаления существующих. QA
  обязана удалить только свои созданные объекты через UI до восстановления своего backup.

## Независимая работа, которая сейчас идёт

### Google Диск — реализуется отдельно

- Worktree `D:\MySource\ReactJS\vps\artifacts\drive-sync-worktree`, ветка `feat/google-drive-sync`,
  baseline9f75db7, feature commit `7f36691` (14 файлов, только ownfiles).
- Исполнитель `/root/drive_sync_core`; ownership `src/services/drive/**`, при необходимости
  `src/model/drive-sync.ts`, свои tests/docs/OpenSpec google-drive-sync. Canonical не меняет.
- В worktree есть seed-копии актуальных types.ts/backup-format.ts/drawing-toolbar.ts/theme.ts и
  ignored generated version; это read-only scaffolding для совместимой схемы. НЕ переносить эти
  shared files поверх canonical и не включать их в feature commit. node_modules — junction.
- Уже написаны auth/backup/transport/sync/types: GIS appdata, memory token/expiry/abort epochs;
  immutable snapshot DAG + SHA256 blobs; namespace/pagination; retry-safe uploads, resumable media;
  inspect/publish/download/explicit resolve. Core sourcefreeze v2:36/36 fakeGIS/HTTP/DAG tests,
  typecheck/lint/format/spec PASS. Независимый review PASS, исправлен P2 post-header stream
  abort/offline. API не подключён к UI; реального OAuth/read/write не было. Review:
  `vps/artifacts/drive-sync-review/REVIEW.md`.
- Синхронизируются настройки/тема/watchlistmetadata/индикаторы/рисунки/изображения/views. Bank
  token, local owner hash, live prices и cached candle history НЕ отправляются в Google.
- У каждого свой Google Drive/appDataFolder, без общего хранилища братьев. UI показывает конфликты,
  не перезаписывает другую ветку «последним победителем». Удаления remote файлов не выполняются.

### Каталог индикаторов TradingView — read-only reference

- Исполнитель `/root/indicator_catalog_reference`, artifacts
  `vps/artifacts/indicator-catalog-reference`.
- Завершён:224 public builtin IDs (127 индикаторов,23 стратегии,64 паттерна,8 профилей,2 options);
  не private/bought scripts. Обычный Chrome подтверждён, но IDs изменились:19с открытым
  selector,4другаяTradingView;15YouTube. В каждом продолжении сверять URL/DOM, не доверять старым
  ID. Авторизованную страницу не менять.
- Пользователь хочет привычное окно поиска и список. Названия ещё не означают реализованные
  алгоритмы. В приложении пока6ключей:volume,ma,ema,mtp160,mtp440,mtp640.

До нового writer убедиться, что старый исполнитель закончил/остановлен: нельзя двум сессиям менять
одни и те же файлы. Состояние старых агентов в новой сессии может быть недоступно; опираться на их
сохранённые результаты/sourcefreeze и этот файл, не запускать дублирующую запись вслепую.

## Дальше

1. Сохранить canonical checkpoint; затем исправить оставшийся P2 imported history в LW и повторить
   соответствующий браузерный сценарий с глубокой историей. Сохранённый view.from2022-05-31 после
   импорта обрезается до2023-11-16: точно совпало с now−(365+740) дней, то есть initial history
   window.
2. Один foundation-owner: canonical namespaces + совместимые schema/provider/indicator/Fib/Drive
   contracts. Не распараллеливать одновременное редактирование types/backup/storage/controller.
3. После contractfreeze готовые независимые пакеты в worktrees: Bybit primary/OKX только если пары
   нет на Bybit; календарные интервалы; типы графика; Fib math/renderer/settings; indicator math/UI;
   object tree/watchlist advanced; Google Drive UI и реальный OAuth.
4. Google static main/test + privacy, затем Google OAuth Production (уже явно разрешено).

## Разрешения на внешние сервисы уже получены

Google projectmtp-twiling, DriveAPI enabled, scope onlydrive.appdata. Public clientID
570894753392-14e7houtg7kc4cdeq6ndpjo7e7sbvnc1.apps.googleusercontent.com. Origins main/test и
localhost/127.0.0.1:5210. Terms/API policy приняты пользователем. Testingowner добавлен. После
публикации homepage/privacy разрешено перевести OAuth в Production для всех.

`mtp.twiling.ru→80.85.246.160` VDS, `mtp-test.twiling.ru→109.197.199.154` Macmini. MTP пока НЕ
опубликован. Старые deploy-файлы с bank backend и /quotes не выполнять; нужен отдельный static
сервис, backup/nginx-t/reload, не затрагивать piano/games/tmeet. Доступы/команды — CONTINUE.md.

## Дополнительный gate чистой сборки

Перед CI/релизом проверить cold build без ignored `src/generated/app-version.ts`: package build
сейчас запускает typecheck до генератора. В отдельных worktrees файл пока скопирован как seed. Это
не влияет на работающий сервер, но свежему checkout может потребоваться перестановка
генерации/typecheck. Проверить отдельно, не удаляя пользовательские файлы ради эксперимента.
