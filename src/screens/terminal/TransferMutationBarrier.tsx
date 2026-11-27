import { useEffect } from "react";
import { t } from "../../i18n/messages.js";
import { useTerminal } from "./context.js";

/** Keep account/logout/Google disconnect usable while portable mutations are suspended. */
export function TransferMutationBarrier() {
  const { state } = useTerminal(),
    blocked = !!(state.profileTransition || state.importingBackup || state.importRecoveryRequired);
  useEffect(() => {
    if (!blocked) return;
    const nodes = [
        ...document.querySelectorAll<HTMLElement>(
          ".topbar .toolbar-scroll > :not(.terminal-brand-menu), .drawing-toolbar, .right-panel, .chart-workspace > [data-chart-slot]"
        )
      ],
      previous = nodes.map((node) => node.inert);
    nodes.forEach((node) => {
      node.inert = true;
    });
    return () => {
      nodes.forEach((node, index) => {
        node.inert = previous[index] ?? false;
      });
    };
  }, [blocked]);
  return blocked ? (
    <div
      id="portable-import-status"
      role="status"
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 90,
        maxWidth: "90vw",
        padding: "10px 16px",
        background: "var(--panel-bg, #1e2635)",
        color: "var(--text, #d1d4dc)",
        borderRadius: 6
      }}
    >
      {state.profileTransition
        ? t("Переключаем локальный профиль. Аккаунт доступен.")
        : state.importRecoveryRequired
          ? t("Завершите восстановление профиля, чтобы изменять настройки.")
          : t("Применяем настройки. Аккаунт и отключение доступны.")}
    </div>
  ) : null;
}
