# Tasks

## 1. REST и каталог

- [x] 1.1 Реализовать ref/types, строгие normalizers и HTTP ошибки; проверить fake
      fetch/abort/timeout.
- [x] 1.2 Реализовать complete catalog, crypto classification/search и историю; проверить
      pagination, aliases, ambiguous name, интервалы и отсутствие синтетических баров; описать API в
      docs.

## 2. Публичный поток

- [x] 2.1 Реализовать protocol/lifecycle; fake socket/clock тестами проверить
      snapshot/delta/confirm, heartbeat, reconnect, старые callbacks, abort/dispose и bounded retry;
      описать ограничения.

## 3. Интеграционные проверки

- [x] 3.1 Прогнать focused tests, strict types/lint/format и OpenSpec; проверить scope diff.

Проверено 26.11.2026: focused Bybit scenarios21/21 входят в полный pnpm check468/468; strict
TypeScript, ESLint/Prettier и OpenSpec26/26 PASS. Новые production-модули до252строк. Реальная
сеть/WS, UI и canonical build не использовались. Package0.3.15 оставлен для общей интеграции; source
inputs foundation дают собственный content buildId, release bump потребуется при публикации.

## Workflow follow-up

- Согласовать общий provider facade и storage identity, затем интегрировать UI/backup/Drive.
- Выполнить отдельный browser smoke после интеграции; архивировать после review.
