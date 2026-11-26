# Сохранение оформления в настройках ТА

Исходная база: `50b5873778fa442fce3266c2f9882a59d231ab38`. Работа выполняется отдельно от frozen
сборки `0.3.22 / 6556aedb0c5b49bb`; новый браузерный прогон и публикация в эту проверку не входят.

## Контракт

- Правка периода или размещения сохраняет точную исходную структуру `styles`: отсутствие поля,
  собственный `undefined`, пустую map, sparse outputs и необязательные поля legacy entries.
- Defaults нужны для заполнения UI. Они не становятся сохранённым ручным стилем без действия
  пользователя над оформлением соответствующего выхода.
- Любой style control материализует полный стиль только своего выхода. Прежние ручные width,
  visibility, opacity и lineStyle этого выхода сохраняются, если пользователь их не меняет.
- Ручной цвет, равный default, остаётся явным. Change → revert также может остаться явной правкой.
- Существующие owner/session/current/import/backup guards продолжают запрещать чужую запись.

## Проверки

`node --test --experimental-test-isolation=none` с файлами:

- `test/technical-settings-style-preservation.test.mjs`: 6 actual-submit tests, включая 14
  period/pane комбинаций, пять style controls и 11 boundary cases.
- `test/technical-state-oscillator-settings.test.mjs` и `test/technical-volume-settings.test.mjs`: 7
  тестов прежних численных/строковых параметров и RU/EN labels.
- `test/technical-indicator-actions.test.mjs` и `test/technical-pane-layout.test.mjs`: 12 тестов
  очереди, панелей, persistence и межпрофильных границ.

Всего25 тестов. Обычный isolated Node test runner получает `spawn EPERM` в sandbox, поэтому
используется поддерживаемый режим `--experimental-test-isolation=none` без дочерних процессов.

Strict TypeScript проверяется через compiler host с единственным виртуальным
`src/generated/app-version.ts`, содержащим базовые `0.3.22 / 6556aedb0c5b49bb`: diagnostics0,
`strict:true`, `allowJs:false`. Файл на диск не записывается. `build`, `prepare-version` и release
assets не запускались; это source-only typecheck, а не проверка новой сборки.

ESLint изменённого production-файла:0 warnings/errors. Prettier изменённых файлов и strict
OpenSpec:48/48 PASS. Новые проверки проходят actual component submit и настоящий validator/actions;
импорт/экспорт формата и renderer-палитры не менялись.
