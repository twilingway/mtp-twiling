# MTP TWILING — текущая автономная работа

Обновление 26.11.2026. Этот файл важнее исторических статусов в HANDOFF_NEXT_SESSION.md. Цель
остаётся активной: привычный интерфейс и функции TradingView, без потери пользовательских данных.
Пользователь спит и разрешил автономный отдельный Chrome. Обычный Chrome не трогать; ручной Google
login отложить. Ответы коротко по-русски. Реальный cap — четыре агента с root.

## Опубликовано

### Новейший статус — важнее исторических строк ниже

- PR7 merged, canonical/public main0.3.20: `f69a6bdb65681d9724608cf84d73c0de5632dd2d`, build
  `f6f831b361430895`. PR CI45728265644/run20 и exact main push CI45728693676/run21 success.
  Full726/spec42, independent source review51 и visual34 captures PASS; mobile checkbox дефект
  устранён.
- Штатный автоматический timer выпустил .20 UTC00:32:15.587,12.439s wall/192.2MiB peak. Все67
  canonical/native/public hashes и UTF-8 проверены verified Python TLS, соседи/лимиты/таймер
  прежние. Evidence `deploy-release-readiness/auto-release-0320-proof.json` и journal рядом.
  Canonical clean main собран, unchanged server.mjs не перезапускался: own session24824/5210.
- Fresh public .19→.20 PWA worker работает только в своей копии закрытого
  `public-0319-pwa-qa/profile`, новый `public-0320-pwa-qa/profile`, CDP9328. Native Update уже
  принят, cache только f6; layout/UID/TA/2drawings/raw legacy сохранены. Source402files unchanged.
  Реальные DMI/ADX/Aroon/VI добавлены к RSI/BBW; mobile fix/documents/finalcleanup ещё проверяются.
  Не менять main на .21 до завершения его exact-public gate.
- .21 source42: cut298101c/build670626838ab63513, check761/spec44, source registry review95+24 PASS,
  native42/11 volume outputs PASS. Fresh browser28captures PASS: реальные spot/perpetual, обе
  engines, все7/11outputs,4 PVO EMA/SMA choices, параметры/JSON/layout/native gestures/camera, 375px
  RU/EN dark/light. Нулевой объём только source/native, без fake quotes. Own5227/9327 закрыты. После
  приёмки merged main .20 как b966a68; production inputs неизменны. PR .21 пока не открыт.
- `/root/trend_state_math` сдал math-only5:49bfcf77c9a5200f8bcaf6d70735bd167c500b5f,
  `ta-trend-state-math`, clean. Supertrend/SAR/TSI/KST/Fisher,19tests; DPO unresolved. Независимое
  review /root/ta_momentum_volume_math сверило official versions/hashes/recurrence, отчёт ещё
  оформляется. Before registry нужны renderer gates SAR cross и Supertrend linebr/fill/hidden
  bodyMiddle; существующий TA output contract пока line|histogram. Не объявлять все5 готовыми UI.
- `/root/derived_interval_math` сдал source37366ddb7b0b7019185eb361dcdc026ecd3f7e21,
  `derived-interval-math`,20tests, explicit sessions/anchor/windows/asOf/coverage/finality. Только
  pure1m→4/6/7/8/9/45/180, без product enum/provider/cache/UI/schema. Независимое review
  /root/deployment_recovery_review активно; не обещать MOEX/TradingView session parity.
- Реальные Google OAuth/Drive/два устройства всё ещё не проверялись; GIS SDK load не является
  входом. Общая цель активна, каталог127 не равен127 реализованным алгоритмам. Обычный Chrome,
  реальные банковские ключи, чужие процессы и5190 не трогать.

Ниже исторический статус до выпуска .20; актуальная сводка перечислена выше.

- PR6 merged. Публичный и canonical main: `3be4cc44b7ae19b23cfd7b349c7ddada186a93a8`, версия 0.3.19,
  build `9d68e99e91dea44d`. PR CI run18 и main push CI45725499684/run19 PASS.
