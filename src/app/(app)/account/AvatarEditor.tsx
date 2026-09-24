"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { IconButton } from "@/components/IconButton";
import { cropToAvatar, uploadAvatar } from "@/lib/avatar-client";

/** Geometry is computed in a fixed 280-unit viewport; the element scales to fit. */
const VIEW = 280;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const KEY_STEP = 10;
const KEY_STEP_FAST = 40;
const ZOOM_STEP = 0.25;

interface Size {
  w: number;
  h: number;
}

/** zoom 1 = the image just covers the square; x/y = image top-left in view units (<= 0). */
interface View {
  zoom: number;
  x: number;
  y: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const baseScale = (n: Size) => VIEW / Math.min(n.w, n.h);

/** Keep the zoom in range and the image covering the whole viewport. */
function clampView(v: View, n: Size): View {
  const zoom = clamp(v.zoom, MIN_ZOOM, MAX_ZOOM);
  const s = baseScale(n) * zoom;
  return {
    zoom,
    x: clamp(v.x, VIEW - n.w * s, 0),
    y: clamp(v.y, VIEW - n.h * s, 0),
  };
}

/** Zoom to `nextZoom`, keeping the image point under (ax, ay) in place. */
function zoomAround(v: View, n: Size, nextZoom: number, ax: number, ay: number): View {
  const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  const k = zoom / v.zoom;
  return clampView({ zoom, x: ax - (ax - v.x) * k, y: ay - (ay - v.y) * k }, n);
}

function centered(n: Size): View {
  const s = baseScale(n);
  return { zoom: 1, x: (VIEW - n.w * s) / 2, y: (VIEW - n.h * s) / 2 };
}

export interface AvatarEditorProps {
  /** The picked image. Mount one editor per file (key it) so state starts fresh. */
  file: File;
  onClose: () => void;
  /** Called with the new versioned URL once the picture is stored. */
  onSaved: (url: string) => void;
}

/**
 * "Profile picture" dialog: the image in a square viewport under a circular
 * mask. Drag (mouse/touch/pen) or arrow keys to pan; slider, wheel, pinch or
 * +/− to zoom (1×–4×). Save crops the visible square in the browser
 * (cropToAvatar → ~384px WebP/JPEG) and uploads it (uploadAvatar).
 */
export function AvatarEditor({ file, onClose, onSaved }: AvatarEditorProps) {
  const hintId = useId();
  const viewportRef = useRef<HTMLDivElement>(null);

  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active pointers (for drag + two-finger pinch).
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Focus must always end up INSIDE the dialog. On open nothing here can take
  // it yet (the zoom slider and crop area are disabled until the image loads),
  // so the Modal lands on its Close button: once the image is ready, move focus
  // to the crop area (keyboard users can pan straight away) unless the user
  // already moved it elsewhere inside; if the image fails to load, focus an
  // enabled button (Close / Cancel) so Tab can't walk the page behind.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || (!natural && !loadError)) return;
    const dialog = el.closest<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const active = document.activeElement;
    const onClose = active instanceof HTMLElement && active.getAttribute("aria-label") === "Close dialog";
    if (dialog.contains(active) && !onClose) return;
    if (natural) el.focus({ preventScroll: true });
    else if (!dialog.contains(active)) dialog.querySelector<HTMLElement>("button:not([disabled])")?.focus();
  }, [natural, loadError]);

  // Wheel zoom needs a non-passive native listener so the page behind the
  // dialog doesn't scroll.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !natural) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const k = VIEW / (rect.width || VIEW);
      const ax = (e.clientX - rect.left) * k;
      const ay = (e.clientY - rect.top) * k;
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      setView((v) => zoomAround(v, natural, v.zoom * factor, ax, ay));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [natural]);

  /** CSS px → view units (the viewport may render narrower than 280px). */
  function unitsPerPx(): number {
    const w = viewportRef.current?.getBoundingClientRect().width;
    return w ? VIEW / w : 1;
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!natural || saving) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom };
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !natural) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    const k = unitsPerPx();

    if (pointers.current.size >= 2) {
      const [a, b] = Array.from(pointers.current.values());
      const start = pinch.current;
      if (!start || start.dist <= 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ax = ((a.x + b.x) / 2 - rect.left) * k;
      const ay = ((a.y + b.y) / 2 - rect.top) * k;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      setView((v) => zoomAround(v, natural, (start.zoom * dist) / start.dist, ax, ay));
      return;
    }
    const dx = (cur.x - prev.x) * k;
    const dy = (cur.y - prev.y) * k;
    setView((v) => clampView({ ...v, x: v.x + dx, y: v.y + dy }, natural));
  }

  function onPointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  function zoomBy(delta: number) {
    if (!natural) return;
    setView((v) => zoomAround(v, natural, v.zoom + delta, VIEW / 2, VIEW / 2));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!natural || saving) return;
    const step = e.shiftKey ? KEY_STEP_FAST : KEY_STEP;
    let dx = 0;
    let dy = 0;
    switch (e.key) {
      case "ArrowLeft":
        dx = -step;
        break;
      case "ArrowRight":
        dx = step;
        break;
      case "ArrowUp":
        dy = -step;
        break;
      case "ArrowDown":
        dy = step;
        break;
      case "+":
      case "=":
        e.preventDefault();
        zoomBy(ZOOM_STEP);
        return;
      case "-":
      case "_":
        e.preventDefault();
        zoomBy(-ZOOM_STEP);
        return;
      default:
        return;
    }
    e.preventDefault();
    setView((v) => clampView({ ...v, x: v.x + dx, y: v.y + dy }, natural));
  }

  function close() {
    if (!saving) onClose();
  }

  async function save() {
    if (!natural || saving) return;
    setSaving(true);
    setError(null);
    try {
      const s = baseScale(natural) * view.zoom;
      const blob = await cropToAvatar(file, { x: -view.x / s, y: -view.y / s, size: VIEW / s });
      const res = await uploadAvatar(blob);
      if ("error" in res) {
        setError(res.error);
        setSaving(false);
        return;
      }
      onSaved(res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't process that image.");
      setSaving(false);
    }
  }

  const s = natural ? baseScale(natural) * view.zoom : 1;
  const pct = (units: number) => `${(units / VIEW) * 100}%`;

  return (
    <Modal open onClose={close} title="Profile picture" className="max-w-sm">
      <div className="space-y-3">
        <div
          ref={viewportRef}
          role="group"
          aria-label="Crop area"
          aria-describedby={hintId}
          tabIndex={natural ? 0 : -1}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onKeyDown={onKeyDown}
          className="relative mx-auto aspect-square w-full max-w-[280px] touch-none select-none overflow-hidden rounded-xl bg-surface-sunken outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface data-[ready=true]:cursor-grab data-[ready=true]:active:cursor-grabbing"
          data-ready={natural ? "true" : "false"}
        >
          {src && !loadError && (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
            <img
              src={src}
              alt=""
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              onLoad={(e) => {
                const img = e.currentTarget;
                const n = { w: img.naturalWidth, h: img.naturalHeight };
                if (!n.w || !n.h) {
                  setLoadError(true);
                  return;
                }
                setNatural(n);
                setView(centered(n));
              }}
              onError={() => setLoadError(true)}
              className="pointer-events-none absolute max-w-none"
              style={
                natural
                  ? {
                      left: pct(view.x),
                      top: pct(view.y),
                      width: pct(natural.w * s),
                      height: pct(natural.h * s),
                    }
                  : { opacity: 0 }
              }
            />
          )}

          {natural && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgb(var(--background)/0.72)] ring-1 ring-inset ring-foreground/15"
            />
          )}

          {!natural && !loadError && (
            <div className="absolute inset-0 grid place-items-center text-muted-foreground">
              <Loader2 size={18} className="animate-spin" aria-label="Loading image" />
            </div>
          )}

          {loadError && (
            <div role="alert" className="absolute inset-0 grid place-items-center p-6 text-center text-[13px] text-muted-foreground">
              Couldn&apos;t read that image. Try a PNG, JPEG or WebP.
            </div>
          )}
        </div>

        <p id={hintId} className="text-center text-xs text-muted-foreground">
          Drag or use arrow keys to reposition · scroll, pinch or +/− to zoom
        </p>

        <div className="flex items-center gap-1.5">
          <IconButton
            type="button"
            size="sm"
            aria-label="Zoom out"
            onClick={() => zoomBy(-ZOOM_STEP)}
            disabled={!natural || saving || view.zoom <= MIN_ZOOM}
          >
            <ZoomOut size={15} />
          </IconButton>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={view.zoom}
            onChange={(e) => {
              if (natural) {
                const z = Number(e.target.value);
                setView((v) => zoomAround(v, natural, z, VIEW / 2, VIEW / 2));
              }
            }}
            disabled={!natural || saving}
            aria-label="Zoom"
            aria-valuetext={`${view.zoom.toFixed(2)}×`}
            className="h-1.5 min-w-0 flex-1 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-50"
          />
          <IconButton
            type="button"
            size="sm"
            aria-label="Zoom in"
            onClick={() => zoomBy(ZOOM_STEP)}
            disabled={!natural || saving || view.zoom >= MAX_ZOOM}
          >
            <ZoomIn size={15} />
          </IconButton>
        </div>

        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            onClick={close}
            disabled={saving}
            className="h-8 px-3.5 text-[13px]"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={!natural || saving}
            className="h-8 min-w-[76px] px-3.5 text-[13px]"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? "Saving" : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
