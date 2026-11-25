import { useEffect } from "react";
import { useTerminal } from "./context.js";
export function LocaleEffect() {
  const { state } = useTerminal();
  const locale = state.preferences.locale ?? "ru";
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title =
      locale === "en" ? "mtp.twiling.ru — personal terminal" : "mtp.twiling.ru — личный терминал";
  }, [locale]);
  return null;
}
