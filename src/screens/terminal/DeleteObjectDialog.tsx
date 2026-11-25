import { t } from "../../i18n/messages.js";
import { useEffect, useState } from "react";
import { Modal } from "./Modal.js";
import { useTerminal } from "./context.js";

export function DeleteObjectDialog() {
  const { controller, state } = useTerminal();
  const [busy, setBusy] = useState(false);
  const pending = controller.tools.pendingDeletion;
  const scope = controller.tools.scopeKey();
  const close = () => {
    controller.tools.pendingDeletion = null;
    if (controller.getSnapshot().dialog === "delete-object") controller.setDialog(null);
  };
  useEffect(() => {
    if (state.dialog === "delete-object" && pending?.scope !== scope) {
      controller.tools.pendingDeletion = null;
      controller.setDialog(null);
    }
  }, [controller, state.dialog, pending?.scope, scope]);
  if (state.dialog !== "delete-object" || !pending || pending.scope !== scope) return null;
  return (
    <Modal
      id="delete-object-dialog"
      title={
        pending.kind === "bulk"
          ? t("Удалить зафиксированные объекты?")
          : t("Удалить зафиксированный объект?")
      }
      onClose={close}
    >
      <p>{t("Удалить с графика, включая зафиксированные объекты?")}</p>
      <footer>
        <button onClick={close} disabled={busy}>
          {t("Отмена")}
        </button>
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            const action =
              pending.kind === "bulk"
                ? controller.tools.remove(pending.target, true, pending.scope)
                : controller.tools.deleteObject(pending.id, true, pending.scope);
            void action
              .then(() => {
                if (controller.tools.scopeKey() === pending.scope) close();
              })
              .catch((error: unknown) => {
                if (controller.tools.scopeKey() === pending.scope)
                  controller.notify(
                    error instanceof Error ? error.message : t("Не удалось удалить объект")
                  );
              })
              .finally(() => setBusy(false));
          }}
        >
          {t("Удалить")}
        </button>
      </footer>
    </Modal>
  );
}
