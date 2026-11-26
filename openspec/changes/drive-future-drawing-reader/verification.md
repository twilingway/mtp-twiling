# Проверка

## Срез и границы

Отдельный worktree `vps/artifacts/drive-future-drawing-reader`, ветка
`fix/drive-future-drawing-reader`, база `74abb23fa94defe7a8fbe090cb546ccf42224632`. Замороженная
.24, canonical worktree и public не менялись этой задачей. Единственный изменённый production файл —
`src/services/drive/reader-guard.ts`; тест и OpenSpec принадлежат этой ветке. Новых типов рисунков,
writer/schema, миграций и generated version файлов нет.

## Наблюдаемое поведение

- Используется общий `TOOL_NAMES`, а не новый список типов.
- Неизвестная строка в настоящем поле `drawings[].items[].name` даёт `unsupported-format` до
  allowlist projection. Порядок, известные соседи и исходный вход сохранены.
- Известные8 типов и historical fixtures принимаются с прежней проекцией. Нестроковое имя, неверные
  точки и настройки известного типа остаются `remote-invalid`.
- Собственные дескрипторы `drawings`, group index, `items`, item index и `name` проверены: getter не
  исполняются. Sparse array проверяется по существующим индексам, без перебора длины.
- Actual Drive download, same-head clean/dirty и publish поверх future parent останавливаются без
  upload, checkpoint, редактирования или DB записи. Raw manual import по-прежнему выдаёт обычную
  validation Error до editing.flush: его классификация этой задачей не меняется.
- Actual DriveAuth/AES vault использует существующую unsupported паузу: auth handles прекращаются,
  ciphertext, generation, исходный expiresAt и запись другого владельца сохраняются; revoke,
  удаление credential и upload отсутствуют. Последующий restore ещё действующего credential работает
  без GIS и без продления срока.

## Проверки

23 новых сценария и134 существующих: **157/157 PASS**:

```powershell
node --test --experimental-test-isolation=none test/drive-future-drawing-reader.test.mjs test/drive-reader-guard.test.mjs test/drive-reader-auth-pause.test.mjs test/drive-sync.test.mjs test/drive-coordinator.test.mjs test/drive-auth-persistence.test.mjs
```

Лог: `vps/artifacts/drive-future-drawing-reader-tests.tap`.

- Strict TypeScript PASS: compiler host предоставляет только виртуальные exports `APP_VERSION` и
  `BUILD_ID`; generated module на диск не записывался. Обычный прямой tsc сначала сообщил только о
  двух отсутствующих generated imports в чистом worktree; конфигурация строгости не менялась.
- Scoped ESLint production файла, Prettier source/test/OpenSpec и `git diff --check`: PASS.
- `node scripts/spec.mjs validate --all --strict`: **59/59 PASS**.
- Исторический reader из git object `62a1a36f2409911f6bdb029f37e0bfe14e852489` проверен тем же valid
  legacy fixture с заменённым именем: старый код `remote-invalid`, новый `unsupported-format`; input
  неизменён. Git ancestor62a→74abb подтверждён. Артефакты
  `vps/artifacts/drive-future-drawing-reader-checks.mjs` / `.json`.
- Исходный аудит `.23` `vps/artifacts/tv-parity-drawing-forwardguard-0323.mjs` / `.json` сохранён
  без изменения прежнего ожидания `remote-invalid`.

Fetch запрещён новыми тестами; реальный Google/банк/браузер/изображения не использовались. Новая
сборка, изменение package/version и публикация не выполнялись. Независимое review, интеграция и
архивирование остаются координатору.
