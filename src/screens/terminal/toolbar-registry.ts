import type { DrawingTool } from "../../model/types.js";
import type { DrawingCursor, DrawingTarget } from "../../model/drawing-toolbar.js";
import type { DrawingIconName } from "./DrawingToolIcon.js";

export type ToolbarGroupId =
  "cursors" | "lines" | "fib" | "patterns" | "forecast" | "shapes" | "annotation" | "symbols";
export interface ToolbarTool {
  id: string;
  referenceId: string;
  label: string;
  icon: DrawingIconName;
  tool?: DrawingTool;
  cursor?: DrawingCursor;
  image?: boolean;
  shortcut?: string;
}
export interface ToolbarSection {
  title: string | null;
  items: ToolbarTool[];
}
export interface ToolbarGroup {
  id: ToolbarGroupId;
  title: string;
  sections: ToolbarSection[];
}
export const TOOLBAR_TARGETS: DrawingTarget[] = ["drawings", "indicators", "all"];
export const TARGET_NAMES: Record<DrawingTarget, string> = {
  drawings: "объекты рисования",
  indicators: "индикаторы",
  all: "всё"
};

const capabilities: Record<string, Partial<ToolbarTool>> = {
  cursor: { cursor: "crosshair", icon: "crosshair" },
  dot: { cursor: "dot", icon: "dot" },
  arrow: { cursor: "arrow", icon: "arrowCursor" },
  demonstration: { cursor: "demonstration", icon: "demonstration" },
  eraser: { cursor: "eraser", icon: "eraser" },
  LineToolTrendLine: { tool: "segment", icon: "trend", shortcut: "Alt+T" },
  LineToolRay: { tool: "rayLine", icon: "ray" },
  LineToolExtended: { tool: "straightLine", icon: "extended" },
  LineToolHorzLine: { tool: "horizontalStraightLine", icon: "horizontal" },
  LineToolHorzRay: { tool: "horizontalRayLine", icon: "horizontalRay" },
  LineToolVertLine: { tool: "verticalStraightLine", icon: "vertical" },
  LineToolRectangle: { tool: "rectangle", icon: "rectangle" },
  LineToolFibRetracement: { tool: "fibonacciLine", icon: "fibonacci", shortcut: "Alt+F" },
  LineToolTrendBasedFibExtension: { tool: "fibonacciExtension", icon: "fibExtension" },
  LineToolImage: { image: true, icon: "image" }
};
const variants: Record<string, DrawingIconName> = {
  LineToolInfoLine: "infoLine",
  LineToolTrendAngle: "angle",
  LineToolCrossLine: "crosshair",
  LineToolRegressionTrend: "regression",
  LineToolFlatBottom: "flatChannel",
  LineToolDisjointAngle: "angleChannel",
  LineToolFibChannel: "channel",
  LineToolFibTimeZone: "timeZones",
  LineToolFibSpeedResistanceFan: "fan",
  LineToolTrendBasedFibTime: "timeZones",
  LineToolFibCircles: "circles",
  LineToolFibSpiral: "spiral",
  LineToolFibSpeedResistanceArcs: "arc",
  LineToolFibWedge: "wedge",
  LineToolPitchfan: "fan",
  LineToolGannFan: "fan",
  LineToolGannFixed: "grid",
  LineToolGannComplex: "grid",
  LineToolHeadAndShoulders: "wave",
  LineToolTrianglePattern: "triangle",
  LineToolThreeDrivers: "wave",
  LineToolElliottImpulse: "wave",
  LineToolElliottCorrection: "wave",
  LineToolElliottTriangle: "triangle",
  LineToolElliottDoubleCombo: "wave",
  LineToolElliottTripleCombo: "wave",
  LineToolCircleLines: "timeZones",
  LineToolTimeCycles: "cycles",
  LineToolSineLine: "sine",
  LineToolBarsPattern: "bars",
  LineToolGhostFeed: "bars",
  LineToolProjection: "wedge",
  LineToolRiskRewardShort: "shortPosition",
  LineToolPrediction: "wave",
  LineToolAnchoredVolumeProfile: "volumeProfile",
  LineToolFixedRangeVolumeProfile: "volumeProfile",
  LineToolPriceRange: "priceRange",
  LineToolDateRange: "dateRange",
  LineToolDateAndPriceRange: "range",
  LineToolHighlighter: "highlighter",
  LineToolArrow: "arrowLine",
  LineToolArrowMarker: "arrowLine",
  LineToolArrowMarkUp: "arrowUp",
  LineToolArrowMarkDown: "arrowDown",
  LineToolRotatedRectangle: "rotatedRectangle",
  LineToolCircle: "circle",
  LineToolEllipse: "ellipse",
  LineToolPath: "path",
  LineToolPolyline: "path",
  LineToolTriangle: "triangle",
  LineToolArc: "arc",
  LineToolBezierQuadro: "curve",
  LineToolBezierCubic: "doubleCurve",
  LineToolTextNote: "note",
  LineToolPriceNote: "priceNote",
  LineToolNote: "label",
  LineToolTable: "grid",
  LineToolCallout: "callout",
  LineToolComment: "comment",
  LineToolPriceLabel: "priceNote",
  LineToolSignpost: "signpost",
  LineToolFlagMark: "flag",
  LineToolTweet: "post",
  LineToolIdea: "idea"
};
function section(
  title: string | null,
  icon: DrawingIconName,
  rows: [string, string][]
): ToolbarSection {
  return {
    title,
    items: rows.map(([referenceId, label]) => {
      const capability = capabilities[referenceId];
      return {
        id: capability?.tool ?? capability?.cursor ?? referenceId,
        referenceId,
        label,
        icon: variants[referenceId] ?? icon,
        ...capability
      };
    })
  };
}

