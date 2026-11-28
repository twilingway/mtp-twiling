# Tasks

## 1. Core и перенос

- [ ] 1.1 Добавить десять типов, defaults и политику якорей по contracts.md; source unit проверяет
      point counts, signpost offsets, table binding и прежние defaults.
- [ ] 1.2 Добавить строгую annotation/table валидацию и clipboard/backup/cloud перенос; source unit
      проверяет round-trip, пустые ячейки, размеры полос и атомарное отклонение неверных данных.
- [ ] 1.3 Реализовать pure annotation layout и hit regions с injected measurement/price formatter;
      source unit проверяет multiline, wrap, скрытый pin, price anchor и границы таблицы.

## 2. Renderer и каталог

- [ ] 2.1 Отрисовать десять средств из общего layout и включить каталог; source unit проверяет
      реальные capability bindings, defaults и одинаковый provider paint/hit.
- [ ] 2.2 Подключить selection, auto-price и общий hit-test к обоим SDK; source unit проверяет цену
      первого якоря и выбор блока/соединителя, интегратор проверяет визуально оба SDK.

## 3. Editor и input

- [ ] 3.1 Добавить multiline editor и применимые style controls, pin/flag поведение; source unit
      проверяет field limits и keyboard ownership, browser smoke — фактический ввод.
- [ ] 3.2 Добавить table cell editor, insert/delete и resize общей рамки/полос; source unit
      проверяет rectangular invariant и лимиты, browser smoke — сохранение пустых ячеек и размеров.
- [ ] 3.3 Добавить creation draft, signpost one-click с screen offset handle и table binding
      conversion; source unit проверяет Save одной операцией, Cancel без записи и неизменное
      положение при binding toggle.
- [ ] 3.4 Связать edit preview с owner/instrument/engine/timeframe/revision и импортом; source unit
      проверяет stale Save, portable committed-only selectors, undo/redo и отсутствие перехвата
      ввода.

## 4. Интеграция

- [ ] 4.1 Интегратор выполняет pnpm check и pnpm spec:validate, независимый reviewer проверяет
      pure-core границы и перенос; результаты фиксируются в verification.md.
- [ ] 4.2 Изолированный visual агент проверяет все десять средств, оба SDK, zoom, touch, таблицу,
      cancel и полный перенос; передаёт текстовый вердикт и пути к артефактам в verification.md.

## Workflow follow-up

- Архивировать изменение после приёмки реализации и интеграционных проверок.
