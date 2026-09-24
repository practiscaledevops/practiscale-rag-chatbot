"use client";

// The PractiScale "brain orb": a translucent, softly wobbling frosted membrane
// around a glowing green core, with a rotating dot-globe inside. Drawn on a
// canvas (one per instance) so the membrane can deform organically and the dots
// sit on a real rotating sphere. Pauses when off-screen or the tab is hidden,
// and renders a single still frame for prefers-reduced-motion.
//
// `active` (e.g. the user is typing, or an answer is streaming) eases the orb
// into a livelier state: faster spin, more wobble, a brighter halo.

import { useEffect, useRef } from "react";
import { OrbAvatar } from "@/components/OrbAvatar";
import { cn } from "@/lib/utils";

export interface BrainOrbProps {
  /** Rendered size in CSS px (the canvas is square). */
  size?: number;
  /** Livelier motion while typing / streaming. */
  active?: boolean;
  className?: string;
}

type Ctx = CanvasRenderingContext2D;

/** A smooth, closed, organically wobbling blob path around (c, c). */
function blobPath(c: number, radius: number, t: number, amp: number, phase: number): Path2D {
  const K = 72;
  const xs = new Float32Array(K);
  const ys = new Float32Array(K);
  for (let k = 0; k < K; k++) {
    const a = (k / K) * Math.PI * 2;
    // Gentle low-frequency breathing + fine edge ripples (rounder, like a
    // jelly membrane rather than a lumpy blob).
    const w =
      1 +
      amp *
        (0.5 * Math.sin(3 * a + t * 0.9 + phase) +
          0.32 * Math.sin(5 * a - t * 1.25 + 1.7 + phase) +
          0.22 * Math.sin(2 * a - t * 0.55 + 2.1 + phase)) +
      amp * 0.34 *
        (0.55 * Math.sin(9 * a + t * 2.2 + phase) +
          0.4 * Math.sin(13 * a - t * 2.8 + 0.9) +
          0.25 * Math.sin(17 * a + t * 3.4 + 2.3));
    xs[k] = c + Math.cos(a) * radius * w;
    ys[k] = c + Math.sin(a) * radius * w;
  }
  const p = new Path2D();
  p.moveTo((xs[K - 1] + xs[0]) / 2, (ys[K - 1] + ys[0]) / 2);
  for (let k = 0; k < K; k++) {
    const n = (k + 1) % K;
    p.quadraticCurveTo(xs[k], ys[k], (xs[k] + xs[n]) / 2, (ys[k] + ys[n]) / 2);
  }
  p.closePath();
  return p;
}

/** Soft-edged core sphere sprite: lime top → mint → emerald → deep teal. */
function makeCoreSprite(px: number): HTMLCanvasElement {
  const s = document.createElement("canvas");
  s.width = s.height = px;
  const g = s.getContext("2d")!;
  const lin = g.createLinearGradient(0, 0, 0, px);
  lin.addColorStop(0.0, "rgb(236,250,160)"); // warm lime (the reference's orange)
  lin.addColorStop(0.3, "rgb(196,244,158)"); // lime-mint
  lin.addColorStop(0.5, "rgb(112,226,178)"); // mint
  lin.addColorStop(0.7, "rgb(30,190,158)"); // PractiScale green
  lin.addColorStop(0.88, "rgb(14,142,134)"); // teal
  lin.addColorStop(1.0, "rgb(10,108,114)"); // deep teal
  g.fillStyle = lin;
  g.fillRect(0, 0, px, px);
  g.globalCompositeOperation = "destination-in";
  const mask = g.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
  mask.addColorStop(0, "rgba(0,0,0,1)");
  mask.addColorStop(0.5, "rgba(0,0,0,0.92)");
  mask.addColorStop(0.75, "rgba(0,0,0,0.42)");
  mask.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = mask;
  g.fillRect(0, 0, px, px);
  return s;
}

/** Evenly distributed points on a unit sphere (Fibonacci lattice). */
function spherePoints(n: number): Float32Array {
  const pts = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = golden * i;
    pts[i * 3] = Math.cos(th) * r;
    pts[i * 3 + 1] = y;
    pts[i * 3 + 2] = Math.sin(th) * r;
  }
  return pts;
}

