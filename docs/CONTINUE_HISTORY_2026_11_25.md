# Исторический снимок

Актуальный вход — HANDOFF_NEXT_SESSION.md. Ниже сохранены старые этапы и доступы; статусы и номера
вкладок могли устареть.

# Продолжение — mtp.twiling.ru, 25.11.2026

## Актуальное дополнение (приоритет над историческими разделами ниже)

- Новейший проверенный checkpoint `1ee8e0e0811c66df`: полный check87/87 и spec6/6 PASS; независимый
  review R1/R2 закрыт, real wheel/pan/switch/reload/LW+KLine/prepend/drag/reorder подтверждены
  `vps/artifacts/camera-reorder-visual` (12 просмотренных скриншотов). Эти пункты заменяют статусы
  «в работе» ниже. Mobile header clipping пока открыт, UI панели исправляет.
- В работе уже следующая левая панель: root controller-drawing-tools/model/drawing-toolbar/
  drawing-magnet и режимы canvas; агент drawing_toolbar_ui — только UI/registry/icons/new CSS;
  test/drawing-toolbar.test.mjs12/12 PASS. Эта новая source итерация ещё не собрана/не QA.
- Выявлен отдельный import-view race: lifecycle старого chart после import перезаписывает imported
  view, shared-camera cache не очищен. chart_pan_camera делает отдельный fix/регрессии; не закрывать
  этот пункт по успешному общему camera/reorder QA.
- Бounded UIDselectionfix удерживает выбранный UID при reorder даже одинаковых symbol. Полная
  изоляция annotations/views между разными UID с одним symbol пока требует canonicalidentity.

- Последний проверенный build `03dc666177328a3c`, v0.3.0:64 теста, format/lint/typecheck/build и
  OpenSpec PASS. Сейчас поверх него незавершённые source изменения камеры и drag reorder.
- Проверены обоими движками clipboard/clone/undo, cursor/pan с фиксированной price scale/Fit, правые
  вкладки watchlist/дерево, hover lock/eye/trash, синие даты. Горизонтальный focus объекта работает
  обоими; вертикальный focus далеко вне экрана пока только LW.
- QA03dc: удаление trash/ПКМ/null UID/последнего инструмента, пустой список offline/reload,
  сохранность drawings/images/history, divider drag/keyboard/clamps/cancel, mobile panel — PASS.
  Таймер fresh1м LW00:54→00:51, KLine00:49→00:47; WS ping.time correction≈−104.5s, один PingRequest
  на open. OS clock не менялся. Артефакты `vps/artifacts/watchlist-clock-resize-qa`.
- Найдены clipping ПКМ-меню справа (source исправлен, ещё ретест), ранний restore saved view с toast
  `Value is null` (camera agent исправляет), частично скрытый mobile header controls.
- `chart_pan_camera` владеет adapters/lifecycle/controller-history/chart-camera service: общая
  камера candle CSS px + signed rightOffsetBars, restore после data/fit, same-symbol date anchor.
  Root подключил saveChartView и latest-selection-wins selectionEpoch в controller.ts.
- `watchlist_reorder` внедряет drag, atomic сохранение до присвоения, manual sort после успешного
  drop, без лишних API. В controller.ts только новый delegate; не затереть camera glue.
- Следом левая панель SVG/все группы/меню; полный Фибо (`vps/artifacts/fib-parity-next/plan.md`,
  production пока не изменён), меню интервалов/типов и VolumeMA20. Остальная очередь — TASKS.md.
- Текущий source audit `vps/artifacts/tv-feature-inventory`:113 URL,535 chunks,15405 module IDs, 31
  selected sources/17 selected paths,93 tool entries/7 groups,185 feature rows. Это bounded audit,
  не полный разбор всех модулей. `toolbar_reference` уточняет всю левую панель read-only.
- Crypto: Bybit основной; OKX только если точной пары нет на Bybit, без молчаливой смены provider
  при outage. BingX не подключать. Исследование `docs/CRYPTO_DATA_SOURCES.md`, identity design
  `vps/artifacts/market-identity-architecture/report.md`; реальной интеграции ещё нет.
