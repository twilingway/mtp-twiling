import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { installTerminalViewport } from "./browser/terminal-viewport.js";
const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing");
installTerminalViewport();
createRoot(root).render(<App />);
