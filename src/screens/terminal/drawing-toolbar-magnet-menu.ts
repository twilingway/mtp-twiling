import { t } from "../../i18n/messages.js";
import type { MagnetMode, ResolvedDrawingToolbar } from "../../model/drawing-toolbar.js";
import type { ToolbarMenuItem, ToolbarMenuSection } from "./DrawingToolbarMenu.js";

export function magnetMenuSections(
  settings: ResolvedDrawingToolbar,
  mobile: boolean,
  choose: (mode: MagnetMode) => void,
  toggleIndicators: () => void
): ToolbarMenuSection[] {
  const modes: ToolbarMenuItem[] = [
    {
      id: "weakMagnet",
      label: t("Слабый магнит"),
      icon: "magnet",
      kind: "radio",
      checked: settings.magnet === "weak",
      action: () => choose("weak")
    },
    {
      id: "strongMagnet",
      label: t("Сильный магнит"),
      icon: "strongMagnet",
      kind: "radio",
      checked: settings.magnet === "strong",
      action: () => choose("strong")
    }
  ];
  if (mobile)
    modes.unshift({
      id: "noMagnet",
      label: t("Без магнита"),
      icon: "magnet",
      kind: "radio",
      checked: settings.magnet === "off",
      action: () => choose("off")
    });
  return [
    { title: null, items: modes },
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
          action: toggleIndicators
        }
      ]
    }
  ];
}