- Managed5210 и пользовательский localhost Chrome tab37 сохранить. QA только own profile
  `vps/artifacts/pwa-react-qa/profile`; визуал только свежим isolated-ui-review worker.
- Google Drive/static main/test ещё не реализованы/не опубликованы; разрешения пользователя ниже
  действуют. Репозиторий unborn/no remote; после текущего QA сделать первый проверенный commit.
- Нижние исторические build/test/agent/queue статусы устарели; фактическую очередь и evidence
  сверять с этим дополнением, TASKS.md и docs/TRADINGVIEW_PARITY.md.

Работа активна, паузы нет. Пользователь требует коротко/по-русски. Основной проект:
`D:\MySource\ReactJS\tradingview-personal`; cwdинструмента `D:\MySource\ReactJS\vps`. **Canonical
`src/` актуальнее staging `artifacts/pwa-ts`; не копировать staging поверх canonical.**

## Дополнение: текущая итерация рисования

- Пользователь подтвердил Ctrl+C/V объектов и запросил сверку по текущему коду TradingView. Проверка
  обычного Chrome read-only завершена: `vps/artifacts/tv-drawing-clipboard/report.json`. Правила и
  ещё не перенесённое поведение — `docs/DRAWING_REFERENCE.md`.
- Агент `drawing_editing` внедряет clipboard, Ctrl-drag (>8px), pointer/grabbing, undo/redo, отмену
  жеста. В работе OpenSpec `drawing-editing-history`. До завершения ревью/QA не заявлять готовность.
- Независимое ревью выявило 4 случая: owner change во время gesture, paste со stale preview,
  неотслеженная ошибка сохранения изображения и Ctrl+Z во время создания рисунка. Автор исправляет и
  добавляет regression tests. Затем root должен запустить общий check/spec и свежий visual QA.
- Цвета свечей исправлены по runtime TV: тело/граница #53b987/#eb4d5c, фитили #336854/#7f323f; MTP
  opacity 0.65 (transparency35). Добавлены отдельные параметры и миграция старых body defaults без
  сброса пользовательских границ/фитилей/переключателей; MA/EMA opacity тоже работает.
- Добавлен DrawingAxisLabels: синие даты при preview/выделении, учитывает видимость по timeframe. У
  новых Фибо подписи по умолчанию над уровнем. Код цвета/подписей прошёл review после 3 исправлений.
- Новое указание пользователя: нижние технические строки не нужны, TV logo убрать. Root убрал оба
  footer и выставил attributionLogo:false; сохраняется скрытый #app-version для PWA.
  Ссылка/NOTICE/лицензия и диагностика доступны в AccountDialog -> ApplicationInfo. Официальная docs
  разрешает отключить logo при сохранении доступной атрибуции/ссылки.
- README/TASKS обновлены под React/PWA/static-only, старые утверждения про backend/polling удалены.
  AGENTS deployment теперь mtp.twiling.ru и mtp-test.twiling.ru.
- Пользователь спрашивал D3/аналоги: root ответил что D3 низкоуровневый; live GitHub stars: D3
  114014, ECharts67793, Plotly18389, LW17979, KLine4335 (25.11.2026). Движки не менялись.

## Очередь

1. Завершить React/TypeScript review и точечный браузерный ретест.
2. GoogleDrive: spec/код/реальныйOAuth/синхронизация собственных Google-аккаунтов.
3. Статическое размещение main/test+privacy, затем GoogleOAuthProduction (явноразрешено user).
4. Публичный smoke/SHA/build, Gitsecretcheck/localcommit/docs.
5. Поэтапно дальше полныйchartUITradingView, безкрайнегоправогоrail; деревообъектовнужно.

## Текущая ReactPWA

React19.3.1, TypeScript6.0.2strict, pnpm10.34.5, esbuild, ESLint/Prettier/OpenSpec. Всеproduction
frontendмодули вsrc TS/TSX, безany/nocheck. `pnpm check` прошёл: формат+lint+strict+build+11tests;
`pnpm spec:validate` тоже. Последний build `b61c647547148c31`,v0.3.0.

