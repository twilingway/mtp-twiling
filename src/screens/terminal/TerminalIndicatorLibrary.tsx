import { t } from "../../i18n/messages.js";
import { indicatorEnabled } from "../../model/indicator-flags.js";
import type { IndicatorLibraryEntry } from "../../model/indicator-library.js";
import type { IndicatorKey } from "../../model/types.js";
import { IndicatorLibraryDialog } from "./IndicatorLibraryDialog.js";
import { useTerminal } from "./context.js";
import { INDICATOR_NAMES } from "./state.js";
import { changeMenuIndicator } from "./indicator-menu-actions.js";
import { useIndicatorMenuAction } from "./useIndicatorMenuAction.js";
import {
  technicalCatalogEntries,
  technicalDefinitionForCatalog
} from "../../model/technical-indicators/catalog.js";
import { addTechnicalIndicator } from "./technical-indicator-actions.js";

const ids = ["mtpAll", "mtp160", "mtp440", "mtp640"] as const;
type LibraryId = (typeof ids)[number];
const keyFor = (id: LibraryId): IndicatorKey => id;

export function TerminalIndicatorLibrary() {
  const { controller, state } = useTerminal();
  const { pending, run } = useIndicatorMenuAction(controller);
  const blocked = !!(pending || state.importingBackup || state.importRecoveryRequired);
  const entries: IndicatorLibraryEntry[] = ids.map((id) => ({
    id,
    label: t(INDICATOR_NAMES[keyFor(id)]),
    aliases: ["МТП", "MTP"],
    category: "scripts",
    available: !blocked,
    ...(blocked
      ? { reason: t(pending ? "Сохранение…" : "Настройки недоступны во время восстановления.") }
      : {})
  }));
  entries.push(
    ...technicalCatalogEntries(
      state.preferences.locale ?? "ru",
      blocked ? t("Сохранение…") : undefined
    )
  );
  return (
    <IndicatorLibraryDialog
      locale={state.preferences.locale ?? "ru"}
      entries={entries}
      activeIds={[
        ...ids.filter((id) => indicatorEnabled(state.preferences.indicators, keyFor(id))),
        ...(state.preferences.indicators.volume ? ["Volume@tv-basicstudies"] : []),
        ...entries
          .filter((entry) =>
            state.preferences.technicalIndicators?.some(
              (item) => item.definitionId === technicalDefinitionForCatalog(entry.id)
            )
          )
          .map((entry) => entry.id)
      ]}
      onClose={() => controller.setDialog(null)}
      onAdd={(id) => {
        const definition = technicalDefinitionForCatalog(id);
        if (definition) void run(() => addTechnicalIndicator(controller, definition));
        else if (id === "Volume@tv-basicstudies")
          void run(() => changeMenuIndicator(controller, "volume", true));
        else if (ids.some((entry) => entry === id))
          void run(() => changeMenuIndicator(controller, keyFor(id as LibraryId), true));
      }}
    />
  );
}
