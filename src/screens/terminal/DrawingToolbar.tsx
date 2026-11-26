import { t } from "../../i18n/messages.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { drawingToolbarSettings, type DrawingTarget } from "../../model/drawing-toolbar.js";
import { useTerminal } from "./context.js";
import { DrawingToolIcon, type DrawingIconName } from "./DrawingToolIcon.js";
import { ChartMeasurementButton } from "./ChartMeasurement.js";
import { ChartRangeZoomButton } from "./ChartRangeZoom.js";
import {
  DrawingToolbarMenu,
  DrawingToolbarSplit,
  type ToolbarMenuItem,
  type ToolbarMenuSection
} from "./DrawingToolbarMenu.js";
import {
  TOOLBAR_GROUPS,
  PALETTE_CATEGORIES,
  TOOLBAR_TARGETS as targets,
  TARGET_NAMES as targetNames,
  rememberedToolbarTool,
  toolbarToolAvailable,
  type ToolbarGroup,
  type ToolbarTool
} from "./toolbar-registry.js";

interface OpenMenu {
  key: string;
  anchor: HTMLElement;
  owner: string;
  scope: string;
}
const disabledReason = "Пока не реализовано";

export function DrawingToolbar() {
  const { controller, state } = useTerminal();
  const settings = drawingToolbarSettings(state.preferences.chartSettings);
  const showValuesOnHold = state.preferences.chartSettings.ohlcOnHold === true;
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [confirmation, setConfirmation] = useState<{
    target: DrawingTarget;
    owner: string;
    scope: string;
  } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const rail = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const closeMenu = useCallback((restoreFocus = false) => {
    setMenu(null);
    setConfirmation(null);
    if (restoreFocus) trigger.current?.focus();
  }, []);
  useEffect(() => {
    closeMenu();
  }, [
    state.owner,
    state.authenticated,
    state.dialog,
    state.preferences.symbol,
    state.preferences.instrumentUid,
    closeMenu
  ]);
  const run = (action: () => Promise<unknown>, close = true) => {
    if (close) closeMenu();
    void action().catch((error: unknown) =>
      controller.notify(error instanceof Error ? error.message : t("Не удалось выполнить действие"))
    );
  };
  const openMenu = (key: string, anchor: HTMLElement) => {
    trigger.current = anchor;
    setConfirmation(null);
    setMenu((current) =>
      current?.key === key
        ? null
        : { key, anchor, owner: state.owner, scope: controller.tools.scopeKey() }
    );
  };
  const choose = (group: ToolbarGroup, item: ToolbarTool) => {
    if (!toolbarToolAvailable(item)) return;
    if (item.image && !controller.chart) {
      controller.notify(t("Сначала откройте график."));
      return;
    }
    const owner = state.owner;
    if (item.image) file.current?.click();
    run(async () => {
      if (item.tool) await controller.tools.choose(item.tool);
      else if (item.cursor) await controller.tools.setCursor(item.cursor);
      if (!item.image || controller.getSnapshot().owner !== owner) return;
      const current = drawingToolbarSettings(controller.getSnapshot().preferences.chartSettings);
      await controller.tools.setOptions({
        lastTools: { ...current.lastTools, [group.id]: item.id }
      });
    });
  };
  const selected = (item: ToolbarTool): boolean =>
    item.tool
      ? state.activeTool === item.tool
      : Boolean(item.cursor && state.activeTool === null && settings.cursor === item.cursor);
  const toolRow = (group: ToolbarGroup, item: ToolbarTool): ToolbarMenuItem => ({
    id: item.id,
    label: item.label,
    icon: item.icon,
    disabled: !toolbarToolAvailable(item),
    checked: selected(item),
    kind: "radio",
    ...(item.shortcut ? { shortcut: item.shortcut } : {}),
    favorite: settings.favorites.includes(item.id),
    onFavorite: () => run(() => controller.tools.toggleFavorite(item.id), false),
    action: () => choose(group, item)
  });
  const remove = (
    target: DrawingTarget,
    forceLocked = false,
    expectedScope = menu?.scope ?? controller.tools.scopeKey()
  ) => {
    if (controller.tools.scopeKey() !== expectedScope) {
      closeMenu();
      return;
    }
    const owner = state.owner;
    run(async () => {
      const removed = await controller.tools.remove(target, forceLocked, expectedScope);
      if (controller.getSnapshot().owner !== owner || controller.tools.scopeKey() !== expectedScope)
        return;
      if (removed) closeMenu(true);
      else setConfirmation({ target, owner, scope: expectedScope });
    }, false);
  };
  const scopeActive = (kind: "lock" | "hide", target: DrawingTarget): boolean => {
    const drawings = kind === "lock" ? settings.drawingsLocked : settings.drawingsHidden;
    const indicators = kind === "lock" ? settings.indicatorsLocked : settings.indicatorsHidden;
    return target === "drawings"
      ? drawings
      : target === "indicators"
        ? indicators
        : drawings && indicators;
  };
  const scopeRows = (kind: "lock" | "hide"): ToolbarMenuItem[] =>
    targets.map((target) => ({
      id: `${kind}-${target}`,
      label: t(kind === "lock" ? "Закрепить" : "Скрыть") + " " + t(targetNames[target]),
      icon: kind === "lock" ? "lock" : "show",
      kind: "radio",
      checked: scopeActive(kind, target),
      action: () =>
        run(() =>
          kind === "lock"
            ? controller.tools.toggleLock(target)
            : controller.tools.toggleHide(target)
        )
    }));
  const group = TOOLBAR_GROUPS.find((item) => item.id === menu?.key);
  let title = group?.title ?? t("Инструменты");
  let sections: ToolbarMenuSection[] =
    group?.sections.map((part) => ({
      title: part.title,
      items: part.items.map((item) => toolRow(group, item))
    })) ?? [];
  if (group?.id === "cursors")
    sections.push({
      title: null,
      items: [
        {
          id: "values-tooltip-on-long-press",
          label: t("Подсказывать значения при удержании"),
          kind: "checkbox",
          checked: showValuesOnHold,
          action: () =>
            run(() => controller.setChartSettings({ ohlcOnHold: !showValuesOnHold }), false)
        }
      ]
    });
  if (group?.id === "symbols")
    sections = [
      {
        title: t("Палитра пока недоступна"),
        items: PALETTE_CATEGORIES.map(([label, ...categories], index) => ({
          id: `palette-${index}`,
          label: label!,
          icon: "symbols",
          children: [
            {
              title: label!,
              items: categories.map((category, categoryIndex) => ({
                id: `palette-${index}-${categoryIndex}`,
                label: category,
                disabled: true,
                reason: t("Размещение знаков пока не реализовано")
              }))
            }
          ]
        }))
      }
    ];
  if (menu?.key === "magnet") {
    title = t("Магнит");
    sections = [
      {
        title: null,
        items: [
          {
            id: "weakMagnet",
            label: t("Слабый магнит"),
            icon: "magnet",
            kind: "radio",
            checked: settings.magnet === "weak",
            action: () => run(() => controller.tools.setOptions({ magnet: "weak" }))
          },
          {
            id: "strongMagnet",
            label: t("Сильный магнит"),
            icon: "strongMagnet",
            kind: "radio",
            checked: settings.magnet === "strong",
            action: () => run(() => controller.tools.setOptions({ magnet: "strong" }))
          }
        ]
      },
      {
        title: null,
        items: [
          {
            id: "snapToIndicatorsSwitcher",
            label: t("Прикрепить к индикаторам"),
            kind: "checkbox",
            checked: settings.snapIndicators,
            disabled: settings.magnet === "off",
            reason: t("Сначала включите магнит"),
            action: () => run(() => controller.tools.toggleOption("snapIndicators"), false)
          }
        ]
      }
    ];
  } else if (menu?.key === "lock") {
    title = t("Блокировка объектов");
    sections = [{ title: null, items: scopeRows("lock") }];
  } else if (menu?.key === "hide") {
    title = t("Видимость объектов");
    const rows = scopeRows("hide");
    rows.splice(2, 0, {
      id: "hide-positions-and-orders",
      label: t("Скрыть позиции и заявки"),
      disabled: true,
      reason: t("Торговые операции не входят в терминал")
    });
    sections = [{ title: null, items: rows }];
  } else if (menu?.key === "trash") {
    const counts = {
      drawings: state.drawings.length + state.images.length,
      indicators: Object.values(state.preferences.indicators).filter(Boolean).length
    };
    title = t("Удалить объекты");
    sections = [
      {
        title: t("Текущий инструмент"),
        items: targets.map((target) => ({
          id: `remove-${target}`,
          label:
            t("Удалить ") +
            t(targetNames[target]) +
            t(" (") +
            (target === "all" ? counts.drawings + counts.indicators : counts[target]) +
            t(")"),
          icon: "trash",
          action: () => remove(target)
        }))
      },
      {
        title: null,
        items: [
          {
            id: "alwaysRemoveLockedDrawingsSwitcher",
            label: t("Всегда удалять зафиксированные объекты"),
            kind: "checkbox",
            checked: settings.deleteLocked,
            action: () => run(() => controller.tools.toggleOption("deleteLocked"), false)
          }
        ]
      }
    ];
  } else if (menu?.key === "favorites") {
    title = t("Избранные инструменты");
    const favoriteRows = TOOLBAR_GROUPS.flatMap((part) =>
      part.sections.flatMap((section) =>
        section.items
          .filter((item) => settings.favorites.includes(item.id))
          .map((item) => toolRow(part, item))
      )
    );
    sections = [
      {
        title: null,
        items: favoriteRows.length
          ? favoriteRows
          : [
              {
                id: "no-favorites",
                label: t("Добавьте инструменты звёздочкой в меню"),
                disabled: true,
                reason: t("Стрелка вправо переводит фокус на звёздочку")
              }
            ]
      }
    ];
  }
  if (confirmation?.owner === state.owner && confirmation.scope === controller.tools.scopeKey()) {
    const target = confirmation.target;
    title = t("Удалить зафиксированные объекты?");
    sections = [
      {
        title: t("Будут удалены ") + t(targetNames[target]) + t(", включая зафиксированные"),
        items: [
          { id: "cancel-delete", label: t("Отмена"), action: () => closeMenu(true) },
          {
            id: "confirm-delete",
            label: t("Удалить, включая зафиксированные"),
            icon: "trash",
            action: () => remove(target, true, confirmation.scope)
          }
        ]
      }
    ];
  }
  const button = (
    id: string,
    label: string,
    icon: DrawingIconName,
    action: () => void,
    active = false,
    disabled = false
  ) => (
    <button
      type="button"
      key={id}
      id={id}
      className={`tool ${active ? "active" : ""}`}
      title={disabled ? `${t(label)} — ${t(disabledReason)}` : t(label)}
      aria-label={disabled ? `${t(label)} — ${t(disabledReason)}` : t(label)}
      aria-pressed={active}
      disabled={disabled}
      onClick={action}
    >
      <DrawingToolIcon name={icon} />
    </button>
  );
  const utility = (
    key: string,
    label: string,
    icon: DrawingIconName,
    action: () => void,
    active: boolean
  ) => (
    <DrawingToolbarSplit
      key={key}
      id={key}
      toolId={key}
      label={t(label)}
      menuLabel={t(label)}
      icon={icon}
      active={active}
      expanded={menu?.key === key}
      onChoose={() => {
        closeMenu();
        action();
      }}
      onMenu={(anchor) => openMenu(key, anchor)}
    />
  );
  return (
    <aside
      ref={rail}
      className="drawing-tools drawing-toolbar"
      aria-label={t("Инструменты рисования")}
      onKeyDown={(event) => {
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) || menu) return;
        const buttons = Array.from(
          rail.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []
        );
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault();
        buttons[
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length
        ]?.focus();
      }}
    >
      {TOOLBAR_GROUPS.map((part) => {
        const last = rememberedToolbarTool(part, settings.lastTools);
        const active = part.sections.some((section) => section.items.some(selected));
        return (
          <DrawingToolbarSplit
            key={part.id}
            id={part.id}
            toolId={last.id}
            label={`${t(part.title)}: ${t(last.label)}`}
            menuLabel={t(part.title)}
            icon={last.icon}
            active={active}
            disabled={!toolbarToolAvailable(last)}
            expanded={menu?.key === part.id}
            onChoose={() => choose(part, last)}
            onMenu={(anchor) => openMenu(part.id, anchor)}
          />
        );
      })}
      <span className="tool-divider" />
      <ChartMeasurementButton onChoose={closeMenu} />
      <ChartRangeZoomButton onChoose={closeMenu} />
      {button("zoom-out", t("Уменьшить масштаб"), "zoomOut", () => {}, false, true)}
      <span className="tool-divider" />
      {utility(
        "magnet",
        settings.magnet === "strong" ? t("Сильный магнит") : t("Магнит"),
        settings.magnet === "strong" ? "strongMagnet" : "magnet",
        () => run(() => controller.tools.toggleMagnet()),
        settings.magnet !== "off"
      )}
      {button(
        "stay-in-drawing-mode",
        t("Продолжить в режиме рисования"),
        "keepDrawing",
        () => run(() => controller.tools.toggleOption("stayInDrawingMode")),
        settings.stayInDrawingMode
      )}
      {utility(
        "lock",
        t(scopeActive("lock", settings.lockTarget) ? "Открепить" : "Закрепить") +
          " " +
          t(targetNames[settings.lockTarget]),
        "lock",
        () => run(() => controller.tools.toggleLock()),
        scopeActive("lock", settings.lockTarget)
      )}
      {utility(
        "hide",
        t(scopeActive("hide", settings.hideTarget) ? "Показать" : "Скрыть") +
          " " +
          t(targetNames[settings.hideTarget]),
        settings.drawingsHidden || settings.indicatorsHidden ? "hideOff" : "show",
        () => run(() => controller.tools.toggleHide()),
        scopeActive("hide", settings.hideTarget)
      )}
      <span className="tool-divider" />
      <button
        type="button"
        id="delete-drawings"
        className="tool"
        title={t("Удалить объекты")}
        aria-label={t("Удалить объекты")}
        aria-haspopup="menu"
        aria-expanded={menu?.key === "trash"}
        onClick={(event) => openMenu("trash", event.currentTarget)}
      >
        <DrawingToolIcon name="trash" />
      </button>
      <div className="rail-spacer" />
      {button("fit-chart", t("Показать весь график"), "fit", () => controller.chart?.fit())}
      {button(
        "favorite-drawings",
        t("Избранные инструменты"),
        "star",
        () => {
          const anchor = rail.current?.querySelector<HTMLElement>("#favorite-drawings");
          if (anchor) openMenu("favorites", anchor);
        },
        menu?.key === "favorites"
      )}
      {button("chart-settings-button", t("Настройки графика"), "settings", () =>
        controller.setDialog("chart-settings")
      )}
      <input
        ref={file}
        id="image-file"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(event) => {
          const image = event.target.files?.[0];
          event.target.value = "";
          if (image) run(() => controller.attachImage(image));
        }}
      />
      {menu?.owner === state.owner && menu.scope === controller.tools.scopeKey() && (
        <DrawingToolbarMenu
          key={`${menu.key}:${menu.owner}`}
          id="drawing-toolbar-menu"
          title={t(title)}
          anchor={menu.anchor}
          sections={sections}
          onClose={closeMenu}
        />
      )}
    </aside>
  );
}
