# Предпросмотр настроек рисунков

База ветки — `07401e1` (source cut 0.3.16). Изменение предназначено для следующей общей интеграции;
сервер, runtime, public/index.html и версия не менялись.

## Контракт

`controller.drawingSettings` предоставляет `begin(id)`, `preview(token, drawing)`, `cancel(token)` и
`commit(token, drawing)`. Draft хранится только в optional `TerminalState.drawingSettingsPreview`.
Scope включает owner, symbol, explicit/resolved UID, engine, timeframe, chartRevision, authenticated
и selected drawing ID. Дополнительно проверяются открытый drawing-settings dialog и ссылка committed
оригинала.

Все preview updates сохраняют идентичность `state.drawings` и самого committed объекта.
`drawingRenderList` подставляет draft исключительно для renderer; его используют
`ChartSurface.visibleDrawings` и `DrawingAxisLabels`. `chart-lifecycle` добавляет transient поле в
зависимости redraw, сохраняя native adapter и camera.

Drive signature/observer, JSON export, IDB и undo продолжают видеть committed рисунки. Экспорт во
время draft не отменяет предпросмотр и не переносит его. При ОК выполняется один `editing.change`,
один persist и одно действие undo/redo. Старый незавершённый gesture отменяется до открытия формы и
повторно проверяется controller API.

Cancel, native dialog Escape/cancel, close и unmount снимают transient без записи.
Owner/symbol/UID/engine/timeframe/revision/import/selected ID/original reference guards очищают
устаревший transient до уведомления слушателей; поздний commit возвращает false. Undo через
controller также снимает preview. Locked объекты сохраняют lock; редактирование стиля остаётся
разрешённым, правила drag не меняются.

## Форма

Style показывает цвет, толщину, LineStylePicker и непрозрачность линии; Fibonacci дополнительно
показывает отдельные trend controls и непрозрачность фона. `OpacityControl` показывает 0–100%,
шахматную подложку и градиент. Ноль означает невидимо, 100% — непрозрачно; хранится прежний диапазон
0–1 без инверсии.

Все существующие поля стиля, уровней, шрифта, координат и видимости проходят через общий draft и
live preview. Применение и сброс шаблона тоже меняют draft. Явные команды сохранения шаблона и
применения по умолчанию используют существующий механизм сохранения шаблонов; они не являются
подтверждением рисунка.

Пустое или невалидное числовое поле становится NaN, не нулём; невалидный кандидат не отправляется
renderer и не подтверждается. Последний валидный preview остаётся видимым до исправления или отмены.
Проверяются диапазоны видимости и реальные границы даты JavaScript. Forms разделены на
Style/Coordinates/Visibility и укладываются в лимит 500 строк.

## CSS и QA

Координатор добавляет после drawing-controls.css и theme.css:

```html
<link rel="stylesheet" href="/drawing-opacity.css" />
```

Focused regression: 112/112 тестов, включая семь новых тестов с циклами по всем восьми инструментам,
actual controller, manual/Drive export, observer isolation, cancel/scope, existing gesture, один
undo/redo, form handlers и opacity. Typecheck, lint, format и OpenSpec validation выполняются в
worktree. Production build и визуальный smoke остаются общей интеграции.

Для браузерной проверки: каждый инструмент, линия/trend/background opacity 0/37/100%,
width/style/color, уровни/шрифт, координаты, видимость, применение шаблона, Cancel/Escape и
ОК→undo/redo на обоих движках. Проверить desktop/mobile и обе темы; CSS specificity защищает
градиент от общего theme range background.
