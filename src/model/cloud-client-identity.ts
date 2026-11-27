import type { CloudClientMode } from "./cloud-sync.js";

export const CLOUD_TEST_CLIENT_ID = "00000000-0000-4000-8000-000000000001";
export interface CloudClientAddress {
  pathname: string;
  search: string;
}
/** Only explicit DEV/Testing signals affect fresh defaults; private browsing is never inferred. */
export function defaultCloudClientMode(
  address?: CloudClientAddress,
  devLoader = false
): CloudClientMode {
  if (
    devLoader ||
    address?.pathname === "/__dev/app" ||
    address?.pathname.startsWith("/__dev/app/")
  )
    return "test";
  return new URLSearchParams(address?.search).get("sync-client") === "testing" ? "test" : "normal";
}
export function cloudClientLabel(mode: CloudClientMode): "Этот браузер" | "Тестирование" {
  return mode === "test" ? "Тестирование" : "Этот браузер";
}
