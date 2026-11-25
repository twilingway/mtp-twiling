# Tasks

## 1. Реализация

- [x] 1.1 Добавить фиксацию масштаба цены в оба адаптера через публичный API/DOM, проверить
      typecheck и тест DOM bridge.
- [x] 1.2 Добавить состояния курсора пустого графика и завершения жеста, проверить scoped ESLint и
      форматирование.

- [x] 1.3 Добавить переход к объекту без изменения масштаба, проверить геометрию focusRange;
      восстановление после fit и порог начала pan проверить тестами DOM bridge и движения.

- [x] 1.4 Общая камера, pending восстановление после данных и source guards: проверить
      chart-camera/lifecycle тесты, typecheck, ESLint и форматирование.

- [x] 1.5 Сохранить incoming views при импорте и изолированно очистить shared camera; проверить
      chart-import-camera и lifecycle tests, typecheck и scoped ESLint.

- [x] 1.6 Исключить лишнее пересоздание графика от toolbar settings, исправить queued RAF restore и
      redraw visibility; проверить hook lifecycle и шесть последовательных native camera restores.

- [x] 1.7 Применить incoming camera при семантически одинаковом layout через chartRevision;
      проверить same-source import apply once, stale callbacks и неизменность ревизии при
      failed/invalid import и toolbar actions.

## 2. Интеграция

- [ ] 2.1 Проверить горизонтальное перемещение, wheel zoom и ручную ценовую ось визуально в обоих
      движках.
- [ ] 2.2 Выполнить общие проверки проекта и pnpm spec:validate.

## Workflow follow-up

QA0.3.5: KLine exportA/panB/importA визуально PASS без reload. LW поля камеры восстанавливаются, но
loaded history после import короче исходной (слева пустота); P2 остаётся открытым. Evidence:
`vps/artifacts/mobile-terminal-qa/report.json` и `camera-tradingview-import-A-settled.png`.

- После браузерного подтверждения синхронизировать спецификацию и архивировать изменение.
