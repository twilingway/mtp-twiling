# Tasks

## 1. Измерение и контракт

- [x] 1.1 Проверить исходные close/revision и снять offline empty benchmark с count и CPU.
- [x] 1.2 Зафиксировать design, границы, инвалидацию и проверяемые сценарии в OpenSpec.

## 2. Реализация

- [x] 2.1 Добавить empty fast paths и проверить нулевые операции и повторное включение тестом.
- [x] 2.2 Расширить eligibility/coverage и проверить pan/Y hit, settled paths и clipped edges.
- [x] 2.3 Проверить mode/style/DPR/append/reset/cap регрессии существующими тестами.

## 3. Интеграция

- [x] 3.1 Выполнить scoped TypeScript/ESLint/Prettier, MTP tests и strict OpenSpec validation.
- [x] 3.2 Записать before/after CPU, геометрические доказательства и ограничения в verification.md.

## Workflow follow-up

- Координатор выполняет физическую Android проверку и независимое ревью перед архивированием.

## 4. Соседние viewport

- [x] 4.1 Локализовать domain ordinary захвата, проверить отсутствие чтения дальних bounds и SMA
      warmup.
- [x] 4.2 До empty coverage проверять logical indices; регрессия с видимым MTP нового viewport
      проходит.
- [x] 4.3 Добавить бюджетный X reserve до одного экрана/сторону без уменьшения Y и проверить 16 MiB.
- [x] 4.4 Сохранить covered слой после settle; проверить inside/outside pan, thick native joins и
      tail.
- [x] 4.5 Выполнить scoped TypeScript/ESLint/Prettier, MTP tests, strict OpenSpec и записать
      follow-up.
