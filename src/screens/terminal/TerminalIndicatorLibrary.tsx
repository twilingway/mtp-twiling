import { t } from "../../i18n/messages.js";
import { indicatorEnabled } from "../../model/indicator-flags.js";
import type { IndicatorLibraryEntry } from "../../model/indicator-library.js";
import type { IndicatorKey } from "../../model/types.js";
import { IndicatorLibraryDialog } from "./IndicatorLibraryDialog.js";
import { useTerminal } from "./context.js";
import { INDICATOR_NAMES } from "./state.js";
import { changeMenuIndicator } from "./indicator-menu-actions.js";
import { useIndicatorMenuAction } from "./useIndicatorMenuAction.js";

const ids = ["mtpAll", "mtp160", "mtp440", "mtp640", "volume", "sma", "ema"] as const;
type LibraryId = (typeof ids)[number];
const keyFor = (id: LibraryId): IndicatorKey => (id === "sma" ? "ma" : id);

export function TerminalIndicatorLibrary() {
  const { controller, state } = useTerminal();
  const { pending, run } = useIndicatorMenuAction(controller);
  const blocked = !!(pending || state.importingBackup || state.importRecoveryRequired);
  const entries: IndicatorLibraryEntry<LibraryId>[] = ids.map((id) => ({
    id,
    label: t(INDICATOR_NAMES[keyFor(id)]),
    aliases: id.startsWith("mtp") ? ["МТП", "MTP"] : id === "volume" ? ["Volume", "Объём"] : [id],
    category: id.startsWith("mtp") ? "scripts" : "technicals",
    available: !blocked,
    ...(blocked
      ? { reason: t(pending ? "Сохранение…" : "Настройки недоступны во время восстановления.") }
      : {})
  }));
  return (
    <IndicatorLibraryDialog
      locale={state.preferences.locale ?? "ru"}
      entries={entries}
      activeIds={ids.filter((id) => indicatorEnabled(state.preferences.indicators, keyFor(id)))}
      onClose={() => controller.setDialog(null)}
      onAdd={(id) => {
        void run(() => changeMenuIndicator(controller, keyFor(id), true));
      }}
    />
  );
}
