import { t } from "../../i18n/messages.js";
import { memo, useEffect, useEffectEvent, useState } from "react";
import { setupPwa } from "../../services/pwa.js";
import { DRAWING_CLIPBOARD_MIME } from "../../model/drawing-editing.js";
import { useTerminal } from "./context.js";
import { startTerminalCloudSync } from "./controller-cloud-sync.js";
import { TransferMutationBarrier } from "./TransferMutationBarrier.js";
import { WelcomeGate } from "./WelcomeDialog.js";
import type { TerminalController } from "./controller.js";
import { finishEditorDrawing } from "./drawing-input-completion.js";
export const UpdateBanner = memo(function UpdateBanner() {
  useTerminal();
  return (
    <aside id="update-banner" className="update-banner" role="status" hidden>
      <div>
        <strong>{t("Доступна новая версия")}</strong>
        <p>{t("Сохранения останутся на устройстве.")}</p>
      </div>
      <button id="update-now">{t("Обновить")}</button>
      <button id="update-later" aria-label={t("Напомнить позже")}>
        ×
      </button>
    </aside>
  );
});
export function TerminalLifecycle({ chartEditor }: { chartEditor?: TerminalController } = {}) {
  const { controller } = useTerminal();
  const selectedEditor = useEffectEvent(() => chartEditor ?? controller);
  const [settledController, setSettledController] = useState<typeof controller | null>(null);
  useEffect(() => {
    const disposeDrive = startTerminalCloudSync(controller);
    const stopAnnotations = controller.editing.observeWorkspaceAnnotations();
    const lifecycle = new AbortController();
    let active = true,
      disposePwa: (() => void) | null = null;
    void controller
      .start()
      .catch((error: unknown) => {
        if (active)
          controller.notify(
            error instanceof Error ? error.message : t("Не удалось открыть сохранения")
          );
      })
      .finally(() => {
        if (active) setSettledController(controller);
      });
    void setupPwa({
      notify: controller.notify,
      flush: controller.flush,
      appBase: new URL("./", document.baseURI),
      signal: lifecycle.signal
    }).then((dispose) => {
      if (active) disposePwa = dispose;
      else dispose();
    });
    const editingText = (target: EventTarget | null) =>
      (target instanceof Element &&
        target.closest(
          'input,textarea,select,dialog,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'
        )) ||
      !!window.getSelection()?.toString();
    const run = (action: Promise<unknown>) =>
      void action.catch((error: unknown) =>
        selectedEditor().notify(
          error instanceof Error ? error.message : t("Не удалось изменить разметку.")
        )
      );
    const copy = (event: ClipboardEvent) => {
      if (editingText(event.target) || !event.clipboardData) return;
      const text = selectedEditor().editing.copySelected();
      if (!text) return;
      event.clipboardData.setData(DRAWING_CLIPBOARD_MIME, text);
      event.clipboardData.setData("text/plain", text);
      event.preventDefault();
    };
    const paste = (event: ClipboardEvent) => {
      if (editingText(event.target) || !event.clipboardData) return;
      const text =
        event.clipboardData.getData(DRAWING_CLIPBOARD_MIME) ||
        event.clipboardData.getData("text/plain");
      const editor = selectedEditor();
      if (!editor.editing.acceptsClipboard(text)) return;
      event.preventDefault();
      run(editor.editing.paste(text));
    };
    const keydown = (e: KeyboardEvent) => {
      if (editingText(e.target)) return;
      const editor = selectedEditor();
      if (
        e.key === "Enter" &&
        !e.defaultPrevented &&
        !controller.getSnapshot().dialog &&
        finishEditorDrawing(editor)
      ) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === "KeyZ" || e.code === "KeyY")) {
        e.preventDefault();
        if (!editor.getSnapshot().loading)
          run(e.code === "KeyY" || e.shiftKey ? editor.editing.redo() : editor.undoDrawings());
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        if (controller.getSnapshot().ready) editor.setDialog("instruments");
        else controller.setDialog("account");
      }
      if (e.key === "Escape") {
        editor.editing.cancelGesture();
        editor.setTool(null);
        editor.setContext(null);
        editor.selectObject(null);
      }
      if (e.altKey && e.code === "KeyF") {
        e.preventDefault();
        run(editor.tools.choose("fibonacciLine"));
      }
      if (e.altKey && e.code === "KeyT") {
        e.preventDefault();
        run(editor.tools.choose("segment"));
      }
    };
    document.addEventListener("keydown", keydown);
    document.addEventListener("copy", copy);
    document.addEventListener("paste", paste);
    return () => {
      active = false;
      lifecycle.abort();
      disposePwa?.();
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("copy", copy);
      document.removeEventListener("paste", paste);
      disposeDrive();
      stopAnnotations();
      controller.dispose();
    };
  }, [controller]);
  return (
    <>
      <TransferMutationBarrier />
      <WelcomeGate startupSettled={settledController === controller} />
    </>
  );
}
