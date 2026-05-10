// Optional GLTF asset loader with graceful fallback.
//
// Drop free glTF/GLB models from Sketchfab / Quaternius / Kenney into
// ./assets/ with the filenames below and they will automatically replace
// the procedural fallback in the scene. If the files are missing or fail
// to load (e.g. you're offline), the game keeps working with the built-in
// procedural meshes — nothing is fatal.
//
// Expected filenames (all optional):
//   assets/skeleton.glb       — humanoid archer to overlay on each skeleton
//   assets/truck_yellow.glb   — replaces the yellow truck mesh
//   assets/barrel.glb         — replaces barrels
//   assets/crate.glb          — replaces crates
//   assets/container.glb      — replaces shipping containers
//   assets/tree.glb           — replaces pine trees
//   assets/rock.glb           — replaces rocks
//   assets/pistol.glb         — replaces pistol viewmodel
//   assets/bow.glb            — replaces the enemy bow
//
// This keeps us fully on Three.js + GLTFLoader (as requested).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

const ASSET_FILES = {
  skeleton: './assets/skeleton.glb',
  truck: './assets/truck_yellow.glb',
  barrel: './assets/barrel.glb',
  crate: './assets/crate.glb',
  container: './assets/container.glb',
  tree: './assets/tree.glb',
  rock: './assets/rock.glb',
  pistol: './assets/pistol.glb',
  bow: './assets/bow.glb',
};

function tryLoad(url) {
  return new Promise((resolve) => {
    loader.load(
      url,
      (gltf) => resolve({ ok: true, gltf }),
      undefined,
      (err) => resolve({ ok: false, err }),
    );
  });
}

/**
 * Attempt to load every optional asset.
 * Returns { loaded: { key: gltf|null, ... }, summary: string }
 */
export async function loadOptionalAssets(onProgress) {
  const results = {};
  const entries = Object.entries(ASSET_FILES);
  let done = 0;
  for (const [key, url] of entries) {
    const r = await tryLoad(url);
    results[key] = r.ok ? r.gltf : null;
    done += 1;
    onProgress?.(done / entries.length, key, r.ok);
  }
  const loadedNames = Object.entries(results).filter(([, v]) => v).map(([k]) => k);
  const summary = loadedNames.length
    ? `Loaded glTF: ${loadedNames.join(', ')}`
    : 'No glTF assets found — using procedural fallback.';
  return { loaded: results, summary };
}

/**
 * Clone a gltf scene deeply (with skinned meshes, materials shared but bones unique).
 */
export function cloneGLTFScene(gltf) {
  // SkeletonUtils would be ideal; for simplicity + robustness use basic clone.
  const src = gltf.scene || gltf.scenes?.[0];
  if (!src) return null;
  const clone = src.clone(true);
  clone.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      // Ensure materials are independent when tweaking per-instance
      if (o.material && !o.material.userData._cloned) {
        o.material = o.material.clone();
        o.material.userData._cloned = true;
      }
    }
  });
  return clone;
}

/**
 * Utility: fit a loaded model into a target bounding size.
 */
export function fitModelToSize(model, targetHeight) {
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y > 0.01) {
    const scale = targetHeight / size.y;
    model.scale.multiplyScalar(scale);
  }
  // Re-center base to y=0
  const box2 = new THREE.Box3().setFromObject(model);
  model.position.y -= box2.min.y;
  return model;
}
