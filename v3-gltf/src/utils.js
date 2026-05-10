// Shared helpers.
import * as THREE from 'three';

export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b));
export const choose = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (a, b, t) => { t = clamp((t - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Resolve a vertical cylinder vs axis-aligned boxes. Modifies `pos` in place.
export function resolveCircleVsBoxes(pos, radius, boxes, height = 1.0) {
  for (const b of boxes) {
    if (pos.y + height < b.min.y || pos.y - height > b.max.y) continue;
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

// Line-segment vs AABB. Returns t in [0,1] or -1.
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

// Smooth-follow a yaw angle; handles wraparound.
export function approachYaw(cur, target, maxStep) {
  let diff = target - cur;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) < maxStep) return target;
  return cur + Math.sign(diff) * maxStep;
}

// Disposer for GLTF scenes after they're discarded.
export function disposeHierarchy(root) {
  root.traverse?.(o => {
    if (o.geometry) o.geometry.dispose?.();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach(m => m.dispose?.());
      else o.material.dispose?.();
    }
  });
}
