import { useEffect, useId, useRef, useState } from "react";
import { t } from "../../i18n/messages.js";
import { terminalTheme, withTheme } from "../../model/theme.js";
import type { TerminalController } from "./controller.js";
import type { TerminalPreferences, TerminalState } from "./state.js";

const brand = "MTP Twiling";

function locked(state: TerminalState): boolean {
  return !!(
    state.profileTransition ||
    state.backupBusy ||
    state.importingBackup ||
    state.importRecoveryRequired
  );
}

export function TerminalBrandMenu({
  account,
  accountState,
  editor
}: {
  account: TerminalController;
  accountState: TerminalState;
  editor: TerminalController;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [requested, setRequested] = useState(false);
  const disabled = locked(accountState);
  const open = requested && !disabled;
  const { owner, preferences } = accountState;
  const locale = preferences.locale ?? "ru";
  const label = (text: string) => t(text, locale);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setRequested(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);

  const close = () => {
    setRequested(false);
    trigger.current?.focus({ preventScroll: true });
  };
  const current = () => {
    const snapshot = account.getSnapshot();
    return snapshot.owner === owner && !locked(snapshot) ? snapshot : undefined;
  };
  const apply = (change: (preferences: TerminalPreferences) => Partial<TerminalPreferences>) => {
    const snapshot = current();
    if (!snapshot) return;
    void account.setPreferences(change(snapshot.preferences)).catch((error: unknown) => {
      if (current())
        account.notify(
          error instanceof Error ? error.message : label("Не удалось сохранить настройки.")
        );
    });
  };
  const show = (target: TerminalController, dialog: "chart-settings" | "welcome") => {
    if (!current()) return;
    close();
    target.setDialog(dialog);
  };

  return (
    <div
      ref={root}
      className="terminal-brand-menu"
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setRequested(false);
      }}
      onKeyDown={(event) => {
        if (!open || event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <button
        ref={trigger}
        className="brand"
        type="button"
        aria-label={brand}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        title={brand}
        onClick={() => setRequested((visible) => !visible)}
      >
        <img className="brand-icon" src="./icon.svg" width={25} height={25} alt="" />
      </button>
      <div
        id={id}
        className="terminal-brand-popover"
        role="dialog"
        aria-labelledby={`${id}-heading`}
        hidden={!open}
      >
        <h2 id={`${id}-heading`}>{brand}</h2>
        {open && (
          <>
            <label className="terminal-brand-field">
              <span>{label("Тема интерфейса")}</span>
              <select
                value={terminalTheme(preferences.chartSettings)}
                onChange={(event) => {
                  const theme = event.currentTarget.value === "light" ? "light" : "dark";
                  apply((latest) => ({ chartSettings: withTheme(latest.chartSettings, theme) }));
                }}
              >
                <option value="dark">{label("Тёмная")}</option>
                <option value="light">{label("Светлая")}</option>
              </select>
            </label>
            <label className="terminal-brand-field">
              <span>{label("Язык")}</span>
              <select
                value={locale}
                onChange={(event) => {
                  const next = event.currentTarget.value === "en" ? "en" : "ru";
                  apply(() => ({ locale: next }));
                }}
              >
                <option value="ru">{label("Русский")}</option>
                <option value="en">English</option>
              </select>
            </label>
            <div className="terminal-brand-links">
              <button type="button" onClick={() => show(editor, "chart-settings")}>
                {label("Настройки графика")}
              </button>
              <button type="button" onClick={() => show(account, "welcome")}>
                {label("Помощь и первый запуск")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
