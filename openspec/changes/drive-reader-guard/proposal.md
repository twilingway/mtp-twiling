## Why

Текущий reader принимает совпавший head без чтения payload и может записать староформатного потомка
неизвестного снимка. Неизвестная локальная association заменяется значениями по умолчанию. Это
нарушает сохранность данных при несовместимом формате.

## What Changes

- Проверять payload актуальных heads перед accept/import/upload, включая same-head и standalone
  publish/resolve.
- Сверять immutable identity снимков после асинхронного чтения и перед публикацией.
- Сохранять неизвестную association без fallback writes; показывать отдельную actionable ошибку и
  останавливать автоматические попытки.
- Покрыть настоящие coordinator/store boundaries тестами без Google/fetch.

## Capabilities

### New Capabilities

- `drive-reader-compatibility`: отказ от принятия и публикации неподдерживаемых данных текущим
  reader.

### Modified Capabilities

Нет.

## Impact

Drive reader/coordinator/local loader, узкий error union и RU/EN текст существующей формы. Writer
envelope1/2, TA instance1 и IndexedDB2 остаются прежними. Новые форматы, migration, реальный Google,
build и deployment не входят в задачу.
