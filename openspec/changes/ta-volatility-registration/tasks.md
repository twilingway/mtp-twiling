# Tasks

## 1. Контракт и регистрация

- [x] 1.1 Согласовать явный TechnicalCalculationContext HV с координатором; записать контракт.
- [x] 1.2 Зарегистрировать восемь definitions/public ID, три BBW outputs, params и history.
- [x] 1.3 Добавить golden/context/bounds/old-default/JSON тесты и документ интеграционной границы.

## 2. Проверки source пакета

- [x] 2.1 Выполнить focused tests, TypeScript, scoped lint/format и strict OpenSpec validation.
- [x] 2.2 Проверить ownership diff и создать отдельный source commit после math commit.

## Workflow follow-up

- [x] Координатор передаёт явный timeframe context через TechnicalRenderData обоим renderers;
      проверены все29 definitions и соотношение дневного/недельного HV в actual adapter fixtures.
- [x] Координатор расширил Drive allowlist ровно тремя ключами и проверил полный JSON/Drive v2
      roundtrip нестандартных BBW/UO/HV параметров вместе с provider identity и старыми данными.
- [ ] Независимая browser QA общей версии0.3.19 с29 вычислениями и разделами списка котировок.

- Координатор подключает явный HV context к обоим renderers и проверяет native поведение.
- Координатор добавляет expansionLength/contractionLength/middleLength в Drive allowlist и проверяет
  roundtrip всех восьми shapes.
- Архивировать change после интеграционной приёмки.
