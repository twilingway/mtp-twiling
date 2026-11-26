# Tasks

## 1. Reader boundary

- [x] 1.1 Добавить проверку payload/immutable identity в coordinator и standalone publish/resolve;
      проверить same-head, conflict и race сценарии source tests.
- [x] 1.2 Документировать network cost, immutable boundary и ограничения CAS в
      docs/DRIVE_READER_GUARD.md.

## 2. Local association and errors

- [x] 2.1 Отклонять существующую неизвестную association до fallback writes; проверить bytes и
      actual loader/store.
- [x] 2.2 Добавить unsupported-format pause и actionable RU/EN текст; проверить
      restore/connect/autodebounce без Google.

## 3. Integration verification

- [x] 3.1 Выполнить scoped и существующие Drive tests, whole-source strict virtual host, lint/format
      и spec validation; зафиксировать результаты в документе.
- [x] 3.2 Зафиксировать clean frozen commit для независимого root review; не запускать
      build/version/browser.

## Workflow follow-up

- Архивировать после независимого review и принятия root.
