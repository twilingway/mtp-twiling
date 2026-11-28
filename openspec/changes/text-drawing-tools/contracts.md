# Frozen contract

Контракт передачи core, renderer и UI зафиксирован 2026-11-28. Этот файл описывает внутренний API;
наблюдаемое поведение находится в `specs/text-annotations/spec.md`. Production-файлы принадлежат
назначенным исполнителям; изменения контракта согласуются до изменения зависимых модулей.

## Data

```ts
type TextDrawingTool =
  | "text"
  | "note"
  | "priceNote"
  | "pin"
  | "table"
  | "callout"
  | "comment"
  | "priceLabel"
  | "signpost"
  | "flag";

interface DrawingAnnotationSettings {
  bold?: boolean;
  italic?: boolean;
  backgroundColor?: string;
  backgroundOpacity?: number;
  borderColor?: string;
  borderOpacity?: number;
  borderWidth?: number;
  borderStyle?: "solid" | "dashed" | "dotted";
  wrap?: boolean;
  width?: number;
  height?: number;
  offsetX?: number;
  offsetY?: number;
  screenAnchored?: boolean;
  screenX?: number;
  screenY?: number;
  table?: {
    cells: string[][];
    columnWidths?: number[];
    rowHeights?: number[];
  };
}
```

`DrawingSettings.annotation?: DrawingAnnotationSettings` — единственное новое контейнерное поле.
`settings.text` — canonical multiline content, включая переносы строк. Шрифт и цвет используют
прежние `fontSize`, `textColor`, `textAlign`, `textVertical`; стиль линии/соединителя — `color`,
`width`, `lineStyle`, `lineOpacity`. Табличные ячейки хранятся только в `annotation.table.cells`, не
кодируются TSV/HTML/JSON внутри `text`. Автоматическая цена вычисляется из `points[0].value`; она не
подменяет пользовательское содержание и не зависит от текущей котировки.

Цвета проходят прежний color validator. Opacity — конечные числа 0..1; borderWidth — 0..5; width —
24..1600 CSS px, height — 16..1200 CSS px; offsetX/Y — -4000..4000 CSS px. ScreenX/Y —
нормализованные 0..1 координаты plot без осей. FontSize сохраняет прежний диапазон 1..100. Текст —
максимум 10000 UTF-16 code units. Таблица — непустая прямоугольная матрица до 20x20, до 2000 code
units на ячейку и 20000 суммарно. Пустые ячейки допустимы. Validator не выполняет truncate и не
меняет пользовательское содержание при чтении.

`columnWidths` и `rowHeights`, если заданы, имеют длины по числу столбцов и строк; конечные значения
столбцов >=24, строк >=16, суммы <=1600 и <=1200 соответственно. Они сохраняют размеры отдельных
полос после перетаскивания границ. Явные annotation.width/height распределяют итоговый размер
пропорционально сохранённым размерам полос.

## Anchors

| Tool       | DrawingPoint count | Placement                                           |
| ---------- | ------------------ | --------------------------------------------------- |
| text       | 1                  | Начало блока текста                                 |
| note       | 2                  | Привязка + положение блока с соединителем           |
| priceNote  | 2                  | Ценовая привязка + положение блока                  |
| pin        | 1                  | Булавка; текст при наведении или выборе             |
| table      | 1                  | Блок; опциональная экранная привязка                |
| callout    | 2                  | Указатель + положение блока                         |
| comment    | 1                  | Блок комментария с указателем                       |
| priceLabel | 1                  | Автоматическая цена якоря                           |
| signpost   | 1                  | Одно нажатие + inline editor, offset блока          |
| flag       | 1                  | Привязка к данным, маркер фиксированного px размера |

Все points остаются timestamp/value. При screenAnchored=true проекция блока использует screenX/Y, а
point сохраняется для обратного переключения. Переключение table binding сохраняет положение
видимого блока и вычисляет новое представление. Signpost создаётся одним нажатием с inline editor;
дальнейшее движение его layout handle меняет offsetX/Y без второго DrawingPoint. Flag по умолчанию
привязан к данным; фиксированный размер маркера в CSS px не означает фиксированное положение в
viewport. Font, padding и размеры блока остаются CSS px при zoom/DPR.

