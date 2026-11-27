import { ToolbarPopover } from "./ToolbarPopover.js";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { t } from "../../i18n/messages.js";
import { terminalTheme, withTheme } from "../../model/theme.js";
import type { TerminalController } from "./controller.js";
import type { TerminalPreferences } from "./state.js";
import type { TerminalControlsState } from "./terminal-state-selection.js";
import { MobileChartTools } from "./MobileChartTools.js";
import { ChartRangeControl } from "./intervals/ChartRangeControl.js";
import { ClockZoneControl } from "./ClockZoneControl.js";
import { useMobileLayout } from "./use-mobile-layout.js";

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
  const mobile = useMobileLayout();
  const panelOpen = !preferences.rightPanelCollapsed && (!mobile || !!accountState.mobilePanelOpen);
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
      <ToolbarPopover
        anchor={trigger}
        open={open}
        keepMounted
        resizeBehavior="reposition"
        onClose={() => setRequested(false)}
      >
        <div
          ref={panel}
          id={id}
          className="terminal-brand-popover"
          role="dialog"
          aria-labelledby={`${id}-heading`}
          hidden={!open}
        >
          <div className="terminal-brand-identity">
            <h2 id={`${id}-heading`}>{brand}</h2>
            <span id="account-name">{accountState.name || label("Личное пространство")}</span>
          </div>
          {open && (
            <>
              <MobileChartTools
                controller={account}
                panelOpen={panelOpen}
                objectsOpen={accountState.objectPanel}
                mobile={mobile}
                disabled={disabled}
                onAction={close}
              />
              <section className="terminal-brand-section" aria-labelledby={`${id}-workspace`}>
                <h3 id={`${id}-workspace`}>{label("График и рабочая область")}</h3>
                {mobile && panelOpen && (
                  <button
                    type="button"
                    className="terminal-brand-action"
                    disabled={disabled}
                    onClick={() => {
                      if (!current()) return;
                      close();
                      account.panel.closeMobile();
                    }}
                  >
                    <span aria-hidden="true">←</span> {label("Вернуться к графику")}
                  </button>
                )}
                <button
                  type="button"
                  className="terminal-brand-action"
                  disabled={disabled}
                  onClick={() => show(editor, "chart-settings")}
                >
                  {label("Настройки графика")}
                </button>
                <fieldset
                  className="terminal-brand-workspace-controls"
                  disabled={disabled}
                  aria-label={label("График и рабочая область")}
                >
                  <ChartRangeControl placement="toolbar" />
                  <div className="terminal-brand-zone">
                    <span>{label("Часовой пояс")}</span>
                    <ClockZoneControl />
                  </div>
                </fieldset>
              </section>
              <section className="terminal-brand-section" aria-labelledby={`${id}-appearance`}>
                <h3 id={`${id}-appearance`}>{label("Оформление")}</h3>
                <label className="terminal-brand-field">
                  <span>{label("Тема интерфейса")}</span>
                  <select
                    disabled={disabled}
                    value={terminalTheme(preferences.chartSettings)}
                    onChange={(event) => {
                      const theme = event.currentTarget.value === "light" ? "light" : "dark";
                      apply((latest) => ({
                        chartSettings: withTheme(latest.chartSettings, theme)
                      }));
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
              </section>
              <section className="terminal-brand-section" aria-labelledby={`${id}-account`}>
                <h3 id={`${id}-account`}>{label("Аккаунт и данные")}</h3>
                <button
                  type="button"
                  className="terminal-brand-action terminal-brand-account"
                  onClick={() => show(account, "account")}
                >
                  <span>{label("Аккаунт и источники")}</span>
                  <small>{label("Подключение, облако, импорт и экспорт")}</small>
                </button>
              </section>
            </>
          )}
          <section className="terminal-brand-section" aria-labelledby={`${id}-help`} hidden={!open}>
            <h3 id={`${id}-help`}>{label("Помощь и установка")}</h3>
            {open && (
              <button
                type="button"
                className="terminal-brand-action"
                disabled={disabled}
                onClick={() => show(account, "welcome")}
              >
                {label("Помощь и первый запуск")}
              </button>
            )}
            {typeof children === "function" ? children(close, open) : children}
          </section>
        </div>
      </ToolbarPopover>
    </div>
  );
}
