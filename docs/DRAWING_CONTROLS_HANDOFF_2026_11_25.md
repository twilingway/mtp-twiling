# Оформление линий и стрелки меню рисунков

Основа: `85c6d55`, ветка `feat/drawing-line-previews`. Изменение предназначено для интеграции после
восстановления версии 0.3.15. Оно не подключает новый CSS к index.html и не меняет версию
приложения.

## Инвентарь

| Место                                                       | Результат                                                                               |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| DrawingStylePopover: обычные линии, линии уровней Фибоначчи | Общий LineStylePicker вместо текстового select                                          |
| DrawingStylePopover: линия тренда Фибоначчи                 | Тот же picker с trendStyle/trendColor/trendWidth/trendOpacity                           |
| DrawingStylePopover: отдельный уровень                      | Существующий выбор цвета; индивидуальный lineStyle в формате уровня отсутствует         |
| DrawingSettingsDialog: кнопки открытия оформления           | SVG текущего стиля вместо фиксированных символов                                        |
| DrawingTemplateMenu                                         | SVG-стрелка, aria-expanded, Escape и закрытие снаружи                                   |
| ContextMenu: порядок слоёв                                  | Общая SVG-стрелка вправо                                                                |
| DrawingToolbarSplit: группы и utility меню                  | Видимая отдельная flex-кнопка 18×36 справа; основной значок сохраняет выбор инструмента |
| DrawingToolbarMenu: подменю и возврат                       | Общие SVG-стрелки вправо/влево                                                          |

За границами задачи остаются glyph-стрелки ClockZoneControl и TimeframeMenu, а также native select в
ChartSettingsDialog, Toolbar, StoragePanel, ChartRangeControl и текстовых параметрах
DrawingSettingsDialog. Их общий внешний вид согласует координатор. Других списков
lineStyle/trendStyle в `src/screens` на этой основе нет.

## Общие компоненты

Расположение: `src/screens/terminal/drawings/controls/`.

- `ChevronIcon({ direction?: "down" | "right" | "left", className?: string })`: SVG 16×16, stroke
  1.5, без шрифтового символа. Непосредственная стрелка вниз поворачивается по aria-expanded
  родителя.
- `LineStylePreview({ value: LineStyle, color?: string, opacity?: number, width?: number })`:
  образец 64×16, solid без dash, dashed 6/4, dotted 2/3 — как в canvas renderer.
- `LineStylePicker({ value, onChange, label, name?, color?, opacity?, width?, disabled? })`: тот же
  существующий строковый LineStyle; доступная combobox-кнопка с portal listbox. Фокус остаётся на
  кнопке. ArrowUp/Down/Home/End меняют активный вариант, Enter/Space подтверждают; Escape/Tab
  закрывают без подтверждения. Escape отменяет native modal cancel до его выполнения.
- `DrawingLineControls({ settings: ResolvedDrawingStyle, trend?: boolean, onOpen: (target: ColorTarget) => void })`:
  пара цвет/образец для окна, без записи состояния.

Portal помещается в ближайший native dialog, иначе в body. Экран под списком поглощает указатель и
закрывает список кликом снаружи. Форма, шаблоны, «ОК»/«Отмена», координаты, backup и математика не
меняются.

## Интеграция и проверки

Координатор подключает `public/drawing-controls.css` после существующих стилей. Отдельная сборка не
является визуальной приёмкой.

В своём worktree прошли format, lint, strict typecheck и build, spec:validate 26/26 и focused
drawing/toolbar/editing/locale tests 39/39. Полный check на основе `85c6d55`: 441/451; 9 ошибок
camera-intent mocks без auth.suspend и 1 ошибка drive-coordinator mock без controller.sessionKey.
Эти файлы не входят в drawing diff; исправления уже находятся у координатора в ветке 0.3.15. Логи
остаются локально: drawing-focused.log, baseline-camera-intent.log, drawing-full-test.log.

Focused tests:
`node --test test/drawing-controls.test.mjs test/drawing-toolbar.test.mjs test/locale-interface.test.mjs`.
При sandbox `spawn EPERM` на Node 22 можно выполнить с `--experimental-test-isolation=none`; штатный
полный check следует повторить в разрешённом окружении.

Нужен браузерный smoke общей сборки: Фибоначчи/обычная линия, список внутри native modal и у края
экрана, текущий образец после выбора, полузаполненные поля + Escape/«Отмена»/«ОК», outside click без
действия графика, стрелки групп и сохранённые инструменты на desktop и узком экране. Проверить
dark/light и отсутствие наложения стрелки на основной значок/горизонтальной прокрутки левой панели.
