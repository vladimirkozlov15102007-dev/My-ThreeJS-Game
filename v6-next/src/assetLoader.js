// Central async loader for a real rigged glTF character + HDR environment.
//
// Tries multiple CDN mirrors for each asset so a single outage doesn't break
// the whole game.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const BASES = [
  'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/',
  'https://raw.githubusercontent.com/mrdoob/three.js/r160/examples/',
  'https://unpkg.com/three@0.160.0/examples/',
];

export const ASSET_PATHS = {
  // Rigged humanoid: 65 bones (mixamorig:*), 4 animations (Idle/Walk/Run/TPose),
  // ~2MB. Identical bone structure to Mixamo so we can overlay a bow-draw pose.
  soldier: 'models/gltf/Soldier.glb',
  // 1K equirectangular sunset HDR for real PBR reflections.
  hdri:    'textures/equirectangular/venice_sunset_1k.hdr',
};

function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

function loadWithFallback(loader, relPath, timeoutMs = 22000) {
  return new Promise(async (resolve, reject) => {
    let lastErr = null;
    for (const base of BASES) {
      try {
        const res = await withTimeout(new Promise((res, rej) => {
          loader.load(base + relPath, res, undefined, rej);
        }), timeoutMs);
        return resolve(res);
      } catch (err) { lastErr = err; }
    }
    reject(lastErr || new Error('all CDNs failed'));
  });
}

export class AssetLoader {
  constructor() {
    this.gltf = new GLTFLoader();
    this.hdr = new RGBELoader();
  }

  async loadAll(onProgress = () => {}) {
    const out = {};
    const steps = [
      { key: 'hdri',    label: 'Sky HDRI',          fn: () => loadWithFallback(this.hdr,  ASSET_PATHS.hdri) },
      { key: 'soldier', label: 'Character rig (Soldier.glb)', fn: () => loadWithFallback(this.gltf, ASSET_PATHS.soldier) },
    ];

    let done = 0;
    for (const step of steps) {
      onProgress(step.label, done / steps.length);
      try {
        out[step.key] = await step.fn();
      } catch (err) {
        console.warn(`[AssetLoader] ${step.label} failed:`, err);
        out[step.key] = null;
      }
      done += 1;
      onProgress(step.label, done / steps.length);
    }
    return out;
  }
}
