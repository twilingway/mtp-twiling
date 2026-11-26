# Текущая очередь

Актуально 26.11.2026: сначала `HANDOFF_AUTONOMOUS_CURRENT.md`. Public/canonical — **0.3.23**, main
`62a1a36f2409911f6bdb029f37e0bfe14e852489`, build `4f05a9f589fb0222`: 50 вычисляемых TA, объём и
четыре MTP. CI, штатный автоматический деплой всех 67 файлов и обновление PWA проверены. Прежние 11
TA/панели/рисунки/камера сохранены после обычного Update, reload и offline.

Кандидат 0.3.24 содержит Keltner Channels и защиту диапазона соседней панели KLineChart. Продуктовые
сценарии обоих SDK проверены на `8306dd6`, исправление мобильной формы на `43b210d`. В первую
очередь завершить проверку Google Drive в обычном Chrome, подтвердить Google OAuth Production и
проверить установку и обновление PWA. Остальная очередь — после выпуска.

## Открытая очередь после текущей приёмки

1. Остальные TA: в каталоге 127 названий, в 0.3.24 доступны 52 встроенных с объёмом. Pure math пяти
   новых осцилляторов принята после исправления Stoch RSI, но не зарегистрирована. Stoch RSI/Coppock
   — следующая регистрация после freeze precision/defaults; RVGI/RVI требуют per-plot offset,
   Bull/Bear Power — palette/style compatibility. Каталог не считается готовым по наличию имён.
2. Custom 4/6/7/8/9 минут, 45 минут и 3 часа: pure math проверена, product enum/provider/session/
   cache/coverage glue не подключён. 3/6/12 месяцев также остаются недоступными.
3. Рисование: геометрия восьми DrawingTool работает; многие пункты левых меню пока недоступны.
   Остаются остальные фигуры/каналы и подробные Fib log/alpha/template/label-collision сценарии.
4. Узкий экран с 11 панелями: expanded pane может остаться 30 px. Причина и A/B-прототипы найдены;
   изменение базы сохранённых heightRatio требует отдельного решения, production не менялась.
5. Google: source sync/auth restore реализованы; настоящие OAuth/Drive/два устройства не проверены.
   Ключ банка и история остаются локально; валидный Google token восстанавливается до исходного
   expiry. Автоматический refresh без серверного секрета не реализован.
6. OKX — fallback только после точного отсутствия пары в Bybit; реализации пока нет. Новые drawing
   types требуют forward-reader capability gate: текущий reader отклоняет их без потери данных, но
   классифицирует как remote-invalid, а не update-required.

Удаление/порядок инструментов, разделы, семь цветных флагов, resize и правое дерево уже реализованы.
Старые блоки ниже описывают историю разработки и не заменяют эту сводку или актуальные проверки.

Актуальное дополнение от 25 ноября 2026:

- В canonical 0.3.13: корзина только при hover/Tab на кнопку, стабильный сброс LW и удержание
  стрелок прокрутки. Check 373/373, OpenSpec 20/20. Браузерная проверка выполняется отдельно.
- Исправления списка: цветные списки выбираются в заголовке, каждая строка меню и выбранный
  заголовок показывают цвет. Отдельная строка «Цветной список» убирается. Контур строки и флажок
  приводятся к привычному виду. Навигация графика появляется рядом с нижней центральной зоной.
- Карточка инструмента T-Invest API выполняется независимо: показатели, дивиденды, даты отчётов,
  прогнозы; динамика/средний объём/сезонность из свечей. Загрузка разделов по запросу, без
  придуманных исторических финансов и без автоматической загрузки многолетней истории.
- Следующая задача списка — разделы. Новый раздел объединяет инструменты ниже до следующего раздела.
  Перенос между разделами и сортировка внутри каждого сохраняются. Удаление раздела сохраняет его
  инструменты и возвращает их на верхний уровень; инструменты не удаляются. Для этого нужна явная
  принадлежность к разделу, а не только визуальный заголовок.
- До дальнейшего расширения каталога: завершить текущую проверку, первый публичный выпуск и реальную
  проверку Google Диска на двух устройствах. Подключение к обычному Chrome через DevTools MCP
  --autoConnect уже подтверждено; OAuth ещё не проверен.

Ниже сохранены исторические записи; их старые версии и статусы не являются текущими.

ОБНОВЛЕНИЕ: см. самый верх HANDOFF_NEXT_SESSION.md. KLine canvasfix, nav5, flags7, Drivecore/UI,
Welcome/Storage, MTP151 и выравнивание иконок уже в canonical SOURCE; served пока старая0.3.10. Три
активныхfix: prior-dayquote bases(14UIDaudit), depth-only camera carry, Driveusercamera intent race.
Затем0.3.11 общийcheck/spec и freshisolatedbrowserQA, только потом publicpush/CI/VDS. Ниже старые
статусы, SOURCEFROZEN отменён после exactrestore/close kline-scale worker.

