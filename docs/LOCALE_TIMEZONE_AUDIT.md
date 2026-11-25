# Аудит языка и времени

Реализация находится в отдельной ветке `feat/locale-timezone` от `2ab4dc3`; исходный сервер 5210,
профили пользователя и canonical public не менялись.

## Покрытие

- 544 системные фразы в типизированных словарях `messages-ui`, `messages-drawings`,
  `messages-tools`, `messages-errors`; ни один модуль не превышает 500 строк.
- Основной UI, toolbar, right panel/watchlist, drawing toolbar, account/storage/backup, instrument
  search, chart/indicator settings и drawing settings проверены рендером React в English.
  Проверяются текст и атрибуты; пользовательское имя и подпись рисунка сохраняются.
- Аудит исходных RU string literals вне i18n оставил 29 допустимых строк: официальные
  названия/значки инструментов, индексные названия, Т‑Банк/Т‑Инвестиции, название языка Русский,
  copyright и русский вариант document.title. Это не независимая браузерная приёмка.
- Составные уведомления/помощь переводятся отдельно через `systemText`; пользовательские названия
  компаний, рисунков, изображения и текст рисунков не проходят через составную замену.
- Произвольный текст внешней ошибки остаётся исходным, если фраза неизвестна словарю.

## Время

- Полный IANA список берётся из `Intl.supportedValuesOf("timeZone")`; первые Moscow, UTC, local и
  exchange.
- Смещения рассчитываются для конкретного момента Intl, включая DST, +05:30, +05:45, −03:30 и
  +13:45. Русские распространённые города заданы самостоятельно; остальные показывают читаемое IANA
  city name без заявления полного русского перевода. Данные CLDR отдельно не включались.
- Оба адаптера, drawing axis labels и intraday drawing coordinates используют выбранную зону. D/W/M
  показывают исходную UTC trading date; точки UTC не перезаписываются ради смены зоны.
- ClockZoneControl берёт время через controller.marketNow; выбор зоны не меняет системные часы и
  абсолютную длительность countdown.
- Unit-тесты проверяют DST transition/gap/fold, локали чисел/дат/OHLC, backup roundtrip, view
  identity, UTC points и calendar callback semantics.

## Оставшаяся приёмка

- Координатор подключает ClockZoneControl в общий footer и callbacks к новой ветке 13 native
  intervals по LOCALE_TIMEZONE_INTEGRATION.md.
- Свежий визуальный агент проверяет обе библиотеки, все меню, поиск/прокрутку IANA, клавиатуру,
  Escape/outside и отсутствие жеста графика при выборе. Рендер React не доказывает качество layout и
  браузерное поведение.
- После этой интеграции и браузерной приёмки архивируется OpenSpec change.

## Проверки отдельной ветки

- `pnpm check`: format/lint/typecheck/build и 172 теста PASS, включая 13 новых тестов языка/времени
  и интерфейса.
- `pnpm spec:validate`: все 8 спецификаций/changes PASS.
- `git diff --check`: PASS. Production controller — 499 строк.
- Это самостоятельная тестовая сборка 0.3.7; работающая сборка canonical не заменялась.
