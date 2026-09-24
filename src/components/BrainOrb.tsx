"use client";

// The PractiScale brain: a revolving 3D brain drawn on a canvas.
//
// ONE continuous cerebrum surface (realistic proportions, a single longitudinal
// fissure groove on top, flat base, temporal lobes, occipital taper) carries the
// brain's signature texture: meandering gyri/sulci drawn as contour lines of a
// folding field, plus the landmark fissures (longitudinal, lateral, central). A
// small striated cerebellum sits under the back. A soft green body fill gives it
// volume; lines fade toward the silhouette for real 3D depth; synapse sparkles
// fire on the visible side; a tilted orbit ring and spark circle it.
//
// One canvas per instance; geometry is built once per size and cached. Pauses
// off-screen / in hidden tabs; a single still frame for prefers-reduced-motion.
// `active` (typing / streaming) = faster spin + more synapse activity.

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface BrainOrbProps {
  /** Rendered size in CSS px (the canvas is square). */
  size?: number;
  /** Livelier motion while typing / streaming. */
  active?: boolean;
  className?: string;
}

type V3 = [number, number, number];

// Cerebrum half-extents: length (z, front +), width (x), height (y).
const A = 0.62;
const B = 0.47;
const C = 0.44;

function dirOf(th: number, ph: number): V3 {
  const ct = Math.cos(th);
  return [ct * Math.sin(ph), Math.sin(th), ct * Math.cos(ph)];
}

/** Folding field (mirrored left/right); its zero-contours are the sulci. */
function fold(d: V3): number {
  const dx = Math.abs(d[0]);
  const dy = d[1];
  const dz = d[2];
  const qx = dx + 0.3 * Math.sin(4.3 * dy + 1.1) + 0.22 * Math.sin(5.1 * dz + 2.3);
  const qy = dy + 0.3 * Math.sin(3.7 * dz + 0.4) + 0.22 * Math.sin(4.9 * dx + 1.9);
  const qz = dz + 0.3 * Math.sin(4.1 * dx + 2.7) + 0.22 * Math.sin(5.3 * dy + 0.8);
  const F = 10.8;
  return (
    Math.sin(F * qx) * Math.cos(F * 0.94 * qy) +
    Math.sin(F * 1.03 * qy) * Math.cos(F * 0.97 * qz) +
    Math.sin(F * 0.95 * qz) * Math.cos(F * 1.05 * qx)
  );
}

/** A point on the cerebrum surface for unit direction d. */
function cerebrum(d: V3): V3 {
  let x = B * d[0];
  let y = C * d[1];
  let z = A * d[2];
  // Occipital taper toward the back.
  if (d[2] < -0.45) {
    const k = (-d[2] - 0.45) / 0.55;
    x *= 1 - 0.18 * k;
    y *= 1 - 0.08 * k;
  }
  // Temporal lobes: lower-lateral bulge toward the front.
  const tw = Math.exp(-(((d[1] + 0.4) / 0.28) ** 2)) * Math.exp(-(((d[2] - 0.2) / 0.4) ** 2)) * Math.abs(d[0]);
  x *= 1 + 0.14 * tw;
  y -= 0.05 * tw;
  // Flat base.
  if (y < -0.2) y = -0.2 + (y + 0.2) * 0.45;
  // Longitudinal fissure: one groove along the top midline (not two blobs).
  const cleft = 0.085 * Math.exp(-((d[0] / 0.07) ** 2)) * Math.max(0, Math.min(1, (d[1] + 0.05) / 0.35));
  const s = 1 - cleft + 0.016 * fold(d);
  return [x * s, y * s + 0.06, z * s];
}

const CB_CENTER: V3 = [0, -0.17, -0.42];

/** True when p lies inside the cerebrum (so it would be hidden in reality). */
function insideCerebrum(p: V3): boolean {
  const v: V3 = [p[0], p[1] - 0.06, p[2]];
  const r = Math.hypot(v[0], v[1], v[2]);
  if (r === 0) return true;
  const d: V3 = [v[0] / r, v[1] / r, v[2] / r];
  const s = cerebrum(d);
  return r < Math.hypot(s[0], s[1] - 0.06, s[2]) * 0.97;
}
const CB_R: V3 = [0.29, 0.12, 0.17];