- Штатный timer выпустил .19 UTC00:06:20.793; journal12.674s wall,192.2MiB peak. Все 67
  canonical/native/public файлов побайтно совпали; UTF-8 MIME, лимиты192/240/Swap0 и соседи
  сохранены. Proof `deploy-release-readiness/auto-release-0319-proof.json`, journal рядом. Деплой
  вручную не запускался. Старый service MemoryPeak после timer no-op не является peak сборки.
- Canonical clean main собран, собственный 5210 перезапущен в managed session24824; старый
  session1404 остановлен. Local version и license txt UTF-8 проверены. Чужие процессы не трогать.
- Public .18→.19 QA на копии собственного закрытого профиля проходит в `public-0319-pwa-qa`: обычный
  Update, новый cache, public layout/UID/watchlist/2drawings и raw guest сохранены, оба
  engines/Bybit spot/perp/RSI/BBW работают. Privacy/5licenses online/offline совпали, unknown404
  остаётся404. Реальные Google OAuth/Drive и банк не использовались, но GIS SDK загружается при
  account/export — не заявлять Google calls0. Final report/manifest: scoped
  PASS_WITH_KNOWN_UI_DEFECT,25 captures/25 viewed, source449files unchanged; own Chrome закрыт. Root
  проверил all67 через verified Python TLS; Node provenance warning из inherited
  NODE_TLS_REJECT_UNAUTHORIZED не выдается за такую проверку. Chrome TLS bypass не ставился.
- Унаследованный mobile TA settings checkbox defect подтверждён и на public .19. Fix7095365
  проверяется в .20: checkbox16×16 вместо dialog input width100%/height42px; подписи не обрезаются.
  Это известный предел .19, не скрывать его за общим PASS.
- .20 integration сейчас `2f6cd5b`, production inputs идентичны frozen7095365, build
  `f6f831b361430895`, full check726/726. Source review35:51 focused PASS. Worker в своём5225
  заканчивает scoped CSS rerun; broad ef2 со всеми35 и native gestures PASS. Отдельный bounded
  camera case подтвердил одинаковые last timestamp/count, barSpace/rightOffsetBars/anchor/gap;
  прежний mixed run имел разную geometry. PR .20 ещё не открыт.
- .21 отдельно: `vps/artifacts/release-0321-worktree`, head298101c, build `670626838ab63513`,
  check761/761 и spec44/44 PASS.42 вычисления, native42+11volume outputs, positive-volume gate,
  строгие EMA/SMA choices/JSON/Drive. Независимый registry c485150 review без blockers; fresh visual
  worker начинает свой5227, не трогает5225/5210/public QA. Не публиковать раньше .20.
- /root/trend_state_math возобновил math-only работу после public QA, ветка
  feat/ta-trend-state-math. Checkpoint в
  `ta-trend-state-math/openspec/changes/ta-trend-state/research-checkpoint.md`. DPO odd-length
  conversion требует primary evidence, поэтому пока делаются остальные пять. Общая цель активна;
  все127 TA не реализованы.

Ниже исторический снимок до публикации .19; актуальные статусы перечислены выше.

- PR5 merged, main `3a31c02aa86bd4fe3494b6fefe50fa35aeb81c71`: публичная и локальная0.3.18, build
  `62b7c12c8b73f573`. Main push CI45715266056/run14 PASS;622 tests/spec35.
- Настоящий автоматический timer deploy: UTC22:46:30,12.811s wall,192.4MiB peak, лимиты192/240/Swap0
  сохранены, соседние hashes/PIDs/health прежние. Root руками deploy/service start не запускал.
- Все66 публичных файлов подтверждены. Прямая canonical-сборка с обычным node_modules побайтно
  совпала с native deployment по всем66 именам и содержимому:
  `vps/artifacts/deploy-release-readiness/auto-release-0318-canonical-parity.json`. Имена двух
  chunks отличались только у изолированной сборки через dependency junction; payload совпадал.
