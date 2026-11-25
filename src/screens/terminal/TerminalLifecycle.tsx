import { memo, useEffect } from "react";
import { setupPwa } from "../../services/pwa.js";
import { DRAWING_CLIPBOARD_MIME } from "../../model/drawing-editing.js";
import { useTerminal } from "./context.js";
export const UpdateBanner = memo(function UpdateBanner() {
  return (
    <aside id="update-banner" className="update-banner" role="status" hidden>
      <div>
        <strong>Доступна новая версия</strong>
        <p>Сохранения останутся на устройстве.</p>
      </div>
      <button id="update-now">Обновить</button>
      <button id="update-later" aria-label="Напомнить позже">
        ×
      </button>
    </aside>
  );
});
export function TerminalLifecycle() {
  const { controller } = useTerminal();
  useEffect(() => {
    const lifecycle = new AbortController();
    let active = true,
      disposePwa: (() => void) | null = null;
    void controller
      .start()
      .catch((error: unknown) =>
        controller.notify(error instanceof Error ? error.message : "Не удалось открыть сохранения")
      );
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
        controller.notify(error instanceof Error ? error.message : "Не удалось изменить разметку.")
      );
    const copy = (event: ClipboardEvent) => {
      if (editingText(event.target) || !event.clipboardData) return;
      const text = controller.editing.copySelected();
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
      if (!controller.editing.acceptsClipboard(text)) return;
      event.preventDefault();
      run(controller.editing.paste(text));
    };
    const keydown = (e: KeyboardEvent) => {
      if (editingText(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === "KeyZ" || e.code === "KeyY")) {
        e.preventDefault();
        if (!controller.getSnapshot().loading)
          run(
            e.code === "KeyY" || e.shiftKey ? controller.editing.redo() : controller.undoDrawings()
          );
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        controller.setDialog(controller.getSnapshot().authenticated ? "instruments" : "account");
      }
      if (e.key === "Escape") {
        controller.editing.cancelGesture();
        controller.setTool(null);
        controller.setContext(null);
        controller.selectObject(null);
      }
      if (e.altKey && e.code === "KeyF") {
        e.preventDefault();
        controller.setTool("fibonacciLine");
      }
      if (e.altKey && e.code === "KeyT") {
        e.preventDefault();
        controller.setTool("segment");
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
      controller.dispose();
    };
  }, [controller]);
  return null;
}
