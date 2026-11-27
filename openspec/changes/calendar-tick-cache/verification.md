# Verification

## Source checks

- Изолированная реализация от d7c2b11: один pure cache и один calendar binding на adapter.
- lightweight.ts сокращён с 502 до 452 строк; новые production-файлы меньше 500 строк.
- Исходный axis-ticks.ts, i18n, OHLC, SMA/MTP и node_modules не изменены.

## Tests

`node --test --experimental-test-isolation=none test/calendar-tick-cache.test.mjs test/calendar-timezone-grid.test.mjs test/future-calendar-axis.test.mjs test/native-chart-type-adapters.test.mjs`

Прошли 39 тестов. Новые проверки подтверждают: точное равенство исходному алгоритму на DST,
Kathmandu, D/W/M и будущих позициях; единичный расчёт grid+axis для 15094 баров; повторный paint
после очистки при Y/height/DPR без обхода дат; точные fractional ключи; временная инвалидация
реального adapter; запрет восстановления кеша устаревшими views после dispose.

TypeScript `tsc --noEmit`, ESLint четырёх затронутых production-модулей, Prettier и строгая OpenSpec
validation этого change прошли. Generated app-version подготовлен координатором.

## Remaining validation

Общая сборка, независимое ревью, интеграция и телефонный A/B остаются координатору. Измерено только
исходное время calendarAxisTicks: 200,38 мс inclusive за профиль 3,12 с. Ускорение приложения этим
изменением пока не измерено; редкий пик 1,15 с этим профилем не объясняется. Новый браузерный сеанс,
сервер, публикация и изменение пользовательских данных не выполнялись.
