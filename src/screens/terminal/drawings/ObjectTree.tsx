import { t } from "../../../i18n/messages.js";
import { useState } from "react";
import type { MouseEvent } from "react";
import type { Drawing, ImageAsset, IndicatorKey } from "../../../model/types.js";
import type { ContextTarget } from "../state.js";
import { INDICATOR_NAMES, PERIOD_LABELS } from "../state.js";
import { TOOL_NAMES } from "../../../model/drawing-model.js";
import { useTerminal } from "../context.js";
import { VisibilityIcon, LockIcon, DeleteIcon } from "../VisibilityIcon.js";

export function ObjectTree() {
  const { controller, state } = useTerminal();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const run = (action: Promise<void>) => {
    void action.catch((error) =>
      controller.notify(error instanceof Error ? error.message : t("Не удалось сохранить объект."))
    );
  };
  const context = (event: MouseEvent, target: ContextTarget) => {
    event.preventDefault();
    if (target.kind === "drawing" || target.kind === "image") controller.selectObject(target.id);
    controller.setContext({ x: event.clientX, y: event.clientY, target });
  };
  const beginRename = (item: Drawing | ImageAsset) => {
    setRenaming(item.id);
    setName("blob" in item ? item.name : item.title || TOOL_NAMES[item.name]);
  };
  const rename = (item: Drawing | ImageAsset) => {
    const clean = name.trim();
    if (!clean) return;
    run(
      "blob" in item
        ? controller.saveImage({ ...item, name: clean.slice(0, 300) })
        : controller.updateDrawing({ ...item, title: clean.slice(0, 300) })
    );
    setRenaming(null);
  };
  const label = (item: Drawing | ImageAsset) =>
    renaming === item.id ? (
      <form
        style={{ display: "flex", minWidth: 0, flex: 1 }}
        onSubmit={(event) => {
          event.preventDefault();
          rename(item);
        }}
      >
        <input
          aria-label={t("Новое название объекта")}
          value={name}
          maxLength={300}
          autoFocus
          style={{ minWidth: 0, width: "100%" }}
          onChange={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setRenaming(null);
          }}
        />
        <button type="submit" aria-label={t("Сохранить название")}>
          ✓
        </button>
      </form>
    ) : (
      <button
        data-select={item.id}
        onClick={() => controller.focusObject(item.id)}
        onDoubleClick={() => beginRename(item)}
      >
        {"blob" in item ? item.name : item.title || t(TOOL_NAMES[item.name])}
      </button>
    );
  const actions = (item: Drawing | ImageAsset) => {
    const save = (patch: { lock?: boolean; visible?: boolean }) =>
      run(
        "blob" in item
          ? controller.saveImage({ ...item, ...patch })
          : controller.updateDrawing({ ...item, ...patch })
      );
    return (
      <>
        <button
          data-object-action="lock"
          title={item.lock ? t("Разблокировать") : t("Заблокировать")}
          aria-label={item.lock ? t("Разблокировать") : t("Заблокировать")}
          aria-pressed={!!item.lock}
          onClick={() => save({ lock: !item.lock })}
        >
          <LockIcon locked={!!item.lock} />
        </button>
        <button
          data-object-action="visibility"
          title={item.visible === false ? t("Показать") : t("Скрыть")}
          aria-label={item.visible === false ? t("Показать") : t("Скрыть")}
          onClick={() => save({ visible: item.visible === false })}
        >
          <VisibilityIcon hidden={item.visible === false} />
        </button>
        <button
          data-object-action="delete"
          title={"blob" in item ? t("Удалить изображение") : t("Удалить рисунок")}
          aria-label={"blob" in item ? t("Удалить изображение") : t("Удалить рисунок")}
          onClick={() => run(controller.tools.deleteObject(item.id))}
        >
          <DeleteIcon />
        </button>
      </>
    );
  };
  if (!state.objectPanel) return null;
  return (
    <aside className="objects-panel" aria-label={t("Дерево объектов")}>
      <header>
        <strong>{t("Дерево объектов")}</strong>
        <button aria-label={t("Закрыть дерево объектов")} onClick={controller.toggleObjects}>
          ×
        </button>
      </header>
      <div className="objects-list">
        <strong className="object-instrument">
          {state.preferences.symbol} · {t(PERIOD_LABELS[state.preferences.timeframe])}
        </strong>
        {(Object.keys(INDICATOR_NAMES) as IndicatorKey[])
          .filter((key) => !state.preferences.chartSettings.removedIndicators?.includes(key))
          .map((key) => (
            <div
              key={key}
              className={`object-row ${state.preferences.indicators[key] ? "" : "object-hidden"}`}
              onContextMenu={(event) => context(event, { kind: "indicator", key })}
            >
              <span>∿</span>
              <button onClick={() => controller.editIndicator(key)}>
                {t(INDICATOR_NAMES[key])}
              </button>
              <button
                title={state.preferences.indicators[key] ? t("Скрыть") : t("Показать")}
                onClick={() => run(controller.toggleIndicator(key))}
              >
                <VisibilityIcon hidden={!state.preferences.indicators[key]} />
              </button>
              <button
                title={t("Настройки индикатора")}
                onClick={() => controller.editIndicator(key)}
              >
                ⚙
              </button>
            </div>
          ))}
        {[...state.drawings].reverse().map((drawing) => (
          <div
            key={drawing.id}
            data-object={drawing.id}
            className={`object-row ${drawing.visible === false ? "object-hidden" : ""} ${state.selectedObject === drawing.id ? "selected" : ""}`}
            onContextMenu={(event) => context(event, { kind: "drawing", id: drawing.id })}
          >
            <span>{drawing.name.startsWith("fibonacci") ? "☷" : "╱"}</span>
            {label(drawing)}
            {actions(drawing)}
          </div>
        ))}
        {[...state.images]
          .sort((a, b) => (b.zOrder ?? 0) - (a.zOrder ?? 0))
          .map((image) => (
            <div
              key={image.id}
              data-image={image.id}
              className={`object-row ${image.visible === false ? "object-hidden" : ""} ${state.selectedObject === image.id ? "selected" : ""}`}
              onContextMenu={(event) => context(event, { kind: "image", id: image.id })}
            >
              <span>▧</span>
              {label(image)}
              {actions(image)}
            </div>
          ))}
      </div>
    </aside>
  );
}
