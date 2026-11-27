import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

const redirects = new Set([
  "http://localhost:5290/__dev/app/yandex-callback.html",
  "http://127.0.0.1:5290/__dev/app/yandex-callback.html",
  "https://mtp-test.twiling.ru/yandex-callback.html",
  "https://mtp.twiling.ru/yandex-callback.html"
]);

/** Only these public values may enter browser defines; other environment values are ignored. */
export function cloudPublicDefines(root, { environment = process.env, loadLocal = true } = {}) {
  const publicValue = (key) => {
    if (environment[key] !== undefined) return environment[key];
    if (!loadLocal) return undefined;
    for (const name of [".env.local", ".env"]) {
      const file = join(root, name);
      if (!existsSync(file)) continue;
      const value = parseEnv(readFileSync(file, "utf8"))[key];
      if (value !== undefined) return value;
    }
    return undefined;
  };
  const clientId = publicValue("MTP_PUBLIC_YANDEX_CLIENT_ID")?.trim();
  const redirectUri = publicValue("MTP_PUBLIC_YANDEX_REDIRECT_URI")?.trim();
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
