import { t } from "../../i18n/messages.js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { ImageAsset, PixelPoint } from "../../model/types.js";
import { drawingToolbarSettings } from "../../model/drawing-toolbar.js";
import { useTerminal } from "./context.js";
import { bindImageProjection } from "./drawing-projection.js";
function ImageAnnotation({
  asset,
  drawingProjection
}: {
  asset: ImageAsset;
  drawingProjection: EventTarget;
}) {
  const { controller } = useTerminal(),
    [url, setUrl] = useState(""),
    root = useRef<HTMLDivElement>(null),
    point = useRef<PixelPoint | null>(null),
    drag = useRef<{
      x: number;
      y: number;
      pixel: PixelPoint;
      original: ImageAsset;
      resizing: boolean;
      token: number;
      clone: boolean;
      cloneId: string | null;
      cloneSyncId: string | null;
    } | null>(null);
  const value = asset;
  const cancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    controller.editing.cancelGesture();
    event.currentTarget.style.cursor = "pointer";
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  useEffect(() => {
    const objectUrl = URL.createObjectURL(asset.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [asset.blob]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    return bindImageProjection(
      element,
      drawingProjection,
      () => controller.chart?.pointToPixel(value.point) ?? null,
      (next) => {
        point.current = next;
      },
      value.visible !== false
    );
  }, [controller, drawingProjection, value.point, value.visible]);
  return (
    <div
      ref={root}
      className={`image-annotation ${value.lock ? "locked" : ""}`}
      data-image-id={asset.id}
      style={{
        width: value.width,
        cursor: "pointer"
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        controller.selectObject(asset.id);
        controller.setContext({
          x: event.clientX,
          y: event.clientY,
          target: { kind: "image", id: asset.id }
        });
      }}
      onPointerDown={(event) => {
        if (
          event.button !== 0 ||
          (event.target instanceof Element && event.target.closest("button"))
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        controller.selectObject(asset.id);
        const tools = drawingToolbarSettings(controller.getSnapshot().preferences.chartSettings);
        if (tools.cursor === "eraser") {
          if (!value.lock && !tools.drawingsLocked) void controller.deleteImage(asset.id);
          return;
        }
        if (!point.current || value.lock || tools.drawingsLocked) return;
        drag.current = {
          x: event.clientX,
          y: event.clientY,
          pixel: point.current,
          original: { ...asset, point: { ...asset.point } },
          resizing:
            event.target instanceof Element && event.target.classList.contains("image-resize"),
          token: controller.editing.beginGesture(),
          clone: event.ctrlKey || event.metaKey,
          cloneId: null,
          cloneSyncId: null
        };
        event.currentTarget.style.cursor = "grabbing";
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active || !controller.editing.gestureActive(active.token)) {
          drag.current = null;
          event.currentTarget.style.cursor = "pointer";
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const dx = event.clientX - active.x,
          dy = event.clientY - active.y;
        if (active.clone && !active.cloneId && !event.ctrlKey && !event.metaKey)
          active.clone = false;
        if (active.clone && !active.cloneId) {
          if (Math.hypot(dx, dy) <= 8) return;
          active.cloneId = crypto.randomUUID();
          active.cloneSyncId = crypto.randomUUID();
        }
        let candidate: ImageAsset;
        if (active.resizing && !active.clone)
          candidate = {
            ...active.original,
            width: Math.max(60, Math.min(900, active.original.width + dx))
          };
        else {
          const next = controller.chart?.pixelToPoint(active.pixel.x + dx, active.pixel.y + dy);
          if (!next) return;
          candidate = { ...active.original, point: next };
        }
        if (active.cloneId && active.cloneSyncId)
          candidate = { ...candidate, id: active.cloneId, syncId: active.cloneSyncId };
        const images = controller.getSnapshot().images,
          exists = images.some((image) => image.id === candidate.id);
        controller.editing.previewGesture(active.token, {
          images: exists
            ? images.map((image) => (image.id === candidate.id ? candidate : image))
            : [...images, candidate],
          selectedObject: candidate.id
        });
      }}
      onPointerUp={(event) => {
        const active = drag.current;
        if (!active) return;
        event.preventDefault();
        event.stopPropagation();
        drag.current = null;
        event.currentTarget.style.cursor = "pointer";
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        void controller.editing
          .finishGesture(active.token)
          .catch((error: unknown) =>
            controller.notify(
              error instanceof Error ? error.message : t("Не удалось сохранить изображение.")
            )
          );
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
    >
      <img src={url} alt={asset.name} draggable={false} />
      <button
        className="image-remove"
        title={t("Удалить изображение")}
        aria-label={t("Удалить изображение")}
        onClick={(event) => {
          event.stopPropagation();
          void controller.deleteImage(asset.id);
        }}
      >
        ×
      </button>
      <span className="image-resize" title={t("Изменить размер")} />
    </div>
  );
}
export function ImageLayer({ drawingProjection }: { drawingProjection: EventTarget }) {
  const { state } = useTerminal();
  return (
    <div
      id="image-layer"
      aria-label={t("Изображения на графике")}
      hidden={drawingToolbarSettings(state.preferences.chartSettings).drawingsHidden}
    >
      {[...state.images]
        .sort((a, b) => (a.zOrder ?? 0) - (b.zOrder ?? 0))
        .map((image) => (
          <ImageAnnotation
            key={`${state.owner}:${state.preferences.symbol}:${image.id}`}
            asset={image}
            drawingProjection={drawingProjection}
          />
        ))}
    </div>
  );
}