## Boundaries

- Core: новые типы, TOOL_NAMES/defaults/policy, строгая проверка annotation и nested table,
  clipboard allowlist, backup/cloud projection; чистая раскладка и hit regions.
- Renderer: единая раскладка для paint и hit; передаёт измерения текста одинаковым способом.
  Реальная Canvas-метрика допустима через injected provider, DOM/Canvas не импортируются в core.
  Layout возвращает рамки строк/ячеек, соединитель, символ и targets выбора.
- UI: textarea/table editor, field limits, создание/изменение scoped draft; Save — одна запись,
  Cancel — ноль. Ввод текста не запускает глобальные команды графика.
- Controller: draft привязан к owner, instrument, engine, timeframe, chart revision и object id;
  stale callback не коммитит. Portable selectors читают только committed drawings.

Core публикует следующие интерфейсы в `drawing-annotation-layout.ts`:

```ts
interface AnnotationFont {
  size: number;
  bold: boolean;
  italic: boolean;
}
type AnnotationMeasure = (text: string, font: AnnotationFont) => number;
interface AnnotationBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
interface AnnotationTextLine {
  x: number;
  y: number;
  text: string;
  align: "left" | "center" | "right";
  maxWidth: number;
}
interface AnnotationCell {
  bounds: AnnotationBounds;
  row: number;
  column: number;
  text: AnnotationTextLine[];
}
interface AnnotationLayout {
  kind: TextDrawingTool;
  bounds: AnnotationBounds;
  body: AnnotationBounds | null;
  marker: AnnotationBounds | null;
  leader: [PixelPoint, PixelPoint] | null;
  text: AnnotationTextLine[];
  cells: AnnotationCell[];
  font: AnnotationFont;
  background: boolean;
  anchor: PixelPoint;
  outline: PixelPoint[] | null;
  price: {
    bounds: AnnotationBounds;
    text: AnnotationTextLine[];
    font: AnnotationFont;
  } | null;
  handles: { index: number; point: PixelPoint }[];
}
interface AnnotationLayoutOptions {
  selected?: boolean;
  hovered?: boolean;
  measureText?: AnnotationMeasure;
  formatPrice?: (value: number) => string;
}
declare function annotationLayout(
  drawing: DrawingDraft,
  projected: readonly PixelPoint[],
  width: number,
  height: number,
  options?: AnnotationLayoutOptions
): AnnotationLayout | null;
```

`TextDrawingTool` в production именуется `AnnotationTool`. `drawingGeometry` получает
AnnotationLayoutOptions; `hitDrawing` — те же options без selected плюс selectedId?/hoveredId?.
Hover/selection определяют раскрытие pin. Один и тот же measureText/formatPrice передаётся paint и
hit; outline — общий polygon для callout/comment/priceLabel, включая хвост; price — отдельный
автоблок priceNote (12px), text — его независимая caption (14px default). Bounds охватывает оба.

Layout handles: index0 — data anchor; table index1 — bottom-right frame resize, index100+column —
граница после столбца, index200+row — граница после строки; signpost index1 — центр блока для
изменения offsets. Это layout handles, не дополнительные persisted DrawingPoints. Нельзя независимо
рассчитывать text bounds или polygon в paint и hit.

## Compatibility

Новые поля разрешены новым tool names; старые геометрические подписи не переинтерпретируются. Старые
рисунки без annotation сохраняют прежнее поведение. Все новые tool names входят в общую
capability-проверку cloud reader до проекции; reader, не знающий инструмент, приостанавливает
неподдерживаемое чтение без перезаписи данных. IDB, clone, undo, clipboard, JSON и cloud сохраняют
annotation целиком. Никакие computed price strings, preview или Canvas metrics не сохраняются.
