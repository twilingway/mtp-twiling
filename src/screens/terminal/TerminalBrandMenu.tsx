import { ToolbarPopover } from "./ToolbarPopover.js";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { t } from "../../i18n/messages.js";
import { terminalTheme, withTheme } from "../../model/theme.js";
import type { TerminalController } from "./controller.js";
import type { TerminalPreferences } from "./state.js";
import type { TerminalControlsState } from "./terminal-state-selection.js";

const brand = "МТП Twiling";

interface BrandState {
  profileTransition?: boolean | undefined;
  backupBusy?: boolean | undefined;
  importingBackup?: boolean | undefined;
  importRecoveryRequired?: boolean | undefined;
}
function locked(state: BrandState): boolean {
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
  editor,
  children
}: {
  account: TerminalController;
  accountState: TerminalControlsState;
  editor: TerminalController;
  children?: ReactNode | ((close: () => void, open: boolean) => ReactNode);
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [requested, setRequested] = useState(false);
  const disabled = locked(accountState);
  const open = requested;
  const { owner, preferences } = accountState;
  const locale = preferences.locale ?? "ru";
  const label = (text: string) => t(text, locale);
  useEffect(() => setRequested(false), [account, owner]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target) &&
        !panel.current?.contains(event.target)
      )
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
  const show = (target: TerminalController, dialog: "chart-settings" | "welcome" | "account") => {
    if (dialog === "account" ? account.getSnapshot().owner !== owner : !current()) return;
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
          !event.currentTarget.contains(event.relatedTarget) &&
          !panel.current?.contains(event.relatedTarget)
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
        id="account-button"
        className="brand account-button"
        type="button"
        aria-label={`${label("Аккаунт и настройки")} · ${accountState.name || brand}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        title={accountState.name || label("Аккаунт и настройки")}
        onClick={() => setRequested((visible) => !visible)}
      >
        <span className="avatar" aria-hidden="true">
          {accountState.name?.trim().slice(0, 1).toLocaleUpperCase() || label("Я")}
        </span>
        <i
          className={`account-connection ${accountState.status}`}
          aria-label={
            accountState.authenticated && accountState.status === "connected"
              ? label("Т-Банк подключён")
              : label("Т-Банк не подключён")
          }
        />
      </button>
      <ToolbarPopover anchor={trigger} open={open} keepMounted onClose={() => setRequested(false)}>
        <div
          ref={panel}
          id={id}
          className="terminal-brand-popover"
          role="dialog"
          aria-labelledby={`${id}-heading`}
          hidden={!open}
        >
          <h2 id={`${id}-heading`}>{brand}</h2>
          {open && (
            <>
              <div className="terminal-brand-links">
                <button type="button" onClick={() => show(account, "account")}>
                  {label("Аккаунт и источники")}
                </button>
                {accountState.name && <span id="account-name">{accountState.name}</span>}
              </div>
              <label className="terminal-brand-field">
                <span>{label("Тема интерфейса")}</span>
                <select
                  disabled={disabled}
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
                  disabled={disabled}
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
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => show(editor, "chart-settings")}
                >
                  {label("Настройки графика")}
                </button>
                <button type="button" disabled={disabled} onClick={() => show(account, "welcome")}>
                  {label("Помощь и первый запуск")}
                </button>
              </div>
            </>
          )}
          {typeof children === "function" ? children(close, open) : children}
        </div>
      </ToolbarPopover>
    </div>
  );
}
