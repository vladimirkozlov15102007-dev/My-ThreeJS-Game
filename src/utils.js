// Small shared helpers
import * as THREE from 'three';

export const V0 = new THREE.Vector3();
export const UP = new THREE.Vector3(0, 1, 0);

export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b));
export const choose = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (a, b, t) => { t = clamp((t - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Seeded RNG (mulberry32) so level layout feels deterministic per session if needed
export function makeRng(seed = 1337) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function disposeObject(obj) {
  obj.traverse?.((c) => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
      else c.material.dispose();
    }
  });
}

// AABB-ish circle-vs-box collision for a cylinder player vs axis-aligned boxes.
// Box = { min:Vector3, max:Vector3 }
export function resolveCircleVsBoxes(pos, radius, boxes) {
  for (const b of boxes) {
    if (pos.y + 1.0 < b.min.y || pos.y - 1.0 > b.max.y) continue;
    const cx = clamp(pos.x, b.min.x, b.max.x);
    const cz = clamp(pos.z, b.min.z, b.max.z);
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius && d2 > 1e-8) {
      const d = Math.sqrt(d2);
      const push = (radius - d);
      pos.x += (dx / d) * push;
      pos.z += (dz / d) * push;
    } else if (d2 === 0) {
      // inside: push out along shortest axis
      const toL = pos.x - b.min.x, toR = b.max.x - pos.x;
      const toB = pos.z - b.min.z, toT = b.max.z - pos.z;
      const m = Math.min(toL, toR, toB, toT);
      if (m === toL) pos.x = b.min.x - radius;
      else if (m === toR) pos.x = b.max.x + radius;
      else if (m === toB) pos.z = b.min.z - radius;
      else pos.z = b.max.z + radius;
    }
  }
}

// Test if a 2D point is inside an axis-aligned box at given y
export function pointInBox2D(x, z, b) {
  return x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z;
}

// Simple line-segment vs axis-aligned box intersection (for bullets / arrows / LOS).
// Returns t in [0,1] or -1.
export function raySegBoxHit(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0, tmax = 1;
  for (const axis of [0, 1, 2]) {
    const o = axis === 0 ? ox : axis === 1 ? oy : oz;
    const d = axis === 0 ? dx : axis === 1 ? dy : dz;
    const lo = axis === 0 ? b.min.x : axis === 1 ? b.min.y : b.min.z;
    const hi = axis === 0 ? b.max.x : axis === 1 ? b.max.y : b.max.z;
    if (Math.abs(d) < 1e-8) { if (o < lo || o > hi) return -1; continue; }
    let t1 = (lo - o) / d, t2 = (hi - o) / d;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}