САМОЕ НОВОЕ: .10/main1953608/build5219f27b5345f071 check222+spec11 PASS. Height ready+pending
nativebrowserPASS, legend/favorites/mobileOHLC/PWA/RUEN/zones/minutegridPASS. Новый gateFAIL: KLine
Yaxis0..10 послеFit/resize приценах78..119, freshkline_scale_regressionисследует (чистый
сценарийпокаhealthy). SOURCEFROZEN/QAprofileownerэтотагент, нетrelease/push. FoundationVDS/TLSDONE,
timerdisabled. DriveUI277tests+portablecontract32e09вownbranch, raceguardдофинала; Nav913dготов
неintegrated;7colorflagsвownworktreeпочтиготовы; derivedcustomminute/45m/3hещёqueued. Подробности
самыйверхHANDOFF_NEXT_SESSION.md.

НОВЕЕ: browser gate0.3.9/f9d698d518582bc7 FAIL на VOL height persistence: настоящий divider95→215,
prefs/IDB undefined, reload→95. Legend collapse/expand, favorites+keyboard/mobile, update0.3.8→0.3.9
PASS. Тест был при empty2m history, поэтому fresh `kline_real_drag_fix` проверяет READY daily и
actual event/guards перед исправлением. Прежний browser закрыт, originals
layout/drawings/images/14views exact, +5QAkeys сохранены. Следующий выпуск0.3.10 после fix/QA;
НЕpush/deploy как готовое. Foundation VDS устанавливается отдельно, timer/build/release disabled.

**Актуально: main HEAD64a9a0f, 0.3.9/f9d698d518582bc7.** Check222/222 и strict spec11/11 PASS;
независимый calendar review PASS. Публичный GitHub с Issues создан:
https://github.com/twilingway/mtp-twiling . Origin подключён, master переименован в main; исходники
пока НЕpush. Полный history secret audit на64a9a0f:15commits/654blobs,0findings.

Текущий gate: fresh `release_039_visual` проверяет exactbuild и владеет QA-профилем; НЕ менять
source/CSS/build до его first restore/close. Update0.3.8→0.3.9 кнопкой уже PASS без потери
layout/drawings/images/14 исходных views. Итог визуала ещё не получен.

Влито:13nativeTF и реальные календарные линии, toolbar favorites, RU/EN и IANA зоны/clockfooter,
сетка+подписи на тех же локальных границах (DWM UTC trading date), МТП над сеткой/под свечами,
полупрозрачные плашки. KLine VOL теперь создаётся один раз, heightRatio per-owner в IDB/backup;
legendCollapsed отдельно, chevron+normal-flow legend устраняют mobile OHLC overlap. Все эти
сохранения ещё требуют текущего browser gate.

CI/CD: код и global public API limiter влиты, Linux11/11 и независимое review PASS. Build cold
checkout исправлен; package semver+content buildId. `cicd_deploy` устанавливает только foundation
VDS/pnpm/TLS/unit, без start timer/build/release до root разрешения. VDS1GiB, cgroup240M/320M,
CPU50%; соседние tmeet/meet не менять. Readiness: `vps/artifacts/cicd-install-readiness.md`.

Далее: закончить QA, push exact main/CI, первый bounded VDS build+public SHA/hash/PWA proof, затем
timer. Остальная очередь: типы графика native integration, identity/Backup2 + раздельные
exchange/dealer history caches, Bybit/OKX, Drive UI/OAuth. Старые блоки ниже исторические.

Обновление: 0.3.8/6b325f8c3931d68d, commit 6c5d37a — МТП Lightweight над сеткой и под свечами,
полупрозрачные плашки заголовка/индикаторов; общий check160/160 и strict spec7/7 PASS. Визуальная
проверка этих двух изменений ещё впереди. QA0.3.7 завершена, браузер закрыт:
`vps/artifacts/black-ohlc-transfer-qa/report.json`. Чёрная тема/OHLC/оригинальный restore PASS;
KLine успешный короткий холодный import отдельно не подтверждён (длительный дал timeout).

Новые независимые задачи:

- CI/CD по образцу towerdefander: merge main, CI gate, pull watcher, сборка и atomic static deploy,
  rollback и provenance; package semver повышается вручную, content buildId отдельно. Агент работает
  в `vps/artifacts/cicd-worktree`; GitHub remote пока отсутствует, gh auth невалиден.
- KLine не сохраняет высоту/положение панелей индикаторов: `setData` удаляет VOL и заново создаёт с
  height95. Нужны сохранение per-owner и повторное применение без сброса при подгрузке, смене
  инструмента и перезагрузке; не считать реализованным.
- Месячная/дневная сетка требует реальных boundary ticks: один `tickMarkFormatter=""` скрывает
  подпись, но оставляет линии LW. Intervals worker исправляет это перед интеграцией.

Актуально0.3.7/cb508bf9d82d2abf: общийcheck159/159 и независимые history/transfer reviews PASS.
Логотип теперь только цветные МТП, тёмнаяпалитра#000000, OHLCцветной, импортполного окна и быстрый
import/export защищены очередью/retired/barrier/recovery. Fresh visual gate идёт в
`vps/artifacts/black-ohlc-transfer-qa`, не пересобирать стенд до завершения. Старые статусы0.3.5
ниже исторические; authoritative подробности — начало HANDOFF_NEXT_SESSION.md.

