## 1. Авторизация

- [x] 1.1 Реализовать public configuration, PKCE reload/cancel и encrypted vault с account binding;
      проверка: `yandex-auth.test.mjs`.
- [x] 1.2 Проверить state mismatch, повтор callback, disable epochs и сохранение credentials;
      проверка: auth/coordinator tests, включая concurrent credential generation.

## 2. Хранилище

- [x] 2.1 Реализовать scoped bounded transport с timeout/abort/retry и проверкой upload/read-back;
      проверка: `yandex-transport.test.mjs`.
- [x] 2.2 Реализовать portable bundle, immutable operation journal, текущую/предыдущую версии
      причинных ветвей без physical GC; проверка: `yandex-revisions.test.mjs`, cold header-only
      inspection и postcommit receipt в `yandex-coordinator.test.mjs`.
- [x] 2.3 Добавить isolated synthetic diagnostic probe без токенов в отчёте; проверка: mock
      synthetic binary roundtrip в transport test.

## 3. Интеграция и проверка

- [x] 3.1 Реализовать factory по согласованному общему host contract, сохранив независимое
      выключение; проверка: coordinator tests и standalone TypeScript с frozen интерфейсами.
- [x] 3.2 Выполнить целевые тесты, TypeScript, lint и OpenSpec validation: 40/40 целевых тестов,
      `tsc --noEmit`, scoped ESLint и strict OpenSpec 118/118; сборкой общего приложения управляет
      координатор.
- [ ] 3.3 После регистрации приложения проверить настоящий OAuth, upload/download CORS и PWA
      callback. Без runtime evidence не считать выполненным.