Managedserverexec63963 на http://127.0.0.1:5210/ staticonly. Backendнечитаетключи/непроксируетбанк.
`.env` TBANK_TOKENтолькодлядиагностики,невыводить/небандлить/неGit; `.secrets`legacyигнорируется.
Старыеlib/market,tbank,secrets иtestsecrets,package-lock удалены, runtimebankсервер больше не нужен.

BrowserполучаетREST/WSизбанка, ключAES-GCM/nonexportCryptoKey IndexedDB. DB
twiling-personal-terminalv2, storespreferences/drawings/images/history/coverage/vaultнеизменены,
binary48B/candle, backupv1. Рисунки/изображенияпоowner+symbol, общие2движкам; индикаторыобщие.
Поискsubstring350mscatalog/FindInstrument, добавлениеNGконтрактов, банковскиелоготипы.
Lazyhistoryслеваcache/gaps/abort; stats/clearall/symbol/tf; export/importбезключа; PWAupdatebutton.
Фибо2/3point,24настраиваемыхуровня/палитра/линии/фон/координаты/видимость/шаблоны, дерево/ПКМ/слои.

### Проверки

- VanillaQA:14реальныхцен,WS101,1629/3691barsпоразнымпрогонам,обаcanvas,desktop/mobile,
  offline/rememberkey/browserrestart/backup/PWAupdate. KLineprependнепрыгаеткпоследнейдате.
- Reproducedvanilla→React41326ac34fd2f4d2 наown5211:1629свечей/drawPNG/prefs/vaultсохранились,
  новаят вкладкабезsessionStorageвосстановилааккаунт,14цени2canvas. Sourceincognito3691profile
  утрачени за него этоттестневыдавать. Own5211/browser/helperостановлены,QAprofileсохранёнв
  `vps/artifacts/pwa-react-update/QAprofile`,report.jsonрядом.
- ReactUXfirst41326ac:19скриншотовпросмотренытольковvisualworker,JSerrors0,RESTdirectbank,
  нашoriginGETonly. Артефакты `vps/artifacts/pwa-react-qa`; послефиксов ждёмретестb61.
- Независимыйreviewerсейчасзакрылвсе3findingread-onlyharness: позднийbootstraprestoreAнеотменяет
  новыйloginB; невалидныйbackupнеотменяетисторию/loading; PWAAbortSignalсинхронноcleanupдажепри
  pendingregistration. KLineOnCrosshair+сбросOHLCпросмотрены. Новыхблокеровнеобнаружено.
- Последниеcanonicalfix:24newFiblevels(DefaultFibLevelStyles), menu layersopensleftnearrightedge,
  saveViewbeforetoggle/settings, PNGimportстабильныйsyncId+lock/visible/zOrdermetadata,
  priceheaderopaqueBG, KLineOHLC, abortlifecycle/guards. Browserworkerретеститименноих.

## Google Drive

Пользователь: каждый свойТБанкtoken и свойGoogleДиск; синхронизировать инструменты/тему/настройки/
индикаторы/рисунки/изображения. Banktokenиbinaryhistory остаютсялокально. Backendstatic.

GoogleCloudвобычномChromeНАСТРОЕН: проектmtp-twiling,DriveAPIEnabled,толькоnon-sensitive
https://www.googleapis.com/auth/drive.appdata. PublicOAuthClientID:
570894753392-14e7houtg7kc4cdeq6ndpjo7e7sbvnc1.apps.googleusercontent.com

Origins: https://mtp.twiling.ru, https://mtp-test.twiling.ru, http://127.0.0.1:5210,
http://localhost:5210. External/Testing,ownertestuserдобавлен. Brotheremailнет,ноuserЯВНОпопросил
ПОСЛЕпубликацииGoogleProductionдляВСЕХ,безповторногоспроса. BrandinghomepageиprivacyURLнужно сначала
реальноопубликовать https://mtp.twiling.ru/ и /privacy.html, затемGoogleCloudPublish.
GoogleAPI/UserDataPolicy условияuserявнопринялвasyncответе. Небиллинг/нечитатьclientsecret.
КодGoogleвappещёНЕреализован/реальныйOAuthpopup+Drivewrite/readНЕпроверен. Cloudreport
`vps/artifacts/google-drive-setup/setup-report.json`,GoogleCloudtab31.