Новые запрошенные задачи, которые остаются до полного соответствия:

1. Dropdownтаймфреймов как TV:13nativeTBank реально подключаются в isolatedfeat/intervals-menu;
   pure18registry/menu commit a6486c27 ужеготов, но ещёНЕинтегрирован.5derived требуютsource/session
   glue. Отдельно понятно разделить интервал свечи и lookback истории,
   дневныеticksмесяцами/часовыеднями.
2. Типы графика/индикаторы: purechart-types/menu/HA commit f5f1848f готов в отдельнойветке,14тестов,
   НЕинтегрирован. Nativeadapters/crosshair/realprice/indicatorsemantics ещёподключить;
   полныйкаталог индикаторов224 IDs покаreference, реальные6keys. Не объявлять22типа готовыми по
   наличиюменю.
3. Язык интерфейса Русский/English ссохранением. Выборвременнойзоны изпрокручиваемогосписка: Москва
   default, UTC, устройствоиостальныеIANA. Толькоотображение, хранимыесвечи/drawings UTC неизменны;
   сессии/агрегации остаютсявтаймзонебиржи. Согласоватьfooterclockсlookbackcontrol.
4. Затем canonicalidentity/Backup2, Bybitprimary+OKXтолькоприотсутствиипары, DriveUI/OAuth
   иstaticdeploy.

Текущая сборка0.3.5 `8d7c16e44f955542`: общий check120/120 PASS; после последнего исправления React
keys повторно strict build/scoped lint/format и120/120 тестов PASS. Исправлены лишний remount от
toolbar settings, queued LW camera restore и KLine axis drift. Мобильный список поверх графика и
fullscreen поиск реализованы; изолированная QA —
`vps/artifacts/mobile-terminal-qa`:375/320/landscape,обе темы,27 просмотренных скриншотов,0 page
errors. Мобильных блокеров нет. KLine importA PASS; LW сохраняет поля камеры, но сокращает ранее
загруженный участок истории — отдельный P2, следующий hotfix. Полное поведение всех92 средств ещё не
готово: геометрия8 DrawingTool, остальные явно недоступны.

1. **Рисование и управление TradingView:** копирование/вставка, клонирование, отмена/повтор, курсор
   и перетаскивание. Проверить код, тесты и оба движка.
2. Довести запрошенные исправления графика. Ближайшие дополнения: таймер закрытия свечи с
   переключателем; меню интервалов, включая месячные свечи и сборку 3/6/12 месяцев; затем меню типов
   графика (свечи, бары, линия, область, Хейкен Аши и другие по данным/движку). Сохранить остальные
   запросы: одинаковые расстояние между свечами и правый отступ при смене инструмента; синие даты
   точек рисунка; Фибоначчи; левая панель и вложенные меню; изменение ширины графика/списка;
   удаление из списка, цветные отметки и различение биржевых режимов в поиске.
3. Закрыть миграцию React/TypeScript: актуализировать документы и OpenSpec, проверить сборку.
4. Google Диск: собственный аккаунт каждого пользователя; синхронизируются список, настройки,
   индикаторы, рисунки и изображения. Ключ банка и история котировок остаются локально.
5. Опубликовать отдельные статические сервисы `mtp.twiling.ru` (VDS) и `mtp-test.twiling.ru` (Mac
   mini), HTTPS и privacy; затем перевести Google OAuth в Production — уже разрешено.
6. Проверить публичные версии/обновления, исключение секретов и сохранить изменения в Git.

## Уже реализовано

- React + TypeScript strict, адаптеры Lightweight Charts и KLineChart.
- Прямые REST/WebSocket к Т-Банку из браузера, индивидуальный ключ с сохранением на устройстве.
- IndexedDB: история с дозагрузкой слева, рисунки и изображения по аккаунту/инструменту.
- Общие индикаторы, импорт/экспорт настроек и разметки, статистика/очистка истории.
- Формулы MTP из Pine Script, дерево объектов, контекстные меню и порядок слоёв.
- Настройки Фибоначчи: уровни, линии, фон, подписи, координаты, видимость, шаблоны.
- Поиск по вхождению с debounce; банковские логотипы, без мигающей заливки котировок.
- PWA: offline-оболочка, установка, проверка версии и уведомление об обновлении.
- Google Cloud: Drive API и OAuth Client ID настроены. Drive core готов в отдельной ветке
  feat/google-drive-sync, commit7f36691;36 fake tests и независимый review PASS. UI bridge и
  настоящий OAuth/Drive пока не проверены и не подключены.

## Рабочее окружение

- Актуальные исходники: `src/` этого проекта. `vps/artifacts/pwa-ts` — устаревший staging.
- Пользователь тестирует `http://127.0.0.1:5210/`; его вкладку и процессы сохранять.
- `.env`/`.secrets` не выводить, не бандлить и не добавлять в Git.
- Старые deploy-файлы с `/quotes/` и банковским backend заменить перед публикацией.