// Labels and ordering follow the reference inventory; artwork is independently authored.
export const TOOLBAR_GROUPS: ToolbarGroup[] = [
  {
    id: "cursors",
    title: "Курсоры",
    sections: [
      section(null, "crosshair", [
        ["cursor", "Перекрестие"],
        ["dot", "Точка"],
        ["arrow", "Стрелка"],
        ["demonstration", "Демонстрация"]
      ]),
      section(null, "eraser", [["eraser", "Ластик"]])
    ]
  },
  {
    id: "lines",
    title: "Линии тренда",
    sections: [
      section("Линии", "trend", [
        ["LineToolTrendLine", "Линия тренда"],
        ["LineToolRay", "Луч"],
        ["LineToolInfoLine", "Линия данных"],
        ["LineToolExtended", "Удлинённая линия"],
        ["LineToolTrendAngle", "Угол тренда"],
        ["LineToolHorzLine", "Горизонтальная линия"],
        ["LineToolHorzRay", "Горизонтальный луч"],
        ["LineToolVertLine", "Вертикальная линия"],
        ["LineToolCrossLine", "Перекрещенные линии"]
      ]),
      section("Каналы", "channel", [
        ["LineToolParallelChannel", "Параллельный канал"],
        ["LineToolRegressionTrend", "Регрессионный тренд"],
        ["LineToolFlatBottom", "Плоский верх/низ"],
        ["LineToolDisjointAngle", "Расходящийся канал"]
      ]),
      section("Вилы", "pitchfork", [
        ["LineToolPitchfork", "Вилы"],
        ["LineToolSchiffPitchfork2", "Вилы Шифа"],
        ["LineToolSchiffPitchfork", "Видоизмененные вилы Шифа"],
        ["LineToolInsidePitchfork", "Вилы (внутрь)"]
      ])
    ]
  },
  {
    id: "fib",
    title: "Инструменты Ганна и Фибоначчи",
    sections: [
      section("Фибоначчи", "fibonacci", [
        ["LineToolFibRetracement", "Коррекция Фибоначчи"],
        ["LineToolTrendBasedFibExtension", "Расширение Фибоначчи по тренду"],
        ["LineToolFibChannel", "Каналы Фибоначчи"],
        ["LineToolFibTimeZone", "Периоды времени Фибоначчи"],
        ["LineToolFibSpeedResistanceFan", "Веерные линии сопротивления Фибоначчи"],
        ["LineToolTrendBasedFibTime", "Периоды Фибоначчи по тренду"],
        ["LineToolFibCircles", "Окружности Фибоначчи"],
        ["LineToolFibSpiral", "Спираль Фибоначчи"],
        ["LineToolFibSpeedResistanceArcs", "Дуги сопротивления Фибоначчи"],
        ["LineToolFibWedge", "Клин Фибоначчи"],
        ["LineToolPitchfan", "Наклонный веер"]
      ]),
      section("Ганн", "grid", [
        ["LineToolGannSquare", "Коробка Ганна"],
        ["LineToolGannFixed", "Фиксированный Квадрат Ганна"],
        ["LineToolGannComplex", "Квадрат Ганна"],
        ["LineToolGannFan", "Веер Ганна"]
      ])
    ]
  },
  {
    id: "patterns",
    title: "Паттерны",
    sections: [
      section("Графические паттерны", "patterns", [
        ["LineTool5PointsPattern", "Паттерн XABCD"],
        ["LineToolCypherPattern", "Паттерн Cypher"],
        ["LineToolHeadAndShoulders", "Голова и плечи"],
        ["LineToolABCD", "Паттерн ABCD"],
        ["LineToolTrianglePattern", "Паттерн треугольник"],
        ["LineToolThreeDrivers", "Паттерн трёх движений"]
      ]),
      section("Волны Эллиотта", "wave", [
        ["LineToolElliottImpulse", "Импульсная волна Эллиотта (1·2·3·4·5)"],
        ["LineToolElliottCorrection", "Коррекционная волна Эллиотта (A·B·C)"],
        ["LineToolElliottTriangle", "Треугольник в волнах Эллиотта (A·B·C·D·E)"],
        ["LineToolElliottDoubleCombo", "Двойная комбинация Эллиотта (W·X·Y)"],
        ["LineToolElliottTripleCombo", "Тройная комбинация Эллиотта (W·X·Y·X·Z)"]
      ]),
      section("Циклический анализ", "cycles", [
        ["LineToolCircleLines", "Разделение циклов"],
        ["LineToolTimeCycles", "Циклы времени"],
        ["LineToolSineLine", "Синусоида"]
      ])
    ]
  },
  {
    id: "forecast",
    title: "Инструменты для измерения и прогнозирования",
    sections: [
      section("Прогноз", "forecast", [
        ["LineToolRiskRewardLong", "Длинная позиция"],
        ["LineToolRiskRewardShort", "Короткая позиция"],
        ["LineToolPrediction", "Прогноз позиции"],
        ["LineToolBarsPattern", "Шаблон баров"],
        ["LineToolGhostFeed", "Проекция цены"],
        ["LineToolProjection", "Сектор"]
      ]),
      section("На основе объёма", "anchoredVwap", [
        ["LineToolAnchoredVWAP", "Взвешенная по объёму средняя цена с привязкой"],
        ["LineToolFixedRangeVolumeProfile", "Профиль объёма в заданном диапазоне"],
        ["LineToolAnchoredVolumeProfile", "Профиль объёма с привязкой"]
      ]),
      section("Диапазоны", "range", [
        ["LineToolPriceRange", "Диапазон цены"],
        ["LineToolDateRange", "Диапазон времени"],
        ["LineToolDateAndPriceRange", "Диапазон цены и времени"]
      ])
    ]
  },
  {
    id: "shapes",
    title: "Геометрические фигуры",
    sections: [
      section("Кисти", "brush", [
        ["LineToolBrush", "Кисть"],
        ["LineToolHighlighter", "Маркер"]
      ]),
      section("Стрелки", "arrowLine", [
        ["LineToolArrowMarker", "Стрелка-указатель"],
        ["LineToolArrow", "Стрелка"],
        ["LineToolArrowMarkUp", "Стрелка вверх"],
        ["LineToolArrowMarkDown", "Стрелка вниз"]
      ]),
      section("Фигуры", "rectangle", [
        ["LineToolRectangle", "Прямоугольник"],
        ["LineToolRotatedRectangle", "Вращающийся прямоугольник"],
        ["LineToolPath", "Траектория"],
        ["LineToolCircle", "Окружность"],
        ["LineToolEllipse", "Эллипс"],
        ["LineToolPolyline", "Ломаная линия"],
        ["LineToolTriangle", "Треугольник"],
        ["LineToolArc", "Дуга"],
        ["LineToolBezierQuadro", "Кривая"],
        ["LineToolBezierCubic", "Двойная кривая"]
      ])
    ]
  },
  {
    id: "annotation",
    title: "Инструменты комментирования",
    sections: [
      section("Текст и заметки", "text", [
        ["LineToolText", "Текст"],
        ["LineToolTextNote", "Заметка"],
        ["LineToolPriceNote", "Заметка цены"],
        ["LineToolNote", "Метка"],
        ["LineToolTable", "Таблица"],
        ["LineToolCallout", "Сноска"],
        ["LineToolComment", "Комментарий"],
        ["LineToolPriceLabel", "Метка цены"],
        ["LineToolSignpost", "Знак"],
        ["LineToolFlagMark", "Флаг"]
      ]),
      section("Контент", "post", [
        ["LineToolImage", "Изображение"],
        ["LineToolTweet", "Пост"],
        ["LineToolIdea", "Идея"]
      ])
    ]
  },
  {
    id: "symbols",
    title: "Иконки",
    sections: [
      section(null, "symbols", [
        ["LineToolEmoji", "Эмодзи"],
        ["LineToolSticker", "Стикер"],
        ["LineToolIcon", "Значок"]
      ])
    ]
  }
];
export const PALETTE_CATEGORIES = [
  [
    "Эмодзи",
    "недавние",
    "эмоции и люди",
    "животные и природа",
    "еда и напитки",
    "спорт и активность",
    "путешествия",
    "предметы",
    "символы",
    "флаги"
  ],
  ["Стикеры", "недавние", "TradingView"],
  [
    "Иконки",
    "недавние",
    "жесты и эмоции",
    "символы и флаги",
    "природа",
    "валюты",
    "предметы",
    "стрелки"
  ]
];
export const toolbarToolAvailable = (item: ToolbarTool): boolean =>
  Boolean(item.tool || item.cursor || item.image);
export function rememberedToolbarTool(
  group: ToolbarGroup,
  lastTools: Record<string, string>
): ToolbarTool {
  const items = group.sections.flatMap((part) => part.items);
  return (
    items.find((item) => item.id === lastTools[group.id]) ??
    items.find(toolbarToolAvailable) ??
    items[0]!
  );
}
