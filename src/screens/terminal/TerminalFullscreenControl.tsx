import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { currentDisplayPreferences } from "../../i18n/preferences.js";
import { enterTerminalFullscreen, isTerminalFullscreen } from "./terminal-fullscreen.js";

const labels = {
  ru: {
    enter: "На весь экран",
    exit: "Выйти из полноэкранного режима",
    exitFocus: "Выйти из режима фокуса",
    focusNote: "Полноэкранный режим браузера недоступен. Режим фокуса включён."
  },
  en: {
    enter: "Full screen",
    exit: "Exit full screen",
    exitFocus: "Exit focus mode",
    focusNote: "Browser full screen is unavailable. Focus mode is on."
  }
} as const;

const fullscreen = () => isTerminalFullscreen(document);
function subscribe(listener: () => void) {
  document.addEventListener("fullscreenchange", listener);
  return () => document.removeEventListener("fullscreenchange", listener);
}

export function TerminalFullscreenControl() {
  const copy = labels[currentDisplayPreferences().locale];
  const native = useSyncExternalStore(subscribe, fullscreen, () => false);
  const [focus, setFocus] = useState(false);
  const pending = useRef(false);
  const active = native || focus;

  useEffect(() => {
    if (!focus) return;
    const root = document.documentElement;
    root.dataset.terminalFocus = "true";
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector("dialog[open]")
      )
        setFocus(false);
    };
    document.addEventListener("keydown", escape);
    return () => {
      delete root.dataset.terminalFocus;
      document.removeEventListener("keydown", escape);
    };
  }, [focus]);

  async function toggle() {
    if (pending.current) return;
    if (focus) {
      setFocus(false);
      return;
    }
    pending.current = true;
    try {
      if (fullscreen()) {
        await document.exitFullscreen();
      } else if (!(await enterTerminalFullscreen(document))) {
        setFocus(true);
      }
    } catch {
      // The browser can leave fullscreen before an exit request reaches it.
    } finally {
      pending.current = false;
    }
  }

  const label = focus ? copy.exitFocus : native ? copy.exit : copy.enter;
  return (
    <>
      <button
        type="button"
        className="terminal-fullscreen-control"
        data-screen-mode={focus ? "focus" : native ? "fullscreen" : "windowed"}
        aria-label={label}
        title={label}
        onClick={() => void toggle()}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d={
              active
                ? "M4 8h4V4m12 4h-4V4M4 16h4v4m12-4h-4v4"
                : "M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"
            }
          />
        </svg>
      </button>
      {focus && (
        <small className="terminal-fullscreen-note" role="status">
          {copy.focusNote}
        </small>
      )}
    </>
  );
}
