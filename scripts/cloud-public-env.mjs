import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "node:process";

const redirects = new Set([
  "http://localhost:5290/__dev/app/yandex-callback.html",
  "http://127.0.0.1:5290/__dev/app/yandex-callback.html",
  "https://mtp-test.twiling.ru/yandex-callback.html",
  "https://mtp.twiling.ru/yandex-callback.html"
]);

/** Only these public values may enter browser defines; other environment values are ignored. */
export function cloudPublicDefines(root, { environment = process.env, loadLocal = true } = {}) {
  const file = join(root, ".env.local");
  if (loadLocal && existsSync(file)) loadEnvFile(file);
  const clientId = environment.MTP_PUBLIC_YANDEX_CLIENT_ID?.trim();
  const redirectUri = environment.MTP_PUBLIC_YANDEX_REDIRECT_URI?.trim();
  if (clientId !== undefined && clientId !== "" && !/^[a-f0-9]{32}$/.test(clientId))
    throw new Error(
      "MTP_PUBLIC_YANDEX_CLIENT_ID must contain 32 lowercase hexadecimal characters."
    );
  if (redirectUri && !redirects.has(redirectUri))
    throw new Error("MTP_PUBLIC_YANDEX_REDIRECT_URI must match a registered callback.");
  return {
    ...(clientId === undefined ? {} : { __MTP_YANDEX_CLIENT_ID__: JSON.stringify(clientId) }),
    ...(redirectUri === undefined
      ? {}
      : { __MTP_YANDEX_REDIRECT_URI__: JSON.stringify(redirectUri) })
  };
}
