# MTP TWILING — текущая автономная работа

Обновление 26.11.2026. Этот файл важнее исторических статусов в HANDOFF_NEXT_SESSION.md. Цель
остаётся активной: привычный интерфейс и функции TradingView, без потери пользовательских данных.
Пользователь спит и разрешил автономный отдельный Chrome. Обычный Chrome не трогать; ручной Google
login отложить. Ответы коротко по-русски. Реальный cap — четыре агента с root.

## Опубликовано

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
  застывают, RSI живой. Установлена точная причина: native fractional heights598.5672/33.4328
  против integer clientHeight599/33; Canvas.update пропускает redraw, ожидая отсутствующий RO.
  Исправление целочисленных native bounds сохраняет общий размер и ratios. Check622/622,
  strict spec35/35, build `65fd586523b0a42e`; новый browser gate ещё требуется.

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
   `/root/mtp-watcher-backup-20261125T220317Z-b721744af1b5`; лимиты сохранены, pin убран,
   provenance содержит настоящий browser proof. Timer enabled/active. Старые first-release apply
   scripts не запускать.
2. Включить подтверждённый KLine fix, полный check/spec и новую QA0.3.18 с21 TA/Bybit/рисунками,
   reload, viewport, сохранением камеры, extreme pane overflow и отсутствием click-through.
3. До публикации0.3.18 отдельно reviewed обновить только свой nginx CSP include: добавить
   https://api.bybit.com и wss://stream.bybit.com. Pull watcher не имеет root и сам nginx не меняет.
   Обязательно nginx-t/reload/публичные headers/соседи. Не забыть этот gate после local browser
   PASS.
4. PR5 draft уже открыт (head до fractional fix5ea3f3b, CI45710199951 success). Secret audit всей
   release history; версия0.3.18 уже в package. Затем PR/CI/main и отдельное
   доказательство публичного SHA/build/health/visible behavior. Не смешивать код/merge/deploy/QA.
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
