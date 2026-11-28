export const MTP_WORKER_RESERVE_CSS = 96;
const PIXEL_LIMIT = 4 * 1024 * 1024;
const SIDE_LIMIT = 4096;

/** Each actual plot targets half its CSS width (at least 96px); core resolution is unchanged. */
export function mtpWorkerBuffer(width: number, height: number, horizontalRatio: number) {
  const maximumWidth = Math.min(SIDE_LIMIT, Math.floor(PIXEL_LIMIT / height));
  const padX = Math.max(
    0,
    Math.min(
      Math.ceil(Math.max(MTP_WORKER_RESERVE_CSS * horizontalRatio, width / 2)),
      Math.floor((maximumWidth - width) / 2)
    )
  );
  const totalWidth = width + padX * 2;
  const maximumHeight = Math.min(SIDE_LIMIT, Math.floor(PIXEL_LIMIT / totalWidth));
  const padY = Math.max(
    0,
    Math.min(Math.floor(height * 0.2), Math.floor((maximumHeight - height) / 2))
  );
  return { padX, padY, width: totalWidth, height: height + padY * 2 };
}

/** Extend only real loaded indices, retaining enough stroke/phase guard beyond the bitmap. */
export function mtpWorkerCapture(
  start: number,
  end: number,
  length: number,
  reserve: number,
  spacing: number,
  margin: number,
  step: number
) {
  if (!(reserve > 0 && spacing > 0) || ![reserve, spacing, margin].every(Number.isFinite))
    return { captureStart: start, captureEnd: end };
  const extra = Math.ceil((reserve + margin) / spacing) + step * 2;
  return {
    captureStart: Math.max(0, start - extra),
    captureEnd: Math.min(length - 1, end + extra)
  };
}