- Bybit CSP include обновлён отдельно; backup
  `/root/mtp-nginx-include-backup-20261125T223553Z-6d33e1d0e979`. Timer остаётся включён.
- Local canonical чисто FF до main3a31 и собран. Старый собственный PID11464 был проверен и
  остановлен через session39079 ради нового server CSP. Новый server5210 — managed session1404;
  версия и реальные Bybit REST/WS origins в headers проверены. Другие процессы не трогать.
- Независимый public .17→.18 PWA report `vps/artifacts/public-0318-pwa-qa/report.json`: scopedPASS,
  26 captures/22 viewed, оба engines/реальный Bybit/RSI/Line/375/documents online-offline. Google
  OAuth и реальный bank key не использовались. Старый guest layout byte-exact сохранён, но новый
  public owner его не показывает — recovery исправляется в следующем пакете.
- Nginx charset уже исправлен одной строкой `charset utf-8;`, с отдельными preflight/backup/reload:
  include SHA256 `5adf21f222f2e50407a4cf0252b50e101e9374e4bf703e599bd68e9ffb234436`. Тела всех66
  файлов, CSP, controller, лимиты и соседи сохранены. Пять txt теперь UTF-8 online; старые cached
  headers .18 не переписывались. Evidence `nginx-charset-root-apply.log`.
- Кандидат0.3.19: ветка `feat/release-0319`, source cut `3757264`, build `9d68e99e91dea44d`,697
  tests/spec39; PR6 draft, exact CI45723932977/run17 PASS.29 computed TA + разделы + Guest recovery.
  Giant SVG и перекрытие overlay settings исправлены и отдельно визуально проверены:
  `release-0319-ui-fixes-qa/report.json`. .19 не публиковалась.
- Guest recovery source `549f17b` интегрирован как `53fc5b7`: exact raw guest→public только в пустой
  target атомарно, source сохраняется; при occupied только явный offline export/import. Vault,
  session и bank owners исключены. Final browser A raw17 PASS; B occupied18 + offline export/import
  и восстановление текущего backup PASS. C genuine empty18 первоначальный BLOCKER исправлен строгим
  classifier be6dfc2→3757264. Новый C из original .18 baseline через обычную кнопку Обновить PASS:
  KLine/180/en/light/gridfalse/font13, raw guest/Drive/device byte-exact, reload без дублей.
  Исходные C и failing C-run сохранены; их decision не удалялся. Независимое source review be6dfc2
  PASS. Полный secret audit116commits/1559blobs без findings.
- Native IndexedDB D перенос и fault/race PASS на неизменённой6edd части: source/PNG/history SHA,
  no-history payload reads0, explicit history exact1152bytes, асинхронный native DOMException quota
  rollback без partial copies/decision и с рабочим пустым bootstrap/recovery download. Late DB и
  Blob await+UI import не дают старых download/alerts. Foreign/vault reads0. Итоговый scoped PASS:
  `guest-recovery-final-qa/report.json`, manifest,18 captures/18 viewed. C-fixed smoke обоих engines
  и late warning после prepared client PASS. Own5224/9324 и Chrome закрыты, baseline/repro
  сохранены. Google не авторизовать. Это ещё не public .19 PWA gate.
- Следующая ветка .20 `vps/artifacts/release-0320-worktree`, head `ef2b633`:35 вычислений, точные
  Drive keys diLength/adxSmoothing и native/portable fixtures; Guest375 объединён.
  Полныйcheck726/726, build e2883e84c9dbc548; предыдущий cut strict spec42 PASS. Независимый source
  review35 PASS, focused51/51; новый fresh visual worker проверяет свой5225/DevTools isolated page2.
  Исследование derived intervals `d13250e` интегрировано только как docs/spec proposal; интервалы
  production не менялись. Volume math58da04e source7 готов, независимое review выявило all-SMA PVO
  seed metadata blocker; исправлен автором в b259447, source16/16 и spec41 PASS. Автор регистрирует7
  в отдельном ta-volume-registration от220b227; контракты choice/history/positive-volume gate
  согласованы, native/root integration pending. Все127 алгоритмов по-прежнему не реализованы.
  Реальный Google sync/login/два устройства pending.

