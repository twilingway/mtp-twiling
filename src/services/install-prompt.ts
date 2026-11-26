export type InstallPrompt = Event & { prompt: () => unknown; userChoice: unknown };

export function isInstallPrompt(event: Event): event is InstallPrompt {
  return "prompt" in event && typeof event.prompt === "function" && "userChoice" in event;
}

declare global {
  interface Window {
    takeMtpInstallPrompt?: () => InstallPrompt | null;
  }
}
