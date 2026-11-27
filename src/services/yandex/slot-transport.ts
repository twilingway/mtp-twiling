import { assertCurrent, object, sha256, YANDEX_ROOT, YandexError } from "./types.js";
import type { YandexAuthorization, YandexFile, YandexReference } from "./types.js";
import { isSlotName, isStageName } from "./slot-model.js";

const API = "https://cloud-api.yandex.net/v1/disk/";
export interface SlotMutationAccess {
  auth: YandexAuthorization;
  request(
    url: string,
    init: RequestInit,
    allowed: readonly number[],
    valid: () => boolean
  ): Promise<Response>;
  json(response: Response): Promise<unknown>;
  metadata(name: string): Promise<YandexFile | undefined>;
  read(file: YandexFile, limit: number): Promise<Blob>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}
async function operation(
  access: SlotMutationAccess,
  value: unknown,
  valid: () => boolean
): Promise<void> {
  const link = object(value);
  if (typeof link?.href !== "string" || link.method !== "GET" || link.templated !== false)
    throw new YandexError("remote-invalid");
  const url = new URL(link.href);
  if (
    url.origin !== "https://cloud-api.yandex.net" ||
    !/^\/v1\/disk\/operations(?:\/[^/]+|\?id=)/.test(url.pathname + url.search) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new YandexError("remote-invalid");
  for (let index = 0; index < 8; index++) {
    assertCurrent(access.auth.signal, valid);
    const response = await access.request(url.href, {}, [], valid),
      result = object(await access.json(response));
    assertCurrent(access.auth.signal, valid);
    if (result?.status === "success") return;
    if (result?.status === "failed") throw new YandexError("conflict");
    if (result?.status !== "in-progress") throw new YandexError("remote-invalid");
    await access.sleep(Math.min(250 * 2 ** index, 2000), access.auth.signal);
  }
  throw new YandexError("indeterminate");
}
export async function moveYandexSlot(
  access: SlotMutationAccess,
  from: string,
  destination: string,
  reference: YandexReference,
  valid: () => boolean,
  outcome?: (status: number) => void
): Promise<YandexFile> {
  if (
    !isStageName(from) ||
    !isSlotName(destination) ||
    from.startsWith("probe_") !== destination.startsWith("probe_")
  )
    throw new YandexError("permission");
  let failure: unknown;
  let pendingOperation = false;
  try {
    const response = await access.request(
      API +
        "resources/move?" +
        new URLSearchParams({
          from: `${YANDEX_ROOT}/${from}`,
          path: `${YANDEX_ROOT}/${destination}`,
          overwrite: "false",
          force_async: "false"
        }).toString(),
      { method: "POST" },
      [404, 409, 423],
      valid
    );
    outcome?.(response.status);
    if (response.status === 202) {
      pendingOperation = true;
      await operation(access, await access.json(response), valid);
      pendingOperation = false;
    } else if (response.status !== 201) failure = new YandexError("conflict", response.status);
    else await response.body?.cancel();
  } catch (error) {
    failure = error;
  }
  assertCurrent(access.auth.signal, valid);
  if (pendingOperation) throw failure;
  const file = await access.metadata(destination);
  assertCurrent(access.auth.signal, valid);
  if (file) {
    if (
      file.size !== reference.size ||
      (await sha256(await access.read(file, reference.size))) !== reference.sha256
    )
      throw new YandexError("conflict");
    assertCurrent(access.auth.signal, valid);
    return file;
  }
  if (failure instanceof YandexError && failure.code === "conflict") throw failure;
  throw new YandexError("indeterminate");
}
export async function removeYandexSlot(
  access: SlotMutationAccess,
  file: YandexFile,
  valid: () => boolean
): Promise<void> {
  if ((!isSlotName(file.name) && !isStageName(file.name)) || !/^[a-f\d]{32}$/.test(file.md5))
    throw new YandexError("permission");
  assertCurrent(access.auth.signal, valid);
  const response = await access.request(
    API +
      "resources?" +
      new URLSearchParams({
        path: `${YANDEX_ROOT}/${file.name}`,
        md5: file.md5,
        permanently: "true",
        force_async: "false"
      }).toString(),
    { method: "DELETE" },
    [400, 404, 409, 412],
    valid
  );
  if ([400, 409, 412].includes(response.status)) throw new YandexError("conflict", response.status);
  if (response.status === 202) await operation(access, await access.json(response), valid);
  else await response.body?.cancel();
  assertCurrent(access.auth.signal, valid);
  if (await access.metadata(file.name)) throw new YandexError("conflict");
  assertCurrent(access.auth.signal, valid);
}