ОбычныйChrome: officialCLI chrome-devtools.cmd start --autoConnect --channel stable,9222userenabled.
BuiltinMCPaboutblankдругойпрофиль. NativeCUAoserror2,необходитьчерезUIA. Secrets/cookiesнепечать.

## Домены и серверы

Название/основнойадрес mtp.twiling.ru, большеНЕ /quotes/ какосновнойпуть. DNSпроверен:
mtp.twiling.ru→80.85.246.160; mtp-test.twiling.ru→109.197.199.154. Userсоздалсам.
Публикациянаобадоменапользователемразрешена; фактическиMTPещёнеопубликован.

- VDS: ssh.exe -i C:\Users\AlekseiHome\.ssh\vps-tunnel-20261031_ed25519 -o BatchMode=yes
  root@80.85.246.160. Currenttmeetnginxreadonlychecked. СоздатьотдельныйMTPvhost/staticrelease,
  backup+nginx-t/reloadсоткатом,чужиесервисы/gatewayнеперезапускать.
- MacSSHalias twilingmini→192.168.1.163 usertwilingmini; /opt/homebrew/bin/docker. NginxProxyManager
  занимает80/81/443. Existingpiano/gameконтейнерыработают,нетрогать. Толькоdockerpsreadпроводился;
  mtp-testотдельныйnginxstaticcontainer/NPMproxy+TLSещёнастроить.
- Старыеdeploy/install.sh/nginx/serviceдокинаписаныподNodebankbackend+/quotes;НЕЗАПУСКАТЬих.
  serviceфайлудалён; install/nginxнеобходимо заменитьподstaticdomainreleaseпереддеплоем.

Userвопросыпояснены: installedPWAпроверяетобновленияинаосновномадресепризапуске/возврате/60s,
новаяверсияuserbutton. PWAодинstartURL;длябесшовногорезерваодиндоменсDNSfailover,необязателен
внешнийбалансер. mtp-testотдельныйorigin/IDBиотдельноGoogleauth.

## Источники/конфигурация

MTPоригинальныйPineвreference/mtp,группы60/61/30SMAотClose/#1e90ff. PublicTradingViewbundles133шт
16.6MB/DOM/factoryFib/fontstack провереныагентомвvps/artifacts/tradingview-reference-current. Не
копироватьихвприложение. Текущиеfactory vsuseroverridesотдельновfibonacci-reference-map.json.

Перенесеныuser-requestedобщие.agents/skills+.claude/skills,.codex/roles/config,.mcp/opencode,
.vscode/настройкиpnpm/ESLint/Prettier/адаптированныеAGENTS,CODE_STYLEизgames/towerdefander и
pt-agents/night-status-20261115. AGENTSexplicitделегированиедляэтогопроектаразрешает.
App.tsxcomposition, modules≤500,strict/noany/nocheck. Скриншотыfreshworker,родителютекст+пути.
VSCodepersistentterminalsOFF.

README/TASKS/CONTINUEпокаСОСТАРЕЛИотvanillaэтапа!
Этотфайл—свежийcheckpoint;перезаписатьcanonicaldocs дофинала.
Gitновыйбезremote/initialcommit,индексчастичностарыйA;послеcheckssecret-scanиlocalcommit.
СоседнийVPSdirtyрепонетрогать. ПубликацияMTPнеозначаетpush/mergeчужихрепозиториев.

ПоследнийuserresearchTradingViewAPIотвечен: официальногоpublicquotesAPIнетниfreeниpaid,
NYMEXfree10min,MOEX/RUSточныеусловиянеподтверждены. НашаPWAостаётсяdirectTBank.
