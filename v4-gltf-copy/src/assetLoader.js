// Centralized async loader for glTF models + HDR environments.
//
// Uses the CDN-hosted three.js examples from jsDelivr (which serves them with
// CORS headers), so no local assets are needed. If a model fails to load
// (e.g. because the sandbox is offline), the caller receives a `null` value
// and is expected to fall back to a procedural placeholder so the game still
// plays.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { SkeletonUtils } from 'three/addons/utils/SkeletonUtils.js';

// Stable refs to the three.js r160 example assets, served with CORS from
// jsDelivr's github mirror.
const CDN_BASE = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/';

export const ASSET_URLS = {
  soldier: CDN_BASE + 'models/gltf/Soldier.glb',        // rigged humanoid, ~2MB
  collision: CDN_BASE + 'models/gltf/collision-world.glb', // industrial chunk (optional)
  hdri: CDN_BASE + 'textures/equirectangular/venice_sunset_1k.hdr',
};

export class AssetLoader {
  constructor() {
    this.gltfLoader = new GLTFLoader();
    this.hdrLoader = new RGBELoader();
    this.cache = new Map();
    this.onProgress = null;   // optional fn(loadedName, totalPercent)
  }

  _loadGLTF(url) {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(url, resolve, undefined, reject);
    });
  }

  _loadHDR(url) {
    return new Promise((resolve, reject) => {
      this.hdrLoader.load(url, resolve, undefined, reject);
    });
  }

  // Load everything at startup. Resolves with { soldier, hdri, ... } where
  // missing items are simply `null` so the caller can fall back gracefully.
  async loadAll(onProgress) {
    this.onProgress = onProgress || (() => {});
    const out = {};

    const steps = [
      { key: 'hdri',      label: 'Sky HDRI',        fn: () => this._loadHDR(ASSET_URLS.hdri) },
      { key: 'soldier',   label: 'Skeleton rig',    fn: () => this._loadGLTF(ASSET_URLS.soldier) },
    ];

    let done = 0;
    for (const step of steps) {
      this.onProgress(step.label, done / steps.length);
      try {
        const res = await withTimeout(step.fn(), 18000);
        this.cache.set(step.key, res);
        out[step.key] = res;
      } catch (err) {
        console.warn(`[AssetLoader] ${step.label} failed:`, err);
        out[step.key] = null;
      }
      done += 1;
      this.onProgress(step.label, done / steps.length);
    }
    return out;
  }

  // Deep-clone a rigged glTF (preserves skinned meshes + bones).
  cloneRigged(gltf) {
    if (!gltf || !gltf.scene) return null;
    const clone = SkeletonUtils.clone(gltf.scene);
    // Animations reference the *original* skeleton bones; to re-use them on
    // the clone you must rebind. We don't actually play any of Soldier.glb's
    // clips here — we drive the bones manually — so we just return the clone.
    return clone;
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

// Convenience: walk a glTF scene and find the first bone whose name matches
// any of the given substrings (case-insensitive).
export function findBone(root, ...patterns) {
  const lower = patterns.map(p => p.toLowerCase());
  let found = null;
  root.traverse(n => {
    if (found) return;
    if (!n.isBone && n.type !== 'Bone') return;
    const nm = (n.name || '').toLowerCase();
    for (const p of lower) {
      if (nm.includes(p)) { found = n; return; }
    }
  });
  return found;
}

// Collect the named bones we need to drive for a Mixamo-style rig.
// Returns `null` if the rig doesn't look right.
export function extractRig(root) {
  const rig = {
    hips: findBone(root, 'mixamorighips', 'hips'),
    spine: findBone(root, 'mixamorigspine2', 'mixamorigspine1', 'spine2', 'spine1', 'spine'),
    chest: findBone(root, 'mixamorigspine2', 'spine2', 'chest'),
    neck: findBone(root, 'mixamorigneck', 'neck'),
    head: findBone(root, 'mixamorighead', 'head'),
    leftShoulder: findBone(root, 'mixamorigleftshoulder', 'leftshoulder'),
    leftArm:  findBone(root, 'mixamorigleftarm', 'leftarm'),
    leftForeArm: findBone(root, 'mixamorigleftforearm', 'leftforearm'),
    leftHand: findBone(root, 'mixamorigletthand', 'mixamorigleft_hand', 'mixamoriglefthand', 'lefthand'),
    rightShoulder: findBone(root, 'mixamorigrightshoulder', 'rightshoulder'),
    rightArm: findBone(root, 'mixamorigrightarm', 'rightarm'),
    rightForeArm: findBone(root, 'mixamorigrightforearm', 'rightforearm'),
    rightHand: findBone(root, 'mixamorigrighthand', 'righthand'),
    leftUpLeg: findBone(root, 'mixamorigleftupleg', 'leftupleg'),
    leftLeg:   findBone(root, 'mixamorigleftleg', 'leftleg'),
    leftFoot:  findBone(root, 'mixamorigleftfoot', 'leftfoot'),
    rightUpLeg: findBone(root, 'mixamorigrightupleg', 'rightupleg'),
    rightLeg:   findBone(root, 'mixamorigrightleg', 'rightleg'),
    rightFoot:  findBone(root, 'mixamorigrightfoot', 'rightfoot'),
  };
  if (!rig.hips || !rig.leftHand || !rig.rightHand) return null;
  // Stash each bone's rest-pose quaternion so we can blend toward it.
  for (const key of Object.keys(rig)) {
    const b = rig[key];
    if (b) b.userData.restQuat = b.quaternion.clone();
  }
  return rig;
}