export function BrainOrb({ size = 112, active = false, className }: BrainOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = size;
    canvas.width = Math.round(S * dpr);
    canvas.height = Math.round(S * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const c = S / 2;
    const R = S * 0.36; // membrane base radius (room left for the halo)
    const r = R * 0.6; // core radius
    const sprite = makeCoreSprite(Math.ceil(r * 2.4 * dpr));
    const N = Math.round(Math.min(1500, Math.max(300, (S * S) / 18)));
    const pts = spherePoints(N);
    const dotR = Math.max(0.45, S * 0.0045);
    const BUCKETS = 6;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let t = 0;
    let energy = activeRef.current ? 1 : 0;

    function frame(g: Ctx, dt: number) {
      const target = activeRef.current ? 1 : 0;
      energy += (target - energy) * Math.min(1, dt * 2.5);
      t += dt * (1 + energy * 0.9);

      g.clearRect(0, 0, S, S);

      // 1) Halo — a mint glow so the white membrane reads on a white page.
      const halo = g.createRadialGradient(c, c, R * 0.35, c, c, S * 0.5);
      halo.addColorStop(0, `rgba(23,195,165,${0.34 + energy * 0.14})`);
      halo.addColorStop(0.55, `rgba(120,228,190,${0.16 + energy * 0.06})`);
      halo.addColorStop(1, "rgba(120,228,190,0)");
      g.fillStyle = halo;
      g.fillRect(0, 0, S, S);

      const amp = 0.036 + energy * 0.024;
      const outer = blobPath(c, R, t, amp, 0);

      // 2) Membrane body — frosted, translucent, lit from the top-left.
      g.save();
      g.shadowColor = "rgba(10,110,95,0.22)";
      g.shadowBlur = S * 0.08;
      g.shadowOffsetY = S * 0.02;
      const body = g.createRadialGradient(c - R * 0.35, c - R * 0.4, R * 0.1, c, c, R * 1.15);
      body.addColorStop(0, "rgba(255,255,255,0.94)");
      body.addColorStop(0.55, "rgba(236,252,246,0.74)");
      body.addColorStop(1, "rgba(198,238,226,0.6)");
      g.fillStyle = body;
      g.fill(outer);
      g.restore();

      // 3) Inside the membrane: the drifting core, a frosted veil, the dot globe.
      g.save();
      g.clip(outer);

      const dx = Math.sin(t * 0.5) * R * 0.06;
      const dy = Math.cos(t * 0.37) * R * 0.06;
      const pulse = 1 + Math.sin(t * 1.1) * 0.03 + energy * 0.05;
      const d = r * 2.4 * pulse;
      g.globalAlpha = 0.95;
      g.drawImage(sprite, c - d / 2 + dx, c - d / 2 + dy, d, d);
      g.globalAlpha = 1;

      const veil = g.createRadialGradient(c, c, r * 0.55, c, c, R * 1.08);
      veil.addColorStop(0, "rgba(255,255,255,0.04)");
      veil.addColorStop(1, "rgba(255,255,255,0.6)");
      g.fillStyle = veil;
      g.fill(outer);

      // Dot globe: rotate about Y, tilt about X, draw the front hemisphere only,
      // brighter toward the viewer. Batched into depth buckets (one fill each).
      const rot = t * 0.32;
      const tilt = 0.38;
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      const ct = Math.cos(tilt);
      const st = Math.sin(tilt);
      const G = R * 0.98;
      const buckets: Path2D[] = Array.from({ length: BUCKETS }, () => new Path2D());
      for (let i = 0; i < N; i++) {
        const x = pts[i * 3];
        const y = pts[i * 3 + 1];
        const z = pts[i * 3 + 2];
        const x1 = x * cr + z * sr;
        const z1 = -x * sr + z * cr;
        const y2 = y * ct - z1 * st;
        const z2 = y * st + z1 * ct;
        if (z2 <= 0.04) continue;
        const px = c + x1 * G;
        const py = c + y2 * G;
        const b = Math.min(BUCKETS - 1, Math.floor(z2 * BUCKETS));
        buckets[b].moveTo(px + dotR, py);
        buckets[b].arc(px, py, dotR, 0, Math.PI * 2);
      }
      for (let b = 0; b < BUCKETS; b++) {
        g.fillStyle = `rgba(255,255,255,${0.1 + (b / (BUCKETS - 1)) * 0.62})`;
        g.fill(buckets[b]);
      }

      // Folds — frosted white bands: inner membranes at different depths and
      // speeds, stroked wide + soft (a white glow) like the reference's ripples.
      g.shadowColor = "rgba(255,255,255,0.9)";
      g.shadowBlur = S * 0.035;
      const folds: [number, number, number, number, number][] = [
        // [radius, speed, phase, width, alpha]
        [0.9, 1.15, 3, 0.03, 0.32],
        [0.76, 0.85, 5.2, 0.022, 0.24],
        [0.62, 1.35, 1.1, 0.016, 0.16],
      ];
      for (const [rad, speed, ph, w, a] of folds) {
        g.strokeStyle = `rgba(255,255,255,${a + energy * 0.08})`;
        g.lineWidth = Math.max(1, S * w);
        g.stroke(blobPath(c, R * rad, t * speed + ph, amp * 1.8, ph));
      }
      g.shadowBlur = 0;

      // Gloss — a soft specular highlight, top-left.
      const hl = g.createRadialGradient(c - R * 0.42, c - R * 0.52, 0, c - R * 0.42, c - R * 0.52, R * 0.6);
      hl.addColorStop(0, "rgba(255,255,255,0.85)");
      hl.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = hl;
      g.fillRect(0, 0, S, S);
      g.restore();

      // 4) Rim — a faint green edge under a bright white one.
      g.lineWidth = Math.max(1.5, S * 0.016);
      g.strokeStyle = "rgba(14,158,139,0.18)";
      g.stroke(outer);
      g.lineWidth = Math.max(1, S * 0.009);
      g.strokeStyle = "rgba(255,255,255,0.95)";
      g.stroke(outer);
    }

    if (reduce) {
      frame(ctx, 0);
      return;
    }

    let raf = 0;
    let last = performance.now();
    let onScreen = true;

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      frame(ctx, dt);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (raf || document.hidden || !onScreen) return;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    frame(ctx, 0);
    start();

    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      if (onScreen) start();
      else stop();
    });
    io.observe(canvas);
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVis);

    return () => {
      stop();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn("pointer-events-none select-none", className)}
      style={{ width: size, height: size }}
    />
  );
}

export { OrbAvatar };
