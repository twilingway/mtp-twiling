import { fromBase64, isRecord, toBase64, validateBackup } from "../../model/backup-format.js";
import type { Backup } from "../../model/types.js";
import { DriveError } from "./types.js";
import type { ContentReference, SnapshotManifest } from "./types.js";

type Shape = true | { [key: string]: Shape } | readonly [Shape];
const scalars = (keys: string): Record<string, Shape> =>
  Object.fromEntries(keys.split(" ").map((key) => [key, true]));
const point: Shape = scalars("timestamp value");
const visibility: Shape = Object.fromEntries(
  ["minutes", "hours", "days", "weeks"].map((key) => [key, scalars("enabled from to")])
);
const drawingSettings: Shape = {
  ...scalars(
    "color width lineStyle lineOpacity trendLine trendColor trendWidth trendStyle trendOpacity fill opacity extendLeft extendRight reverse labels prices labelSide labelVertical labelFormat fontSize textEnabled text textAlign textVertical oneColor extend"
  ),
  levels: [true],
  levelStyles: [scalars("value enabled color text")]
};
const indicators = "ma ema volume mtp160 mtp440 mtp640 mtpAll";
const chartSettings: Shape = {
  ...scalars(
    "theme legendCollapsed showCandleCountdown bodyVisible wickUpColor wickDownColor borderUpColor borderDownColor borderVisible wickVisible candlePaletteVersion grid upColor downColor background scaleFontSize showLegend priceLine"
  ),
  removedIndicators: [true],
  drawingTools: {
    ...scalars(
      "cursor magnet magnetStrength snapIndicators stayInDrawingMode drawingsHidden indicatorsHidden drawingsLocked indicatorsLocked hideTarget lockTarget deleteLocked"
    ),
    favorites: [true],
    lastTools: { $: true }
  },
  indicatorOptions: Object.fromEntries(
    indicators.split(" ").map((key) => [key, scalars("opacity color width")])
  ),
  drawingTemplates: { $: { settings: drawingSettings, visibility } }
};
const backupShape: Shape = {
  ...scalars("application schemaVersion exportedAt"),
  layout: {
    ...scalars(
      "locale timeZone rightPanelCollapsed rightPanelTab sidebarWidth symbol instrumentUid timeframe engine rangeDays watchlistFlagFilter"
    ),
    favoriteIntervals: [true],
    indicatorPaneLayout: { volume: scalars("heightRatio") },
    watchlistFlags: { $: true },
    chartSettings,
    indicators: scalars(indicators)
  },
  watchlist: [
    {
      ...scalars(
        "symbol name uid color mark ticker figi currency step type expirationDate first1minCandleDate first1dayCandleDate firstTradeDate"
      ),
      brand: scalars("logoName logoBaseColor textColor")
    }
  ],
  drawings: [
    {
      symbol: true,
      items: [
        {
          ...scalars("id name title visible lock layer"),
          points: [point],
          settings: drawingSettings,
          visibility
        }
      ]
    }
  ],
  images: [{ ...scalars("id symbol name type width data lock visible zOrder"), point }],
  views: [
    {
      key: true,
      value: {
        ...scalars("from to barSpace offsetRight"),
        camera: scalars("barSpace rightOffsetBars"),
        anchor: scalars("timestamp xFraction")
      }
    }
  ]
};
const unsafe = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "token",
  "apiToken",
  "authorization",
  "vault",
  "owner"
]);
function project(value: unknown, shape: Shape): unknown {
  if (shape === true) {
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
    throw new DriveError("remote-invalid", "Некорректное поле синхронизации.");
  }
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) throw new DriveError("remote-invalid", "Ожидался список настроек.");
    return value.map((item) => project(item, shape[0] as Shape));
  }
  if (value === null) return null;
  if (!isRecord(value)) throw new DriveError("remote-invalid", "Ожидался объект настроек.");
  const fields = shape as Record<string, Shape>;
  const entries = fields.$
    ? Object.entries(value)
    : Object.keys(fields).map((key) => [key, value[key]] as const);
  return Object.fromEntries(
    entries
      .filter(([key, item]) => item !== undefined && !unsafe.has(key))
      .map(([key, item]) => [key, project(item, fields.$ ?? (fields[key] as Shape))])
  );
}

