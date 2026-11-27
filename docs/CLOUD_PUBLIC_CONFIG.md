# Публичная конфигурация OAuth

Приложение использует PKCE без client secret. Проверенный публичный Client ID уже включён в код. Для
локального переопределения создайте игнорируемый `.env.local` в корне проекта:

```dotenv
MTP_PUBLIC_YANDEX_CLIENT_ID=5eb8206c526a4c5593716703d091fa8d
MTP_PUBLIC_YANDEX_REDIRECT_URI=http://localhost:5290/__dev/app/yandex-callback.html
```

Поддерживаются также `http://127.0.0.1:5290/__dev/app/yandex-callback.html`,
`https://mtp-test.twiling.ru/yandex-callback.html` и `https://mtp.twiling.ru/yandex-callback.html`.
Redirect URI должен совпадать с origin приложения. Без переопределения callback определяется по
адресу приложения.

Только эти две публичные переменные попадают в браузерную сборку. Любые другие ENV-переменные,
включая секреты, не сериализуются этим механизмом. Не добавляйте `.env.local` в Git. После изменения
ENV нужна новая сборка или перезапуск DEV. Сам файл `.env.local` не раздаётся.
