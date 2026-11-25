# Tasks

## 1. Контракт и регистрация

- [x] 1.1 Согласовать явный TechnicalCalculationContext HV с координатором; записать контракт.
- [x] 1.2 Зарегистрировать восемь definitions/public ID, три BBW outputs, params и history.
- [x] 1.3 Добавить golden/context/bounds/old-default/JSON тесты и документ интеграционной границы.

## 2. Проверки source пакета

- [x] 2.1 Выполнить focused tests, TypeScript, scoped lint/format и strict OpenSpec validation.
- [x] 2.2 Проверить ownership diff и создать отдельный source commit после math commit.

## Workflow follow-up

- Координатор подключает явный HV context к обоим renderers и проверяет native поведение.
- Координатор добавляет expansionLength/contractionLength/middleLength в Drive allowlist и проверяет
  roundtrip всех восьми shapes.
- Архивировать change после интеграционной приёмки.