/** Deep allowlist; never serializes local owner, history, tokens or market quote fields. */
export function sanitizeDriveBackup(value: unknown): Backup {
  const flagColors = ["red", "blue", "green", "yellow", "purple", "cyan", "pink"];
  if (isRecord(value) && isRecord(value.layout) && value.layout.watchlistFlags !== undefined) {
    const flags = value.layout.watchlistFlags;
    if (
      !isRecord(flags) ||
      (Object.getPrototypeOf(flags) !== Object.prototype &&
        Object.getPrototypeOf(flags) !== null) ||
      Object.keys(flags).length > 5000 ||
      !Object.entries(flags).every(
        ([key, flag]) =>
          key.length <= 200 &&
          (/^uid:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key) ||
            /^legacy:[A-Z0-9!._-]{1,40}$/.test(key)) &&
          typeof flag === "string" &&
          flagColors.includes(flag)
      )
    )
      throw new DriveError("remote-invalid", "Некорректные цветные метки инструментов.");
  }
  if (
    isRecord(value) &&
    isRecord(value.layout) &&
    value.layout.watchlistFlagFilter !== undefined &&
    (typeof value.layout.watchlistFlagFilter !== "string" ||
      !["all", ...flagColors].includes(value.layout.watchlistFlagFilter))
  )
    throw new DriveError("remote-invalid", "Некорректный фильтр меток инструментов.");
  const projected = project(value, backupShape);
  try {
    return validateBackup(projected);
  } catch {
    throw new DriveError("remote-invalid", "Некорректная резервная копия для Google Диска.");
  }
}
export const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 21 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 512 * 1024;
export const shaPattern = /^[a-f0-9]{64}$/;
export const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export async function sha256(blob: Blob): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function reference(blob: Blob): Promise<ContentReference> {
  return { sha256: await sha256(blob), size: blob.size };
}
export async function verifyContent(blob: Blob, ref: ContentReference): Promise<void> {
  if (blob.size !== ref.size || (await sha256(blob)) !== ref.sha256)
    throw new DriveError("remote-invalid", "Контрольная сумма данных Google Диска не совпала.");
}
export interface PreparedBackup {
  payload: Blob;
  images: { index: number; body: Blob; reference: ContentReference; mimeType: string }[];
}
export async function prepareDriveBackup(input: unknown): Promise<PreparedBackup> {
  const backup = sanitizeDriveBackup(input);
  let total = 0;
  const images: PreparedBackup["images"] = [];
  const metadata = { ...backup, images: backup.images.map((image) => ({ ...image, data: "" })) };
  for (const [index, image] of backup.images.entries()) {
    let bytes: ArrayBuffer;
    try {
      bytes = fromBase64(image.data);
    } catch {
      throw new DriveError("remote-invalid", "Некорректное изображение.");
    }
    const body = new Blob([bytes], { type: image.type });
    total += body.size;
    if (body.size > MAX_IMAGE_BYTES || total > MAX_TOTAL_BYTES)
      throw new DriveError("limit", "Превышен размер изображений для синхронизации.");
    images.push({ index, body, reference: await reference(body), mimeType: image.type });
  }
  const payload = new Blob([JSON.stringify(metadata)], { type: "application/json" });
  if (payload.size > MAX_PAYLOAD_BYTES || payload.size + total > MAX_TOTAL_BYTES)
    throw new DriveError("limit", "Превышен размер снимка для синхронизации.");
  return { payload, images };
}
export async function restoreDriveBackup(payload: Blob, images: Blob[]): Promise<Backup> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(await payload.text());
  } catch {
    throw new DriveError("remote-invalid", "Некорректный JSON снимка.");
  }
  const backup = sanitizeDriveBackup(decoded);
  if (backup.images.length !== images.length || backup.images.some((image) => image.data !== ""))
    throw new DriveError("remote-invalid", "Список изображений снимка не совпал.");
  for (const [index, body] of images.entries()) {
    const image = backup.images[index];
    if (!image) throw new DriveError("remote-invalid", "Изображение снимка не найдено.");
    image.data = toBase64(await body.arrayBuffer());
  }
  return sanitizeDriveBackup(backup);
}

/** Stable dirty-check digest: the backup creation timestamp does not represent an edit. */
export async function driveBackupDigest(input: unknown): Promise<string> {
  const backup = sanitizeDriveBackup(input);
  delete backup.exportedAt;
  return sha256(new Blob([JSON.stringify(backup)]));
}
function validReference(value: unknown, max: number): value is ContentReference {
  return (
    isRecord(value) &&
    typeof value.sha256 === "string" &&
    shaPattern.test(value.sha256) &&
    Number.isSafeInteger(value.size) &&
    Number(value.size) >= 0 &&
    Number(value.size) <= max
  );
}
export function validateManifest(value: unknown): SnapshotManifest {
  if (
    !isRecord(value) ||
    value.protocol !== 1 ||
    typeof value.nodeId !== "string" ||
    !uuidPattern.test(value.nodeId) ||
    typeof value.deviceId !== "string" ||
    !uuidPattern.test(value.deviceId) ||
    !Array.isArray(value.parents) ||
    value.parents.length > 10000 ||
    !value.parents.every(
      (parent) => typeof parent === "string" && uuidPattern.test(parent) && parent !== value.nodeId
    ) ||
    new Set(value.parents).size !== value.parents.length ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !validReference(value.payload, MAX_PAYLOAD_BYTES) ||
    !Array.isArray(value.images) ||
    value.images.length > 1000 ||
    !value.images.every(
      (image, index) =>
        validReference(image, MAX_IMAGE_BYTES) &&
        isRecord(image) &&
        image.index === index &&
        typeof image.mimeType === "string" &&
        ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(image.mimeType)
    )
  )
    throw new DriveError("remote-invalid", "Некорректный манифест Google Диска.");
  const parents: string[] = (value.parents as unknown[]).map((parent) => String(parent));
  const images = (value.images as unknown[]).map((image, index) => {
    if (
      !validReference(image, MAX_IMAGE_BYTES) ||
      !isRecord(image) ||
      typeof image.mimeType !== "string"
    )
      throw new DriveError("remote-invalid", "Некорректное изображение манифеста.");
    return { sha256: image.sha256, size: image.size, index, mimeType: image.mimeType };
  });
  const total = Number(value.payload.size) + images.reduce((sum, image) => sum + image.size, 0);
  if (total > MAX_TOTAL_BYTES) throw new DriveError("limit", "Превышен размер снимка.");
  // Return a projection rather than trusting extra properties from the network.
  return {
    protocol: 1,
    nodeId: value.nodeId,
    deviceId: value.deviceId,
    parents,
    createdAt: value.createdAt,
    payload: { sha256: value.payload.sha256, size: value.payload.size },
    images
  };
}
