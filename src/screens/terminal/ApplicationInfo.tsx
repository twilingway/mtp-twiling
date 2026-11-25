import { APP_VERSION, BUILD_ID } from "../../generated/app-version.js";
import { useTerminal } from "./context.js";

export function ApplicationInfo() {
  const { state } = useTerminal();
  return (
    <details className="application-info">
      <summary>О приложении и подключении</summary>
      <p>
        mtp.twiling.ru · v{APP_VERSION} · {BUILD_ID}
      </p>
      <p>
        {state.error ??
          (state.status === "connected"
            ? "Т-Банк: подключено"
            : state.authenticated
              ? "Сохранённые котировки; подключаемся к Т-Банку…"
              : "API не подключён")}
      </p>
      <p>{state.historyHelp}</p>
      <p>История, рисунки и изображения сохраняются в IndexedDB на устройстве.</p>
      <p>
        <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">
          TradingView Lightweight Charts™
        </a>
        <br />
        Copyright (с) 2025 TradingView, Inc.
        <br />
        <a href="./licenses/lightweight-charts-LICENSE.txt" target="_blank" rel="noopener">
          Apache License 2.0
        </a>
      </p>
      <p>
        <a href="https://klinecharts.com/" target="_blank" rel="noopener noreferrer">
          KLineChart
        </a>{" "}
        · Apache License 2.0
      </p>
    </details>
  );
}
