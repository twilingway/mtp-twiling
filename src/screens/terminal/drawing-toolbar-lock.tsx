import { t } from "../../i18n/messages.js";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import type { selectDrawingToolbarState } from "./terminal-state-selection.js";
import type { TerminalController } from "./controller.js";
import {
  DrawingToolbarSplit,
  type ToolbarMenuItem,
  type ToolbarMenuSection
} from "./DrawingToolbarMenu.js";

export function selectedToolbarLock(
  state: Pick<
    ReturnType<typeof selectDrawingToolbarState>,
    "selectedObjectExists" | "selectedObjectLocked" | "preferences"
  >
) {
  const global = drawingToolbarSettings(state.preferences.chartSettings).drawingsLocked;
  return {
    locked: global || (state.selectedObjectExists && state.selectedObjectLocked),
    disabled: !state.selectedObjectExists && !global,
    label: global
      ? t("Разблокировать объекты рисования")
      : !state.selectedObjectExists
        ? t("Выберите объект для блокировки")
        : t(state.selectedObjectLocked ? "Разблокировать объект" : "Заблокировать объект")
  };
}

export function toggleToolbarLock(controller: TerminalController): Promise<void> {
  const settings = controller.getSnapshot().preferences.chartSettings;
  if (!drawingToolbarSettings(settings).drawingsLocked)
    return controller.tools.toggleSelectedLock();
  controller.editing.cancelGesture();
  return controller.tools.setOptions({ drawingsLocked: false });
}

type LockStatus = ReturnType<typeof selectedToolbarLock>;

export function toolbarLockSections(
  status: LockStatus,
  globalRows: ToolbarMenuItem[],
  action: () => void
): ToolbarMenuSection[] {
  return [
    {
      title: t("Выделенный объект"),
      items: [
        {
          id: "lock-selected",
          label: status.label,
          icon: status.locked ? "lock" : "unlock",
          disabled: status.disabled,
          ...(status.disabled ? { reason: status.label } : {}),
          checked: status.locked,
          kind: "checkbox",
          action
        }
      ]
    },
    { title: t("Для всех объектов: блокировка"), items: globalRows }
  ];
}

export function DrawingToolbarLock({
  status,
  mobile,
  expanded,
  onChoose,
  onMenu
}: {
  status: LockStatus;
  mobile: boolean;
  expanded: boolean;
  onChoose: () => void;
  onMenu: (anchor: HTMLElement) => void;
}) {
  return (
    <DrawingToolbarSplit
      id="lock"
      toolId="lock"
      label={status.label}
      disabledLabel={status.label}
      menuLabel={t("Блокировка объектов")}
      icon={status.locked ? "lock" : "unlock"}
      active={status.locked}
      disabled={status.disabled}
      expanded={expanded}
      mobileMenu={mobile}
      onChoose={onChoose}
      onMenu={onMenu}
    />
  );
}
