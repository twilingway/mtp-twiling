import { APP_VERSION, BUILD_ID } from "../generated/app-version.js";

interface PwaOptions {
  notify: (message: string) => void;
  flush: () => Promise<unknown>;
  appBase?: string | URL;
  signal?: AbortSignal;
}

type InstallPrompt = Event & { prompt: () => unknown; userChoice: unknown };

function isInstallPrompt(event: Event): event is InstallPrompt {
  return "prompt" in event && typeof event.prompt === "function" && "userChoice" in event;
}

function element<T extends HTMLElement>(id: string, constructor: new () => T): T {
  const node = document.getElementById(id);
  if (!(node instanceof constructor)) throw new Error(`Missing PWA element: ${id}`);
  return node;
}

/** The host owns these isolated leaf elements; dispose before mounting another host. */
export async function setupPwa({
  notify,
  flush,
  appBase,
  signal: parentSignal
}: PwaOptions): Promise<() => void> {
  const versionNode = element("app-version", HTMLElement);
  const banner = element("update-banner", HTMLElement);
  const installButton = element("install-app", HTMLButtonElement);
  const updateButton = element("update-now", HTMLButtonElement);
  const laterButton = element("update-later", HTMLButtonElement);
  versionNode.textContent = `v${APP_VERSION}`;
  versionNode.dataset.build = BUILD_ID;
  const listeners = new AbortController();
  const { signal } = listeners;
  let registration: ServiceWorkerRegistration | undefined;
  let installPrompt: InstallPrompt | null = null;
  let reloading = false;
  let updateRequested = false;
  let checkTimer: ReturnType<typeof setInterval> | undefined;
  const dispose = () => {
    listeners.abort();
    clearInterval(checkTimer);
    parentSignal?.removeEventListener("abort", dispose);
  };
  if (parentSignal?.aborted) {
    dispose();
    return dispose;
  }
  parentSignal?.addEventListener("abort", dispose, { once: true });
  const showUpdate = () => {
    if (!signal.aborted && registration?.waiting && navigator.serviceWorker.controller)
      banner.hidden = false;
  };
  window.addEventListener(
    "beforeinstallprompt",
    (event) => {
      if (!isInstallPrompt(event)) return;
      event.preventDefault();
      installPrompt = event;
      installButton.hidden = false;
    },
    { signal }
  );
  window.addEventListener(
    "appinstalled",
    () => {
      installButton.hidden = true;
      installPrompt = null;
      notify("Приложение установлено.");
    },
    { signal }
  );
  installButton.addEventListener(
    "click",
    () => {
      const prompt = installPrompt;
      if (!prompt) return;
      void (async () => {
        await prompt.prompt();
        await prompt.userChoice;
        installPrompt = null;
      })().catch(() => notify("Не удалось открыть установку приложения."));
    },
    { signal }
  );
  laterButton.addEventListener(
    "click",
    () => {
      banner.hidden = true;
    },
    { signal }
  );
  updateButton.addEventListener(
    "click",
    () => {
      const worker = registration?.waiting;
      if (!worker || updateRequested) return;
      updateButton.disabled = true;
      updateButton.textContent = "Сохраняем…";
      void flush()
        .then(() => {
          if (signal.aborted) return;
          updateRequested = true;
          worker.postMessage({ type: "ACTIVATE_UPDATE" });
        })
        .catch(() => {
          updateButton.disabled = false;
          updateButton.textContent = "Обновить";
          notify("Не удалось завершить сохранение. Обновление отложено.");
        });
    },
    { signal }
  );
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    notify("Для установки PWA нужен HTTPS или localhost.");
    return dispose;
  }
  try {
    const base = appBase ? new URL(appBase, document.baseURI) : new URL("./", document.baseURI);
    const activeRegistration = await navigator.serviceWorker.register(
      new URL("service-worker.js", base),
      {
        scope: base.pathname,
        updateViaCache: "none"
      }
    );
    registration = activeRegistration;
    if (signal.aborted) return dispose;
    showUpdate();
    activeRegistration.addEventListener(
      "updatefound",
      () => {
        const worker = activeRegistration.installing;
        worker?.addEventListener(
          "statechange",
          () => {
            if (worker.state === "installed") showUpdate();
          },
          { signal }
        );
      },
      { signal }
    );
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => {
        if (reloading || !updateRequested) return;
        reloading = true;
        location.reload();
      },
      { signal }
    );
    const check = async () => {
      if (!navigator.onLine || signal.aborted) return;
      try {
        await activeRegistration.update();
        await fetch(new URL("version.json", base), { cache: "no-store", signal });
        showUpdate();
      } catch {
        /* Keep the installed shell when offline. */
      }
    };
    await check();
    if (!signal.aborted)
      checkTimer = setInterval(() => {
        void check();
      }, 60000);
    document.addEventListener(
      "visibilitychange",
      () => {
        if (!document.hidden) void check();
      },
      { signal }
    );
    window.addEventListener(
      "online",
      () => {
        void check();
      },
      { signal }
    );
  } catch {
    if (!signal.aborted) notify("Не удалось подготовить PWA для работы офлайн. Проверьте сеть.");
  }
  return dispose;
}
