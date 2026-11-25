import { useCallback, useEffect, useRef, useState } from "react";
import { TOOL_NAMES } from "../../../model/drawing-model.js";
import type { Drawing, ImageAsset } from "../../../model/types.js";
import { INDICATOR_NAMES } from "../state.js";
import { useTerminal } from "../context.js";

type LayerAction = "front" | "back" | "forward" | "backward";
export function ContextMenu() {
  const { controller, state } = useTerminal();
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<"name" | "size" | null>(null);
  const [value, setValue] = useState("");
  const menu = state.contextMenu;
  const target = menu?.target;
  const drawing =
    target?.kind === "drawing" ? state.drawings.find((item) => item.id === target.id) : undefined;
  const image =
    target?.kind === "image" ? state.images.find((item) => item.id === target.id) : undefined;
  const run = useCallback(
    (action: Promise<void>) => {
      void action.catch((error) =>
        controller.notify(error instanceof Error ? error.message : "Не удалось выполнить действие.")
      );
    },
    [controller]
  );
  const close = () => controller.setContext(null);
  useEffect(() => {
    setExpanded(false);
    setEditing(null);
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target))
        controller.setContext(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [controller, menu]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          'input,textarea,select,dialog,[contenteditable]:not([contenteditable="false"])'
        )
      )
        return;
      if (window.getSelection()?.toString()) return;
      if (event.key === "Escape") {
        controller.setContext(null);
        return;
      }
      if (event.key !== "Delete") return;
      const id = state.selectedObject;
      if (!id) return;
      if (state.drawings.some((item) => item.id === id))
        run(controller.setDrawings(state.drawings.filter((item) => item.id !== id)));
      else if (state.images.some((item) => item.id === id)) run(controller.deleteImage(id));
      else return;
      event.preventDefault();
      controller.selectObject(null);
      controller.setContext(null);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [controller, state.selectedObject, state.drawings, state.images, run]);
  if (!menu || !target) return null;
  const act = (action: () => void) => {
    action();
    close();
  };
  const removeDrawing = (item: Drawing) =>
    act(() => {
      run(controller.setDrawings(state.drawings.filter((d) => d.id !== item.id)));
      controller.selectObject(null);
    });
  const cloneDrawing = (item: Drawing) => act(() => run(controller.editing.clone(item)));
  const layerDrawing = (item: Drawing, action: LayerAction) =>
    act(() => {
      const next = [...state.drawings],
        index = next.findIndex((d) => d.id === item.id);
      if (index < 0) return;
      next.splice(index, 1);
      const updated: Drawing =
        action === "front" || action === "back" ? { ...item, layer: action } : item;
      const to =
        action === "front"
          ? next.length
          : action === "back"
            ? 0
            : action === "forward"
              ? Math.min(next.length, index + 1)
              : Math.max(0, index - 1);
      next.splice(to, 0, updated);
      run(controller.setDrawings(next));
    });
  const layerImage = (item: ImageAsset, action: LayerAction) =>
    act(() => {
      const ordered = [...state.images].sort((a, b) => (a.zOrder ?? 0) - (b.zOrder ?? 0));
      const index = ordered.findIndex((asset) => asset.id === item.id);
      if (index < 0) return;
      ordered.splice(index, 1);
      ordered.splice(
        action === "front"
          ? ordered.length
          : action === "back"
            ? 0
            : action === "forward"
              ? Math.min(ordered.length, index + 1)
              : Math.max(0, index - 1),
        0,
        item
      );
      run(controller.editing.setImages(ordered.map((asset, zOrder) => ({ ...asset, zOrder }))));
    });
  const layers = (action: (layer: LayerAction) => void) => (
    <div className={`context-submenu ${expanded ? "expanded" : ""}`}>
      <button
        className="layer-submenu-trigger"
        aria-haspopup="menu"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        Порядок слоёв <span>›</span>
      </button>
      <div role="menu">
        <button role="menuitem" onClick={() => action("front")}>
          Перенести поверх
        </button>
        <button role="menuitem" onClick={() => action("back")}>
          Отправить назад
        </button>
        <button role="menuitem" onClick={() => action("forward")}>
          На один слой вперёд
        </button>
        <button role="menuitem" onClick={() => action("backward")}>
          На один слой назад
        </button>
      </div>
    </div>
  );
  const begin = (mode: "name" | "size", current: string) => {
    setEditing(mode);
    setValue(current);
  };
  const submitEdit = () => {
    if (editing === "name" && value.trim()) {
      if (drawing) run(controller.updateDrawing({ ...drawing, title: value.trim().slice(0, 300) }));
      if (image) run(controller.saveImage({ ...image, name: value.trim().slice(0, 300) }));
    } else if (editing === "size" && image) {
      const width = Number(value);
      if (!Number.isFinite(width) || width < 60 || width > 900) {
        controller.notify("Укажите ширину от 60 до 900 пикселей.");
        return;
      }
      run(controller.saveImage({ ...image, width }));
    } else return;
    close();
  };
  const x = Math.max(6, Math.min(menu.x, window.innerWidth - 264));
  const y = Math.max(6, Math.min(menu.y, window.innerHeight - (drawing || image ? 420 : 190)));
  return (
    <div
      ref={ref}
      className={`chart-context-menu ${x + 490 > window.innerWidth ? "submenu-left" : ""}`}
      role="menu"
      style={{ left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {drawing && (
        <>
          <strong>{drawing.title || TOOL_NAMES[drawing.name]}</strong>
          <button
            role="menuitem"
            onClick={() =>
              act(() => {
                controller.selectObject(drawing.id);
                controller.setDialog("drawing-settings");
              })
            }
          >
            Настройки…
          </button>
          <button role="menuitem" onClick={() => cloneDrawing(drawing)}>
            Клонировать
          </button>
          <button
            role="menuitem"
            onClick={() => begin("name", drawing.title || TOOL_NAMES[drawing.name])}
          >
            Переименовать…
          </button>
          {layers((action) => layerDrawing(drawing, action))}
          <hr />
          <button
            role="menuitem"
            onClick={() =>
              act(() => run(controller.updateDrawing({ ...drawing, lock: !drawing.lock })))
            }
          >
            {drawing.lock ? "Разблокировать" : "Заблокировать"}
          </button>
          <button
            role="menuitem"
            onClick={() =>
              act(() =>
                run(controller.updateDrawing({ ...drawing, visible: drawing.visible === false }))
              )
            }
          >
            {drawing.visible === false ? "Показать" : "Скрыть"}
          </button>
          <button
            role="menuitem"
            onClick={() => act(() => controller.update({ objectPanel: true }))}
          >
            Дерево объектов
          </button>
          <hr />
          <button role="menuitem" onClick={() => removeDrawing(drawing)}>
            Удалить <kbd>Del</kbd>
          </button>
        </>
      )}
      {image && (
        <>
          <strong>{image.name}</strong>
          <button
            role="menuitem"
            onClick={() => act(() => run(controller.saveImage({ ...image, lock: !image.lock })))}
          >
            {image.lock ? "Разблокировать" : "Заблокировать"}
          </button>
          <button
            role="menuitem"
            onClick={() =>
              act(() => run(controller.saveImage({ ...image, visible: image.visible === false })))
            }
          >
            {image.visible === false ? "Показать" : "Скрыть"}
          </button>
          <button role="menuitem" onClick={() => act(() => run(controller.editing.clone(image)))}>
            Клонировать
          </button>
          {layers((action) => layerImage(image, action))}
          <button role="menuitem" onClick={() => begin("name", image.name)}>
            Переименовать…
          </button>
          <button role="menuitem" onClick={() => begin("size", String(image.width))}>
            Размер…
          </button>
          <hr />
          <button
            role="menuitem"
            onClick={() =>
              act(() => {
                run(controller.deleteImage(image.id));
                controller.selectObject(null);
              })
            }
          >
            Удалить изображение
          </button>
        </>
      )}
      {target.kind === "indicator" && (
        <>
          <strong>{INDICATOR_NAMES[target.key]}</strong>
          <button
            role="menuitem"
            onClick={() => act(() => run(controller.toggleIndicator(target.key)))}
          >
            {state.preferences.indicators[target.key] ? "Скрыть" : "Показать"}
          </button>
          <button role="menuitem" onClick={() => act(() => controller.editIndicator(target.key))}>
            Настройки…
          </button>
          <button
            role="menuitem"
            onClick={() => act(() => controller.update({ objectPanel: true }))}
          >
            Дерево объектов
          </button>
        </>
      )}
      {target.kind === "chart" && (
        <>
          <button role="menuitem" onClick={() => act(() => controller.chart?.fit())}>
            Показать весь график
          </button>
          <button role="menuitem" onClick={() => act(() => controller.setDialog("chart-settings"))}>
            Настройки графика…
          </button>
          <button
            role="menuitem"
            onClick={() => act(() => controller.update({ objectPanel: true }))}
          >
            Дерево объектов
          </button>
          <button role="menuitem" onClick={() => act(() => run(controller.setDrawings([])))}>
            Удалить все рисунки
          </button>
        </>
      )}
      {editing && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitEdit();
          }}
        >
          <label>
            {editing === "size" ? "Ширина, пикселей" : "Название"}
            <input
              autoFocus
              type={editing === "size" ? "number" : "text"}
              value={value}
              maxLength={300}
              onChange={(event) => setValue(event.currentTarget.value)}
            />
          </label>
          <button type="submit">Сохранить</button>
          <button type="button" onClick={() => setEditing(null)}>
            Отмена
          </button>
        </form>
      )}
    </div>
  );
}
