import { isInstallPrompt, type InstallPrompt } from "./services/install-prompt.js";

let deferredPrompt: InstallPrompt | null = null;
const capture = (event: Event) => {
  if (!isInstallPrompt(event)) return;
  event.preventDefault();
  deferredPrompt = event;
};
const clear = () => {
  deferredPrompt = null;
};

window.addEventListener("beforeinstallprompt", capture);
window.addEventListener("appinstalled", clear);
window.takeMtpInstallPrompt = () => {
  window.removeEventListener("beforeinstallprompt", capture);
  window.removeEventListener("appinstalled", clear);
  delete window.takeMtpInstallPrompt;
  const prompt = deferredPrompt;
  clear();
  return prompt;
};
