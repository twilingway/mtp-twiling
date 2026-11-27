import { t } from "../../i18n/messages.js";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import type { selectDrawingToolbarState } from "./terminal-state-selection.js";
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
    locked: state.selectedObjectExists && (state.selectedObjectLocked || global),
    disabled: !state.selectedObjectExists || global,
    label: !state.selectedObjectExists
      ? t("Выберите объект для блокировки")
      : global
        ? t("Объекты заблокированы глобально. Разблокируйте их в меню.")
        : t(state.selectedObjectLocked ? "Разблокировать объект" : "Закрепить объект")
  };
}

type LockStatus = ReturnType<typeof selectedToolbarLock>;

export function toolbarLockSections(
  status: LockStatus,
  globalRows: ToolbarMenuItem[],
  mobile: boolean,
  action: () => void
): ToolbarMenuSection[] {
  const sections: ToolbarMenuSection[] = [
    { title: t("Для всех объектов: блокировка"), items: globalRows }
  ];
  if (mobile)
    sections.unshift({
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
    });
  return sections;
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
      menuLabel={t("Для всех объектов: блокировка")}
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
