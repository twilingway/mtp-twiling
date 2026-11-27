/** Registered public OAuth client ID; a client secret never belongs in this application. */
declare const __MTP_YANDEX_CLIENT_ID__: string | undefined;
declare const __MTP_YANDEX_REDIRECT_URI__: string | undefined;
const YANDEX_PUBLIC_CLIENT_ID =
  typeof __MTP_YANDEX_CLIENT_ID__ === "undefined"
    ? "5eb8206c526a4c5593716703d091fa8d"
    : __MTP_YANDEX_CLIENT_ID__;
const YANDEX_REDIRECTS = new Set([
  "http://localhost:5290/__dev/app/yandex-callback.html",
  "http://127.0.0.1:5290/__dev/app/yandex-callback.html",
  "https://mtp-test.twiling.ru/yandex-callback.html",
  "https://mtp.twiling.ru/yandex-callback.html"
]);

export function yandexPublicConfig(): { clientId: string; redirectUri: string } | undefined {
  const redirectUri =
    typeof __MTP_YANDEX_REDIRECT_URI__ === "undefined" || !__MTP_YANDEX_REDIRECT_URI__
      ? new URL("yandex-callback.html", document.baseURI).href
      : __MTP_YANDEX_REDIRECT_URI__;
  if (
    !YANDEX_PUBLIC_CLIENT_ID ||
    !/^[a-f0-9]{32}$/.test(YANDEX_PUBLIC_CLIENT_ID) ||
    !YANDEX_REDIRECTS.has(redirectUri) ||
    new URL(redirectUri).origin !== new URL(document.baseURI).origin
  )
    return undefined;
  return {
    clientId: YANDEX_PUBLIC_CLIENT_ID,
    redirectUri
  };
}
