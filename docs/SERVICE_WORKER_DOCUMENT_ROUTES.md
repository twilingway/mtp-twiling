# Маршруты документов Service Worker

Исправление от26.11.2026: установленный SW заменял любой navigation-запрос оболочкой терминала.
Поэтому `/privacy.html` и `/licenses/lightweight-charts-LICENSE.txt` после установки PWA показывали
приложение, хотя прямой HTTP возвращал правильные документы.

Теперь только корень scope является псевдонимом `index.html`. Остальные URL ищутся по своему точному
пути в precache с игнорированием query; при отсутствии идут в сеть с исходным запросом.
Offline-документ возвращается из precache с собственными байтами и Content-Type. Ошибка
отсутствующего документа не скрывается оболочкой.

## Инвентаризация маршрутов

Правила одинаковы для `mtp.twiling.ru`, `mtp-test.twiling.ru` и любого `BASE_PATH`, например
`/quotes/`.

| URL относительно scope                                                | Ответ                                                                                     |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Пустой путь `/`, query на корне, fragment                             | Оболочка `index.html`; fragment отдельного fetch не создаёт                               |
| `index.html`, включая query                                           | Точный precached `index.html` либо сеть — та же оболочка                                  |
| `privacy.html`, включая query                                         | Отдельная страница privacy, online/offline из precache                                    |
| `licenses/lightweight-charts-LICENSE.txt`                             | Реальный текст лицензии                                                                   |
| `licenses/klinecharts-LICENSE.txt`, `licenses/klinecharts-NOTICE.txt` | Реальные тексты лицензии и notice                                                         |
| `licenses/react-LICENSE.txt`, `licenses/react-dom-LICENSE.txt`        | Реальные тексты лицензий                                                                  |
| Остальные JS/CSS/SVG/manifest и другие precached assets               | Их собственный ответ, включая navigation к asset                                          |
| `terms.html`, `legal/privacy.html`, произвольный deep route           | Сейчас таких файлов/SPA routes нет: сеть/404 либо offline failure; shell не подставляется |
| `version.json`                                                        | SW не перехватывает; актуальность проверяется в сети                                      |
| Другой origin, путь вне scope, не-GET                                 | SW не перехватывает                                                                       |

В source есть ровно два HTML: `public/index.html` и `public/privacy.html`. Лицензии копирует
builder; NOTICE создаётся только при наличии файла зависимости. Текущий release содержит пять
перечисленных текстов. `terms.html` отсутствует. Приложение не имеет pathname-router: состояние UI
не вводит дополнительных SPA путей. Сервер и nginx также не имеют общего SPA fallback.

Для `/quotes/` правила применяются к `/quotes/privacy.html`, `/quotes/licenses/...` и т.д. `/quotes`
без завершающего `/` остаётся вне scope SW; delivery server выполняет прежний redirect к `/quotes/`.
Префикс `/quotes-other/` не совпадает со scope.

## Проверки и выпуск

`node --test test/service-worker-navigation.test.mjs` выполняет настоящий fetch handler из template
с navigation-mode запросами, install/precache и разными origin/scope. Проверяются реальные
privacy/index bytes, Content-Type, root/subpath, online/offline, cache miss, legal404 и исключения.
Сеть и сервер не запускаются.

Worker template входит в content buildId, поэтому обычная следующая сборка выпускает новый SW.
Пользователь получает стандартное обновление PWA; unregister/очистка хранилища не нужны. После
штатной активации QA проверяет privacy и LICENSE в сохранённом профиле. Версию повышает координатор
отдельно; браузерная проверка не заменяется этими unit tests.