Ниже сохранён исторический ход0.3.17→0.3.18; его pending пункты не отменяют эту сводку.

- Public repo: https://github.com/twilingway/mtp-twiling, Issues включены.
- PR3 и PR4 merged. Main `b721744af1b58b9d06b0dfefc420461feaf5bb30`.
- Локальный canonical и публичный https://mtp.twiling.ru — версия 0.3.17, build `1b49aca5787d1ec4`.
  Check492/492, spec29/29, main CI45705030665 success.
- Исправлен SW: только корень приложения возвращает shell; privacy/лицензии сохраняют свой ответ.
  Проверка обычного обновления старого QA-профиля PASS: настройки сохранены, privacy/лицензии
  online/offline имеют правильные MIME/SHA. Отдельный косметический overflow privacy375px исправлен
  в source0.3.18. Таймер включён после reviewed finalize apply; same-SHA no-op проверен.
- VDS root upgrade 0.3.16→0.3.17: все63 публичных хеша проверены, peak201818112B/OOM0,
  service11.978s, PID0/success. Backup `/root/mtp-upgrade-backup-20261125T214346Z-b721744af1b5`.
- Лимиты192/240MiB/Swap0 не повышались, соседи сохранены. Первые две preflight попытки остановились
  до мутаций: Python создавал множество TLS contexts. Новый reviewed helper переиспользует один
  verified context/opener; оригиналы сохранены. Доказательства:
  vps/artifacts/deploy-release-readiness.
- Lean controller использует `--ignore-scripts` и `PNPM_MAX_WORKERS=1` только для pnpm child.

## Версия 0.3.18 — source integration, ещё не опубликована

Worktree `vps/artifacts/technical-indicator-integration-worktree`, ветка
`feat/technical-indicator-integration`. Основные коммиты:

- `98ee212`: Bybit + 13 TA + live drawing preview, check589/589.
- `7216f43`, `50b3f1b`: ещё8 momentum/volume, всего21 computed; общий check609/609, build
  `25fa7798f753e64c` до последующих browser fixes.
- `f639c19`: LW первое добавление RSI падало из-за paneSize до создания native widget. Используется
  общая timeScale width; добавлен race regression, TA effect больше не обрушает React root.
- `c4adfd8`: live Bybit spot может вернуть свечу, перекрывающую начало запроса. Допускается только
  точное UTC начало соответствующего интервала; другие out-of-range данные отвергаются. Regression
  включает реальные timestamps. Приветствие/EN/privacy объясняют публичный Bybit без ключа.
- `b4689e1`: KLine late async height reset и repaint исправлены по installed-native regressions.
  Общая кандидатная сборка: check620/620, strict spec PASS, build `866106385a4c0bf7`. Повторная
  browser QA обоих движков ещё обязательна; старый frozen98ee212 остаётся FAIL.
- Candidate `5ea3f3b` / build866106385a4c0bf7 — FAIL на прежнем QA-профиле: KLine price/volume
  застывают, RSI живой. Установлена точная причина: native fractional heights598.5672/33.4328 против
  integer clientHeight599/33; Canvas.update пропускает redraw, ожидая отсутствующий RO. Исправление
  целочисленных native bounds сохраняет общий размер и ratios. Check622/622, strict spec35/35, build
  `65fd586523b0a42e`; новый browser gate ещё требуется.

Сохраняются независимые TA instances, параметры, стили, overlay/lower pane, группировка, порядок,
высоты/collapse. Есть каталог127 +4MTP, поиск RU/EN; доступно21 вычисление +volume, остальные строки
честно отключены. Все127 алгоритмов ещё НЕ реализованы. Live drawing preview изолирован от committed
drawings/Drive/undo; Cancel откатывает, OK — одна операция undo.