interface Seg {
  a: V3;
  b: V3;
  /** Outward normal (unit) at the segment, for facing tests. */
  n: V3;
  /** Height 0 (base) … 1 (crown), for colour. */
  h: number;
}

interface BrainGeometry {
  /** Fold contour segments (the gyri texture) + cerebellum folia. */
  folds: Seg[];
  /** Landmark fissures (drawn stronger). */
  strong: Seg[];
  /** Body fill samples: position, normal, height. */
  body: { p: V3; n: V3; h: number }[];
}

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const heightOf = (p: V3) => Math.max(0, Math.min(1, (p[1] + 0.32) / 0.82));

/** Polyline through surface directions → segments. */
function polyline(dirs: V3[], map: (d: V3) => V3, out: Seg[]) {
  for (let i = 0; i < dirs.length - 1; i++) {
    const a = map(dirs[i]);
    const b = map(dirs[i + 1]);
    const n = norm([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.06, (a[2] + b[2]) / 2]);
    out.push({ a, b, n, h: heightOf(a) });
  }
}

function buildGeometry(): BrainGeometry {
  const folds: Seg[] = [];
  const strong: Seg[] = [];

  // --- Gyri: zero-contours of the folding field (marching squares on θ,φ) --
  const NT = 70;
  const NP = 150;
  const th0 = -Math.PI / 2 + 0.08;
  const th1 = Math.PI / 2 - 0.08;
  const f: number[][] = [];
  for (let i = 0; i <= NT; i++) {
    const th = th0 + ((th1 - th0) * i) / NT;
    const row: number[] = [];
    for (let j = 0; j <= NP; j++) row.push(fold(dirOf(th, -Math.PI + (2 * Math.PI * j) / NP)));
    f.push(row);
  }
  const at = (i: number, j: number): [number, number] => [
    th0 + ((th1 - th0) * i) / NT,
    -Math.PI + (2 * Math.PI * j) / NP,
  ];
  const lerp = (p: [number, number], q: [number, number], fa: number, fb: number): [number, number] => {
    const t = fa / (fa - fb);
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  };
  const addSeg = (u: [number, number], v: [number, number]) => {
    const du = dirOf(u[0], u[1]);
    const dv = dirOf(v[0], v[1]);
    // Keep the fissure groove and the underside clean.
    const mid = norm([(du[0] + dv[0]) / 2, (du[1] + dv[1]) / 2, (du[2] + dv[2]) / 2]);
    if (Math.abs(mid[0]) < 0.07 && mid[1] > 0) return;
    if (mid[1] < -0.72) return;
    const a = cerebrum(du);
    const b = cerebrum(dv);
    folds.push({ a, b, n: mid, h: heightOf(a) });
  };
  for (let i = 0; i < NT; i++) {
    for (let j = 0; j < NP; j++) {
      const p00 = at(i, j);
      const p01 = at(i, j + 1);
      const p10 = at(i + 1, j);
      const p11 = at(i + 1, j + 1);
      const f00 = f[i][j];
      const f01 = f[i][j + 1];
      const f10 = f[i + 1][j];
      const f11 = f[i + 1][j + 1];
      const pts: [number, number][] = [];
      if (f00 > 0 !== f01 > 0) pts.push(lerp(p00, p01, f00, f01));
      if (f01 > 0 !== f11 > 0) pts.push(lerp(p01, p11, f01, f11));
      if (f11 > 0 !== f10 > 0) pts.push(lerp(p11, p10, f11, f10));
      if (f10 > 0 !== f00 > 0) pts.push(lerp(p10, p00, f10, f00));
      if (pts.length === 2) addSeg(pts[0], pts[1]);
      else if (pts.length === 4) {
        addSeg(pts[0], pts[1]);
        addSeg(pts[2], pts[3]);
      }
    }
  }

  // --- Landmark fissures ---------------------------------------------------
  const K = 48;
  // Longitudinal fissure: along the top midline, front base → back base.
  {
    const dirs: V3[] = [];
    for (let k = 0; k <= K; k++) {
      const a = -0.25 + ((Math.PI + 0.5) * k) / K;
      dirs.push([0, Math.sin(a), Math.cos(a)]);
    }
    polyline(dirs, cerebrum, strong);
  }
  for (const side of [-1, 1]) {
    // Lateral (Sylvian) fissure: front-low → back, rising.
    const s0: V3 = [side * 0.72, -0.36, 0.58];
    const s1: V3 = [side * 0.93, 0.08, -0.28];
    const dirs: V3[] = [];
    for (let k = 0; k <= K; k++) {
      const t = k / K;
      dirs.push(norm([s0[0] + (s1[0] - s0[0]) * t, s0[1] + (s1[1] - s0[1]) * t + 0.05 * Math.sin(t * 6), s0[2] + (s1[2] - s0[2]) * t]));
    }
    polyline(dirs, cerebrum, strong);
    // Central sulcus: from near the top midline down to the lateral fissure.
    const c0: V3 = [side * 0.12, 0.98, 0.06];
    const c1: V3 = [side * 0.86, -0.02, 0.2];
    const cd: V3[] = [];
    for (let k = 0; k <= K; k++) {
      const t = k / K;
      cd.push(norm([c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t + 0.06 * Math.sin(t * 9)]));
    }
    polyline(cd, cerebrum, strong);
  }

  // --- Cerebellum: folia as horizontal rings --------------------------------
  const cbMap = (d: V3): V3 => [
    CB_CENTER[0] + d[0] * CB_R[0],
    CB_CENTER[1] + d[1] * CB_R[1],
    CB_CENTER[2] + d[2] * CB_R[2],
  ];
  for (let r = 0; r < 8; r++) {
    const lat = -1.25 + r * 0.26; // rings from the bottom up to just under the cerebrum
    const dirs: V3[] = [];
    for (let k = 0; k <= 72; k++) dirs.push(dirOf(lat, (2 * Math.PI * k) / 72)); // full ring; facing hides the far side
    for (let i = 0; i < dirs.length - 1; i++) {
      const a = cbMap(dirs[i]);
      const b = cbMap(dirs[i + 1]);
      if (insideCerebrum([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2])) continue;
      folds.push({ a, b, n: norm([(dirs[i][0] + dirs[i + 1][0]) / 2, (dirs[i][1] + dirs[i + 1][1]) / 2, (dirs[i][2] + dirs[i + 1][2]) / 2]), h: 0 });
    }
  }

  // --- Body fill samples (Fibonacci) ---------------------------------------
  const body: { p: V3; n: V3; h: number }[] = [];
  const NB = 1100;
  for (let i = 0; i < NB; i++) {
    const y = 1 - ((i + 0.5) / NB) * 2;
    const r = Math.sqrt(1 - y * y);
    const t = Math.PI * (3 - Math.sqrt(5)) * i;
    const d: V3 = [Math.cos(t) * r, y, Math.sin(t) * r];
    const p = cerebrum(d);
    body.push({ p, n: d, h: heightOf(p) });
  }
  for (let i = 0; i < 160; i++) {
    const y = 1 - ((i + 0.5) / 160) * 2;
    const r = Math.sqrt(1 - y * y);
    const t = Math.PI * (3 - Math.sqrt(5)) * i;
    const d: V3 = [Math.cos(t) * r, y, Math.sin(t) * r];
    const cp = cbMap(d);
    if (insideCerebrum(cp)) continue;
    body.push({ p: cp, n: d, h: 0.05 });
  }

  return { folds, strong, body };
}

