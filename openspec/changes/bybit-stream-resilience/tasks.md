# Tasks

## 1. Поток

- [x] 1.1 Добавить bounded диагностику close/timeout/protocol/network и тесты без утечки
      frame/reason.
- [x] 1.2 Добавить online/visible recovery, ограничение частоты и cleanup; проверить fake-clock
      тестами.
- [x] 1.3 Закрыть reentrant retry/connect: воспроизвести onError/onState/factory clear/resubscribe,
      проверить один сокет и отсутствие таймеров после dispose.

## 2. Статус

- [x] 2.1 Различить reconnect/exhausted/offline и восстановление по реальным данным; проверить
      тестами.
- [x] 2.2 Перевести восемь сообщений для спота/контрактов и проверить systemText en.

## 3. Интеграция

- [x] 3.1 Выполнить scoped tests, plain tsc, ESLint, Prettier и spec:validate; передать diff
      координатору.

## Workflow follow-up

- Архивировать после интеграционной проверки координатором.
- Координатор выполняет общий build и браузерный smoke, включая online/возврат вкладки.