Bybit: anonymous spot/perp/stock-perps/xStocks с явными типами и rolling24h. Bank auth отдельно.
Namespaces `bybit:category:symbol`, portable physical owner `profile-v2:<logicalowner>`, private
vault/auth не перемещены. Экспорт2 читает1/2, Drive v2 изолирован от старого v1, перенос v1 явный.
TA + provider JSON/Drive preparation/storage migration проверены совместно. Настоящего Drive upload
и проверки между двумя устройствами ещё нет.

## Независимая browser QA

- Frozen `98ee212`/build `8f599084b9289baf` — FAIL, не выдавать за готовую версию.
- Report `vps/artifacts/combined-0318-qa/report.json`, 33 screenshots лично просмотрены отдельным
  агентом. Live Bybit200, spot/perp UID и запросы подтверждены. Найдены LW first-RSI crash, spot
  overlapping-candle и KLine blank/invalidation, исчезающий после viewport resize.
- Первые два исправлены в root source, KLine чинится. Рисунки и undo сохраняются; native paint
  иногда отсутствовал до resize. Исчезновения данных не обнаружено.
- Own Chrome и server5222 закрыты, profile сохранён. Для нового cut нужен новый isolated reviewer.
- Обычный пользовательский Chrome и localhost5210 не использовались этой QA.

## Следующие обязательные шаги

1. Public0.3.17 standard PWA gate и timer-finalize завершены. Backup
   `/root/mtp-watcher-backup-20261125T220317Z-b721744af1b5`; лимиты сохранены, pin убран, provenance
   содержит настоящий browser proof. Timer enabled/active. Старые first-release apply scripts не
   запускать.
2. Включить подтверждённый KLine fix, полный check/spec и новую QA0.3.18 с21 TA/Bybit/рисунками,
   reload, viewport, сохранением камеры, extreme pane overflow и отсутствием click-through.
3. До публикации0.3.18 отдельно reviewed обновить только свой nginx CSP include: добавить
   https://api.bybit.com и wss://stream.bybit.com. Pull watcher не имеет root и сам nginx не меняет.
   Обязательно nginx-t/reload/публичные headers/соседи. Не забыть этот gate после local browser
   PASS.
4. PR5 draft уже открыт (head до fractional fix5ea3f3b, CI45710199951 success). Secret audit всей
   release history; версия0.3.18 уже в package. Затем PR/CI/main и отдельное доказательство
   публичного SHA/build/health/visible behavior. Не смешивать код/merge/deploy/QA.
5. Реальный Google Drive login/sync/reload/2device, homepage/privacy/terms и Google Production после
   доступного авторизованного входа. Клиентская архитектура без нашего auth backend сохраняется.
6. Продолжить оставшиеся127 TA, настройки/отображение, полноценные watchlist sections с переносом
   инструментов/удалением заголовка без удаления инструментов, OKX только при доказанном отсутствии
   exact product на полном успешном Bybit каталоге, остальные типы графика и drawing tools.

Отдельный агент `watchlist_sections_implementation` делает source-only0.3.19 в
`vps/artifacts/watchlist-sections-0319`: portable display ledger, настоящие MarketRow не меняются;
insert before context row, delete header возвращает members перед первым оставшимся header.
Обязательны согласованная next/prev навигация, owner/import fences и собственный CAS rollback при
ошибке сохранения. Не переносить его shared files поверх TA/provider contracts целиком.

## Отдельно готово на следующий пакет

Math-only volatility/momentum8: `e5e88147f598bbfc2d25567cace4acfd4ee0c866`, worktree
`vps/artifacts/ta-volatility-momentum-worktree`,14/14/source gates PASS. Не зарегистрировано и не
включено в0.3.18. HV требует явный periodsPerYear; BBW имеет3 выхода; TRIX — delta тройной EMA
log(source)×10000. Сначала стабильная0.3.18, затем регистрация с правильным timeframe context.
