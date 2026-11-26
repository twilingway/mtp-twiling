# 0.3.23: TA-индикаторы, сохранение панелей и проверка Drive

Это отчёт о проверке кандидата. Слияние, CI main, автоматическая публикация и обновление PWA
подтверждаются отдельно по точному SHA и хешам публичных файлов.

## Изменения

Добавлены Parabolic SAR, Supertrend, ALMA, LSMA и Chandelier Exit: 50 вычисляемых TA, 51 технический
индикатор с объёмом и 55 записей библиотеки с четырьмя MTP-скриптами. SAR использует крестики,
Supertrend — раздельные ветви и заливки. Все пять сохраняют native-price policy после переноса в
отдельную панель. Старые определения, параметры, стили, требования истории и численные результаты
проверены независимыми Git-source witnesses. При чрезмерной стоимости ALMA/LSMA возвращается явный
transient calculation-limit без усечения истории или изменения параметров.

Изменение высоты панели сохраняет полный порядок и свежие параметры остальных панелей, включая
сворачивание, высоту и предыдущее переупорядочивание в очереди. Runtime-контекст отделяет изменённые
панели от исходного порядка; формат сохранений прежний.

В компактных панелях TA высотой до 30 CSS px скрыты статические числовые подписи и горизонтальная
ценовая метка перекрестия. Линии и временная метка сохраняются. В основной и развёрнутой панелях
метки восстанавливаются. Width hold сохраняет ширину графика при временном изменении native label
policy; пользовательский режим курсора не включается обратно при восстановлении.

Drive guard проверяет payload текущего снимка и родителей до принятия или публикации, в том числе
при совпадающем head. Неподдерживаемая local association останавливает синхронизацию без замены на
defaults. Пауза использует auth.suspend и сохраняет действующий credential до исходного expiry.
Проверка формата читает JSON без image binaries. Поздняя гонка может оставить orphan blob: атомарный
server CAS и отсутствие всех загрузок в любом сценарии не заявляются.

## Проверки исходников

- Финальный source/browser cut: `e78cb57f27a00ecf3ecf7aed0a69391e918f4d8d`; версия `0.3.23`, build
  `4f05a9f589fb0222`.
- `pnpm check`: 1112/1112, exit 0; `pnpm spec:validate`: 57/57, exit 0.
- SAR/Supertrend: independent 9 групп и 55 focused tests.
- ALMA/LSMA/CE: math 88, registration 9, settings 4; independent 50 numeric, 99 preflight и 9
  actual-submit probes. Принятые math blobs сохранены; обе ветви SDK получают полную историю.
- Pane capture/order: независимые 10 probes и 19 repeated tests; integrated 94/94.
- Compact crosshair: 88 focused/baseline tests и 10 независимых групп, включая installed-native
  label/axis sizing paths, по 2000 hover/leave cycles на движок, manual 30/31, stationary
  expand/reorder/remove, Hidden mode, dispose и отсутствие дрейфа width.
- Reader guard: 73 новых и 108 existing tests; independent actual Auth/AES-vault 7/7. Ciphertext и
  исходный expiry сохраняются, handles отменяются, другой owner/generation не меняется.
- Отдельный Git clone без alternates выполняет 11/11 исторических witnesses; ancestry содержит
  оригинальные принятые math commits. Аудит source e78: 177 commits, 1963 blobs, совпадений с
  секретами 0.

## Проверка интерфейса

Основной проход на source `ffc13bb07e8f4bd385691dc35b87e79cb58a9fd1`, build `62d28d73002305a0`: 33
просмотренных PNG из 41 сохранённого. Реальные Bybit spot/linear REST и WebSocket, оба native
движка, default/nondefault настройки пяти новых TA, крестики SAR, ветви и заливки Supertrend,
сохранение прежних 11 TA и рисунков, native divider drag, engine/reload/import, слои MTP/сетки,
RU/EN, dark/light и 375×667. Этот проход обнаружил ценовую метку в свёрнутой панели на обоих SDK.

Окончательное исправление e78 прошло отдельный свежий visual gate: 29 PNG сохранены, 23 просмотрены.
На обоих SDK компактные RSI/Fisher не показывают числовую метку; при одинаковых размерах camera,
range, width, candle count/last и right gap совпали до/во время/после hover.
Main/expanded/leave/remove восстанавливают метки, Arrow остаётся Hidden. Stationary expand/reorder и
legacy volume проверены на KLine, light/mobile 375×667 — на обоих SDK. Ошибок страницы нет,
собственные Chrome и сервер закрыты. Ручной UI resize зажимается на 44 px: граница 30/31
подтверждена source/native тестами, а не UI drag. Полный исторический pre-launch hash сборки не
сохранён; финальные 67 файлов совпали с хешами координатора, снятыми во время прохода. Clean e78 и
build 4f05 проверены до/после; исходный профиль сохранён. Родительский контекст не получил новых
tool images; сетевые байты не измерялись.

При одинаковых размерах и данных hide/remove сохраняют диапазон и правый отступ. Изменение высоты на
LW может менять native rounded bounds: в основном проходе при 333→391 px наблюдалась разница около
0.23 px. Поэтому точное равенство численного диапазона при разной высоте не заявляется.

## Границы

LSMA length 1 остаётся неподтверждённым execution oracle; local min 2 не выдаётся за Pine minimum.
Все 127 названий каталога ещё не реализованы. Keltner source registration проверена отдельно и в
этот выпуск не включена; Donchian требует поддержки смещённых plots. Новых writers instance 2,
envelope 3 или DB 3 нет: G5 compatibility остаётся отдельным предложением.

Реальные Google OAuth/Drive, синхронизация двух устройств, установленное окно PWA и физический
телефон этим локальным проходом не подтверждаются. Загрузка GIS SDK не считается входом Google.
