import { t } from "../../i18n/messages.js";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
export function Modal({
  id,
  title,
  children,
  onClose
}: {
  id: string;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      id={id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>{t(title)}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
