# Проверка 0.3.16

Проверенный код: `6d5fbbf769c523d284a7e8ceaad1fc85bcebce84`, content build `b783575aa314c53d`, 61
asset. Общий check:479/479, strict OpenSpec29/29. Windows deploy tests: 11 passed, 3 Linux-only
skipped; deployment pin отдельно проверен WSL Ubuntu27/27.

Независимая browser QA выполнена в отдельном Chrome/profile, background=true. Пользователь явно
разрешил автономную копию Chrome, обычный профиль не использовался. Итог scoped PASS, блокирующих
замечаний нет. Локальный отчёт `vps/artifacts/release-0316-qa/report.json`: 19 просмотренных кадров,
из них 18 acceptance.

- Divider: hit8px/rule3px gray, drag вверх/вниз, точное сохранение/reload, независимые scroll.
- Шрифт: реальный Trebuchet MS14px/400, line-height14px, row31px.
- Fib level/trend/обычная линия: текущий цвет/толщина/непрозрачность в previews,
  solid/dashed/dotted, native dialog portal, keyboard, Escape, outside, край viewport.
- Валюты: USDRUB_TOM/USD/RUB и EURRUB_TOM/EUR/RUB в All/Currencies; CETS и дилер различаются UID и
  источником. Реальный legacy каталог обновлён Currencies29/HTTP200 без очистки.
- Будущая ось: LW и KLine1d показывают девять месяцев после последней реальной свечи. LW1M
  показывает девять месяцев, следующий tick отсутствует. KLine1M ограничен native barSpace50 и
  collision56.
- Свечи/объём/MTP/SMA/EMA не продолжены в будущее. Камера сохраняется при движении, смене grid,
  отрисовке picker; native min-real-bars pan boundary остаётся.
- Mobile375×667 touch/coarse: видимые arrows и picker, divider drag, нет horizontal overflow.

После QA восстановлены exact46 preference records; Drawing/Image metadata hashes и blob1559, vault
SHA256 неизменны. Эти stores не записывались. Новые startup metadata prefs удалены только как
отсутствовавшие в исходной тестовой копии. Свои Chrome/helper закрыты.

Ограничения: scoped ServiceWorker/cache bypass для точной network-сборки; штатное PWA обновление не
проверялось. Google Drive REST заблокирован только тестовым маршрутом, живого Google входа/
синхронизации нет. Mobile — эмуляция. Девять месяцев являются горизонтом продукта, точный предел
TradingView не доказан. Изменения livepreview настроек рисунка и полноценные ТА/Bybit в эту версию
не входят.
