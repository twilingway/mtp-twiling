import { useRef, useState } from "react";
import type { DrawingTool } from "../../model/types.js";
import { TOOL_NAMES } from "../../model/drawing-model.js";
import { useTerminal } from "./context.js";
export function DrawingToolbar() {
  const { controller, state } = useTerminal(),
    [menu, setMenu] = useState<"lines" | "fib" | null>(null),
    [clear, setClear] = useState(false),
    file = useRef<HTMLInputElement>(null);
  const choose = (tool: DrawingTool | null) => {
    controller.setTool(tool);
    setMenu(null);
  };
  const choices: DrawingTool[] =
    menu === "fib"
      ? ["fibonacciLine", "fibonacciExtension"]
      : [
          "segment",
          "rayLine",
          "straightLine",
          "horizontalStraightLine",
          "horizontalRayLine",
          "verticalStraightLine"
        ];
  return (
    <aside className="drawing-tools" aria-label="Инструменты рисования">
      <button
        className={`tool ${state.activeTool == null ? "active" : ""}`}
        data-tool="cursor"
        title="Курсор"
        aria-label="Курсор"
        onClick={() => choose(null)}
      >
        ＋
      </button>
      <span className="tool-divider" />
      <button
        className="tool"
        data-tool-group="lines"
        title="Линии"
        aria-label="Линии"
        onClick={() => setMenu(menu === "lines" ? null : "lines")}
      >
        ╱
      </button>
      <button
        className={`tool ${state.activeTool === "horizontalStraightLine" ? "active" : ""}`}
        data-tool="horizontalStraightLine"
        title="Горизонтальная линия"
        aria-label="Горизонтальная линия"
        onClick={() => choose("horizontalStraightLine")}
      >
        ━
      </button>
      <button
        className="tool"
        data-tool-group="fib"
        title="Инструменты Фибоначчи"
        aria-label="Фибоначчи"
        onClick={() => setMenu(menu === "fib" ? null : "fib")}
      >
        ☷
      </button>
      <button
        className="tool"
        id="attach-image"
        title="Добавить изображение"
        aria-label="Добавить изображение"
        onClick={() => {
          if (!controller.chart) controller.notify("Сначала откройте график.");
          else file.current?.click();
        }}
      >
        ▧
      </button>
      <input
        ref={file}
        id="image-file"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(e) => {
          const image = e.target.files?.[0];
          e.target.value = "";
          if (image)
            void controller
              .attachImage(image)
              .catch((error: unknown) =>
                controller.notify(error instanceof Error ? error.message : "Изображение недоступно")
              );
        }}
      />
      <span className="tool-divider" />
      <button
        className="tool"
        id="fit-chart"
        title="Показать весь график"
        aria-label="Показать весь график"
        onClick={() => controller.chart?.fit()}
      >
        ⛶
      </button>
      <button
        className="tool"
        id="delete-drawings"
        title="Удалить рисунки"
        aria-label="Удалить рисунки"
        onClick={() => setClear(!clear)}
      >
        ♜
      </button>
      <button
        className="tool"
        id="chart-settings-button"
        title="Настройки графика"
        aria-label="Настройки графика"
        onClick={() => controller.setDialog("chart-settings")}
      >
        ⚙
      </button>
      <div className="rail-spacer" />
      <span className="rail-label">РФ</span>
      {menu && (
        <div className="drawing-menu" style={{ left: 54, top: menu === "fib" ? 155 : 90 }}>
          <small>{menu === "fib" ? "ФИБОНАЧЧИ" : "ЛИНИИ"}</small>
          {choices.map((tool) => (
            <button key={tool} data-drawing-tool={tool} onClick={() => choose(tool)}>
              <span>{tool.startsWith("fibonacci") ? "☷" : "╱"}</span>
              {TOOL_NAMES[tool]}
              {tool === "fibonacciLine" && <kbd>Alt + F</kbd>}
            </button>
          ))}
        </div>
      )}
      {clear && (
        <div className="drawing-menu" style={{ left: 54, top: 290 }}>
          <small>Рисунки текущего инструмента</small>
          <button
            onClick={() => {
              void controller.setDrawings([]);
              setClear(false);
            }}
          >
            Удалить все рисунки
          </button>
          <button onClick={() => setClear(false)}>Отмена</button>
        </div>
      )}
    </aside>
  );
}