let GEOMETRY: BrainGeometry | null = null;
function geometry(): BrainGeometry {
  if (!GEOMETRY) GEOMETRY = buildGeometry();
  return GEOMETRY;
}

// Line colour by height: crown green → base deep teal.
const LINE = ["12,104,112", "14,140,125", "24,160,120"];
// Body fill by height: base teal → crown lime-mint.
const FILL = ["70,190,170", "120,220,185", "185,240,160"];

interface Spark {
  i: number;
  age: number;
  life: number;
}

export function BrainOrb({ size = 128, active = false, className }: BrainOrbProps) {
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

    const { folds, strong, body } = geometry();
    const cx = S / 2;
    const cy = S / 2;
    const R = S * 0.52;
    const lineW = Math.max(0.7, S * 0.0064);
    const strongW = Math.max(0.9, S * 0.009);
    const fillR = S * 0.04;

    const sparks: Spark[] = [];
    // Projected body splats, reused every frame (sparkles read from these).
    const bodyX = new Float32Array(body.length);
    const bodyY = new Float32Array(body.length);
    const bodyZ = new Float32Array(body.length);
    let seed = 11;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let t = 0;
    let yaw = -0.75;
    let energy = activeRef.current ? 1 : 0;

    function frame(g: CanvasRenderingContext2D, dt: number) {
      const target = activeRef.current ? 1 : 0;
      energy += (target - energy) * Math.min(1, dt * 2.5);
      t += dt;
      yaw += dt * (0.34 + energy * 0.45);
      const pitch = 0.22 + Math.sin(t * 0.3) * 0.04;
      const bob = Math.sin(t * 0.9) * S * 0.008;
      const cyw = Math.cos(yaw);
      const syw = Math.sin(yaw);
      const cp = Math.cos(pitch);
      const sp = Math.sin(pitch);

      // Rotate (yaw about y, then pitch about x) → [x, y, z(toward viewer)].
      const rot = (v: V3): V3 => {
        const x1 = v[0] * cyw + v[2] * syw;
        const z1 = -v[0] * syw + v[2] * cyw;
        return [x1, v[1] * cp - z1 * sp, v[1] * sp + z1 * cp];
      };
      const proj = (v: V3): [number, number] => {
        const q = rot(v);
        const persp = 1 / (1 - q[2] * 0.16);
        return [cx + q[0] * R * persp, cy + bob - q[1] * R * persp];
      };

      g.clearRect(0, 0, S, S);

      // Halo + contact shadow.
      const halo = g.createRadialGradient(cx, cy, S * 0.08, cx, cy, S * 0.5);
      halo.addColorStop(0, `rgba(23,195,165,${0.16 + energy * 0.08})`);
      halo.addColorStop(0.6, "rgba(120,228,190,0.06)");
      halo.addColorStop(1, "rgba(120,228,190,0)");
      g.fillStyle = halo;
      g.fillRect(0, 0, S, S);
      g.save();
      g.translate(cx, cy + S * 0.36);
      g.scale(1, 0.2);
      const sh = g.createRadialGradient(0, 0, 0, 0, 0, S * 0.3);
      sh.addColorStop(0, "rgba(10,90,80,0.16)");
      sh.addColorStop(1, "rgba(10,90,80,0)");
      g.fillStyle = sh;
      g.beginPath();
      g.arc(0, 0, S * 0.3, 0, Math.PI * 2);
      g.fill();
      g.restore();

      // Orbit ring (back half now, front half last).
      const ringA = S * 0.43;
      const ringB = S * 0.1;
      const tilt = -0.26;
      const ring = (from: number, to: number, alpha: number) => {
        g.save();
        g.translate(cx, cy + bob + S * 0.02);
        g.rotate(tilt);
        g.beginPath();
        g.ellipse(0, 0, ringA, ringB, 0, from, to);
        g.strokeStyle = `rgba(16,163,136,${alpha})`;
        g.lineWidth = Math.max(0.75, S * 0.006);
        g.stroke();
        g.restore();
      };
      ring(Math.PI, Math.PI * 2, 0.14 + energy * 0.06);

      // Body: soft splats (back first, fainter), coloured by height.
      const bodyPaths = Array.from({ length: 6 }, () => new Path2D());

      for (let i = 0; i < body.length; i++) {
        const b = body[i];
        const [x, y] = proj(b.p);
        const nz = rot(b.n)[2];
        bodyX[i] = x;
        bodyY[i] = y;
        bodyZ[i] = nz;
        const band = b.h > 0.66 ? 2 : b.h > 0.33 ? 1 : 0;
        const front = nz > 0 ? 1 : 0;
        const path = bodyPaths[band * 2 + front];
        path.moveTo(x + fillR, y);
        path.arc(x, y, fillR, 0, Math.PI * 2);
      }
      for (let band = 0; band < 3; band++) {
        g.fillStyle = `rgba(${FILL[band]},0.035)`;
        g.fill(bodyPaths[band * 2]);
        g.fillStyle = `rgba(${FILL[band]},0.1)`;
        g.fill(bodyPaths[band * 2 + 1]);
      }

      // Folds: facing-weighted strokes (fade toward the silhouette).
      const FB = 4;
      const foldPaths = Array.from({ length: LINE.length * FB }, () => new Path2D());
      const backPath = new Path2D();
      const drawSegs = (segs: Seg[], paths: Path2D[], back: Path2D | null) => {
        for (let i = 0; i < segs.length; i++) {
          const s = segs[i];
          const nz = rot(s.n)[2];
          const [ax, ay] = proj(s.a);
          const [bx, by] = proj(s.b);
          if (nz <= 0) {
            if (back && nz > -0.55) {
              back.moveTo(ax, ay);
              back.lineTo(bx, by);
            }
            continue;
          }
          const k = Math.min(FB - 1, Math.floor(nz * FB));
          const band = s.h > 0.62 ? 2 : s.h > 0.3 ? 1 : 0;
          const path = paths[band * FB + k];
          path.moveTo(ax, ay);
          path.lineTo(bx, by);
        }
      };
      drawSegs(folds, foldPaths, backPath);
      g.lineCap = "butt";
      g.lineWidth = lineW;
      g.strokeStyle = "rgba(14,140,125,0.07)";
      g.stroke(backPath);
      for (let band = 0; band < LINE.length; band++) {
        for (let k = 0; k < FB; k++) {
          g.strokeStyle = `rgba(${LINE[band]},${0.18 + k * 0.2})`;
          g.stroke(foldPaths[band * FB + k]);
        }
      }

      // Landmark fissures + cerebellum folia (stronger).
      const strongPaths = Array.from({ length: LINE.length * FB }, () => new Path2D());
      drawSegs(strong, strongPaths, null);
      g.lineWidth = strongW;
      for (let band = 0; band < LINE.length; band++) {
        for (let k = 0; k < FB; k++) {
          g.strokeStyle = `rgba(${LINE[band]},${0.28 + k * 0.2})`;
          g.stroke(strongPaths[band * FB + k]);
        }
      }

      // Synapse sparkles on the visible side.
      const want = Math.round(7 + energy * 12);
      while (sparks.length < want) sparks.push({ i: Math.floor(rnd() * body.length), age: 0, life: 0.7 + rnd() * 0.9 });
      for (let i = sparks.length - 1; i >= 0; i--) {
        const sp = sparks[i];
        sp.age += dt;
        if (sp.age >= sp.life) {
          sparks.splice(i, 1);
          continue;
        }
        const x = bodyX[sp.i];
        const y = bodyY[sp.i];
        const nz = bodyZ[sp.i];
        if (nz < 0.2) continue;
        const env = Math.sin((sp.age / sp.life) * Math.PI);
        const rr = S * 0.03 * (0.6 + env * 0.6);
        const glow = g.createRadialGradient(x, y, 0, x, y, rr);
        glow.addColorStop(0, `rgba(222,255,176,${0.95 * env})`);
        glow.addColorStop(0.4, `rgba(110,225,150,${0.4 * env})`);
        glow.addColorStop(1, "rgba(23,195,165,0)");
        g.fillStyle = glow;
        g.beginPath();
        g.arc(x, y, rr, 0, Math.PI * 2);
        g.fill();
      }

      // Ring front half + its spark.
      ring(0, Math.PI, 0.3 + energy * 0.12);
      const ang = t * (0.9 + energy * 0.6);
      const ex = Math.cos(ang) * ringA;
      const ey = Math.sin(ang) * ringB;
      const sx = cx + ex * Math.cos(tilt) - ey * Math.sin(tilt);
      const sy = cy + bob + S * 0.02 + ex * Math.sin(tilt) + ey * Math.cos(tilt);
      const front = Math.sin(ang) > 0;
      const sr = S * (front ? 0.03 : 0.018);
      const spk = g.createRadialGradient(sx, sy, 0, sx, sy, sr);
      spk.addColorStop(0, `rgba(222,255,176,${front ? 1 : 0.45})`);
      spk.addColorStop(1, "rgba(23,195,165,0)");
      g.fillStyle = spk;
      g.beginPath();
      g.arc(sx, sy, sr, 0, Math.PI * 2);
      g.fill();
    }

    if (reduce) {
      frame(ctx, 0);
      return;
    }

    let raf = 0;
    let last = performance.now();
    let onScreen = true;

    const FRAME_MS = 1000 / 30;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const elapsed = now - last;
      if (elapsed < FRAME_MS) return;
      last = now;
      frame(ctx, Math.min(0.1, elapsed / 1000));
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
