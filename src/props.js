// Detailed procedural prop builders.
// Everything here builds complex THREE.Group meshes (staves, rivets, planks,
// corrugated panels, wheels with hubs, tapered branches) so the scene reads
// as "glTF-ish" geometry without needing external assets.
//
// Each factory returns { group, colliderBoxes: [{ min:[x,y,z], max:[x,y,z] }] }
// so the level builder can register collisions.
import * as THREE from 'three';
import { rand } from './utils.js';

// ---------- Cached materials ----------
const _mats = {};
function mat(key, make) { if (!_mats[key]) _mats[key] = make(); return _mats[key]; }

const woodPlank = () => mat('woodPlank', () => new THREE.MeshStandardMaterial({
  color: 0x6e4a29, roughness: 0.9, metalness: 0.02,
}));
const woodDark = () => mat('woodDark', () => new THREE.MeshStandardMaterial({
  color: 0x442a18, roughness: 0.95, metalness: 0.02,
}));
const ironBand = () => mat('ironBand', () => new THREE.MeshStandardMaterial({
  color: 0x2e2a25, roughness: 0.55, metalness: 0.75,
}));
const rustIron = () => mat('rustIron', () => new THREE.MeshStandardMaterial({
  color: 0x5a3a22, roughness: 0.65, metalness: 0.6,
}));
const rivetMat = () => mat('rivet', () => new THREE.MeshStandardMaterial({
  color: 0x6a5a3a, roughness: 0.35, metalness: 0.95,
}));
const paintedMetal = (color = 0x6b6e70) => new THREE.MeshStandardMaterial({
  color, roughness: 0.55, metalness: 0.55,
});
const rockMat = () => mat('rock', () => new THREE.MeshStandardMaterial({
  color: 0x6b665e, roughness: 0.95, metalness: 0.05, flatShading: true,
}));
const barkMat = () => mat('bark', () => new THREE.MeshStandardMaterial({
  color: 0x3d2a1b, roughness: 1.0, metalness: 0.0, flatShading: true,
}));
const leafMat = () => mat('leaf', () => new THREE.MeshStandardMaterial({
  color: 0x3e5c24, roughness: 1.0, flatShading: true,
}));
const leafMatDry = () => mat('leafDry', () => new THREE.MeshStandardMaterial({
  color: 0x6a5a22, roughness: 1.0, flatShading: true,
}));
const tireMat = () => mat('tire', () => new THREE.MeshStandardMaterial({
  color: 0x0e0e0e, roughness: 0.95, metalness: 0.0,
}));
const hubMat = () => mat('hub', () => new THREE.MeshStandardMaterial({
  color: 0x2a2a2a, roughness: 0.55, metalness: 0.9,
}));
const glassMat = () => mat('glass', () => new THREE.MeshStandardMaterial({
  color: 0x1f2c33, roughness: 0.08, metalness: 0.75, transparent: true, opacity: 0.55,
}));
const yellowMat = () => mat('yellow', () => new THREE.MeshStandardMaterial({
  color: 0xd9a614, roughness: 0.55, metalness: 0.4,
}));
const yellowDirty = () => mat('yellowDirty', () => new THREE.MeshStandardMaterial({
  color: 0xa47d12, roughness: 0.85, metalness: 0.25,
}));
const chrome = () => mat('chrome', () => new THREE.MeshStandardMaterial({
  color: 0x9aa0a2, roughness: 0.25, metalness: 0.95,
}));
const headlightMat = () => mat('headlight', () => new THREE.MeshStandardMaterial({
  color: 0xfff1c4, emissive: 0xfff1c4, emissiveIntensity: 0.5, roughness: 0.4,
}));
const redMat = () => mat('red', () => new THREE.MeshStandardMaterial({
  color: 0x7a1414, emissive: 0x400707, emissiveIntensity: 0.3, roughness: 0.6,
}));

// ---------- BARREL (staves + 2-3 iron rings + lid) ----------
export function buildBarrel({ x, z, y = 0, radius = 0.42, height = 1.1, color = null, rng = Math.random } = {}) {
  const g = new THREE.Group();
  const staveCount = 16;
  const staveWidth = (2 * Math.PI * radius) / staveCount * 0.92;
  const staveThick = 0.05;
  const staveMat = color ? new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.4 }) : rustIron();

  for (let i = 0; i < staveCount; i++) {
    const a = (i / staveCount) * Math.PI * 2;
    const sx = Math.cos(a) * (radius - staveThick * 0.5);
    const sz = Math.sin(a) * (radius - staveThick * 0.5);
    const stave = new THREE.Mesh(new THREE.BoxGeometry(staveWidth, height, staveThick), staveMat);
    stave.position.set(sx, height / 2, sz);
    stave.rotation.y = -a + Math.PI / 2;
    g.add(stave);
  }
  // Iron rings (torus)
  const ringGeom = new THREE.TorusGeometry(radius + 0.005, 0.025, 4, 24);
  for (const ry of [0.12, height * 0.5, height - 0.12]) {
    const ring = new THREE.Mesh(ringGeom, ironBand());
    ring.rotation.x = Math.PI / 2;
    ring.position.y = ry;
    g.add(ring);
  }
  // Top lid
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(radius - 0.01, radius - 0.01, 0.04, 20), woodDark());
  lid.position.y = height - 0.02;
  g.add(lid);
  // Bottom
  const bottom = new THREE.Mesh(new THREE.CylinderGeometry(radius - 0.01, radius - 0.01, 0.04, 20), woodDark());
  bottom.position.y = 0.02;
  g.add(bottom);
  // Rust streaks (decals as thin dark planes wrapped around)
  for (let i = 0; i < 3; i++) {
    const a = rng() * Math.PI * 2;
    const streak = new THREE.Mesh(
      new THREE.PlaneGeometry(0.15, height * 0.6),
      new THREE.MeshStandardMaterial({ color: 0x3a1f10, roughness: 1, transparent: true, opacity: 0.5 }),
    );
    streak.position.set(Math.cos(a) * (radius + 0.001), height * 0.4 + rng() * 0.2, Math.sin(a) * (radius + 0.001));
    streak.lookAt(0, streak.position.y, 0);
    g.add(streak);
  }
  g.position.set(x, y, z);
  g.rotation.y = rng() * Math.PI * 2;
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return {
    group: g,
    colliderBoxes: [{
      min: [x - radius * 0.9, y, z - radius * 0.9],
      max: [x + radius * 0.9, y + height, z + radius * 0.9],
    }],
  };
}

// ---------- CRATE (6 faces, each made of planks + corner rivets) ----------
export function buildCrate({ x, z, y = 0, w = 1.0, h = 0.9, d = 1.0, rng = Math.random } = {}) {
  const g = new THREE.Group();
  const plankMat = woodPlank();
  const darkMat = woodDark();

  // Helper: build a panel made of planks + iron corner + rivets
  function panel(pw, ph, thickness, planksAlongWidth = true) {
    const pg = new THREE.Group();
    // Inner dark backing
    const back = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, thickness * 0.45), darkMat);
    pg.add(back);
    // Planks on the front face
    const nPlanks = planksAlongWidth ? 4 : 3;
    const plankSize = (planksAlongWidth ? ph : pw) / nPlanks;
    for (let i = 0; i < nPlanks; i++) {
      const plank = new THREE.Mesh(
        planksAlongWidth
          ? new THREE.BoxGeometry(pw - 0.02, plankSize - 0.02, thickness)
          : new THREE.BoxGeometry(plankSize - 0.02, ph - 0.02, thickness),
        plankMat,
      );
      if (planksAlongWidth) {
        plank.position.y = -ph / 2 + plankSize * (i + 0.5);
      } else {
        plank.position.x = -pw / 2 + plankSize * (i + 0.5);
      }
      plank.position.z = thickness * 0.25;
      // Slight rotation variation per plank for realism
      plank.rotation.z = (rng() - 0.5) * 0.005;
      pg.add(plank);
    }
    // Iron corner bands
    const bandThick = 0.015;
    const bandWidth = 0.05;
    const corners = [
      { pos: [-pw / 2 + bandWidth / 2, 0, thickness * 0.5 + bandThick / 2], size: [bandWidth, ph, bandThick] },
      { pos: [pw / 2 - bandWidth / 2, 0, thickness * 0.5 + bandThick / 2], size: [bandWidth, ph, bandThick] },
    ];
    for (const c of corners) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(...c.size), ironBand());
      band.position.set(...c.pos);
      pg.add(band);
    }
    // Rivets at band ends
    const rivetGeom = new THREE.SphereGeometry(0.012, 6, 6);
    for (const side of [-1, 1]) {
      for (const vy of [-ph / 2 + 0.07, ph / 2 - 0.07]) {
        const rv = new THREE.Mesh(rivetGeom, rivetMat());
        rv.position.set(side * (pw / 2 - bandWidth / 2), vy, thickness * 0.5 + bandThick);
        pg.add(rv);
      }
    }
    return pg;
  }

  const t = 0.05;
  // Front (+Z)
  const front = panel(w, h, t, true); front.position.set(0, h / 2, d / 2 - t / 2); g.add(front);
  // Back (-Z)
  const back = panel(w, h, t, true); back.position.set(0, h / 2, -d / 2 + t / 2); back.rotation.y = Math.PI; g.add(back);
  // Left (-X)
  const left = panel(d, h, t, true); left.position.set(-w / 2 + t / 2, h / 2, 0); left.rotation.y = -Math.PI / 2; g.add(left);
  // Right (+X)
  const right = panel(d, h, t, true); right.position.set(w / 2 - t / 2, h / 2, 0); right.rotation.y = Math.PI / 2; g.add(right);
  // Top
  const top = panel(w, d, t, false); top.position.set(0, h - t / 2, 0); top.rotation.x = -Math.PI / 2; g.add(top);
  // Bottom
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(w, t, d), darkMat);
  bottom.position.set(0, t / 2, 0); g.add(bottom);

  g.position.set(x, y, z);
  g.rotation.y = rng() * Math.PI * 2;
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return {
    group: g,
    colliderBoxes: [{
      min: [x - w / 2, y, z - d / 2],
      max: [x + w / 2, y + h, z + d / 2],
    }],
  };
}

// ---------- SHIPPING CONTAINER (corrugated walls + doors + rivets) ----------
export function buildContainer({ x, z, y = 0, length = 6, width = 2.4, height = 2.6, color = 0x6a1f1f, rng = Math.random } = {}) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.45 });
  const trimMat = ironBand();
  const doorMat = new THREE.MeshStandardMaterial({ color: color * 0.8 | 0, roughness: 0.7, metalness: 0.55 });

  // Floor
  const floor = new THREE.Mesh(new THREE.BoxGeometry(length, 0.15, width), rustIron());
  floor.position.y = 0.075;
  g.add(floor);
  // Roof with slight ribs
  const roof = new THREE.Mesh(new THREE.BoxGeometry(length, 0.1, width), bodyMat);
  roof.position.y = height + 0.05;
  g.add(roof);
  for (let rx = -length / 2 + 0.3; rx < length / 2; rx += 0.6) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, width), trimMat);
    rib.position.set(rx, height + 0.12, 0);
    g.add(rib);
  }

  // Helper: corrugated wall panel (with vertical ridges)
  function corrugatedWall(panelLen, panelHeight, thickness = 0.08) {
    const wall = new THREE.Group();
    // Back flat panel
    const back = new THREE.Mesh(new THREE.BoxGeometry(panelLen, panelHeight, thickness * 0.5), bodyMat);
    wall.add(back);
    // Ridges — alternating raised strips
    const ridgeW = 0.22;
    const ridgeCount = Math.floor(panelLen / ridgeW);
    for (let i = 0; i < ridgeCount; i++) {
      const isOut = i % 2 === 0;
      const rx = -panelLen / 2 + ridgeW / 2 + i * ridgeW;
      const depth = thickness + (isOut ? 0.03 : 0);
      const rib = new THREE.Mesh(new THREE.BoxGeometry(ridgeW * 0.98, panelHeight * 0.92, depth), bodyMat);
      rib.position.set(rx, 0, thickness * 0.3);
      wall.add(rib);
    }
    // Top/bottom trim rails
    const trimTop = new THREE.Mesh(new THREE.BoxGeometry(panelLen, 0.12, thickness + 0.03), trimMat);
    trimTop.position.y = panelHeight / 2 - 0.06;
    wall.add(trimTop);
    const trimBot = trimTop.clone(); trimBot.position.y = -panelHeight / 2 + 0.06;
    wall.add(trimBot);
    return wall;
  }

  // Side walls (long ones)
  const sideL = corrugatedWall(length, height); sideL.position.set(0, height / 2 + 0.15, -width / 2 + 0.04); g.add(sideL);
  const sideR = corrugatedWall(length, height); sideR.position.set(0, height / 2 + 0.15, width / 2 - 0.04); sideR.rotation.y = Math.PI; g.add(sideR);
  // Back wall (short)
  const back = corrugatedWall(width, height); back.position.set(-length / 2 + 0.04, height / 2 + 0.15, 0); back.rotation.y = Math.PI / 2; g.add(back);

  // Front = two doors
  const doorW = width / 2 - 0.04;
  const doorH = height - 0.3;
  for (const side of [-1, 1]) {
    const doorGroup = new THREE.Group();
    const door = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.07), doorMat);
    doorGroup.add(door);
    // Vertical reinforcement bars
    for (let i = -1; i <= 1; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.04, doorH, 0.04), trimMat);
      bar.position.set(i * (doorW / 3), 0, 0.055);
      doorGroup.add(bar);
    }
    // Horizontal locking rods
    for (let i = 0; i < 4; i++) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, doorH * 0.95, 6), trimMat);
      rod.position.set(-doorW / 2 + 0.12 + i * 0.09, 0, 0.08);
      doorGroup.add(rod);
      // Lock handle at middle
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.05), trimMat);
      handle.position.set(rod.position.x, 0, 0.13);
      doorGroup.add(handle);
    }
    // Rivets around edge
    for (let i = 0; i < 8; i++) {
      const rv = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 6), rivetMat());
      rv.position.set(
        -doorW / 2 + (i / 7) * doorW,
        doorH / 2 - 0.05,
        0.09,
      );
      doorGroup.add(rv);
      const rv2 = rv.clone(); rv2.position.y = -doorH / 2 + 0.05; doorGroup.add(rv2);
    }
    doorGroup.position.set(length / 2 - 0.04, doorH / 2 + 0.15, side * (doorW / 2 + 0.02));
    doorGroup.rotation.y = Math.PI / 2;
    g.add(doorGroup);
  }

  // Corner posts
  for (const px of [-length / 2, length / 2]) {
    for (const pz of [-width / 2, width / 2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, height + 0.3, 0.14), trimMat);
      post.position.set(px, height / 2 + 0.15, pz);
      g.add(post);
      // Corner fittings (the iconic cube boxes)
      const fitTop = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), trimMat);
      fitTop.position.set(px, height + 0.1, pz);
      g.add(fitTop);
      const fitBot = fitTop.clone(); fitBot.position.y = 0.12; g.add(fitBot);
    }
  }

  g.position.set(x, y, z);
  g.rotation.y = rng() * Math.PI * 2;
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // Compute rotated bounds for collision (approximate as rotated box -> use bbox of children)
  // For simplicity, collider assumes axis aligned at rotation.y = 0; we'll return a loose box
  // that fits the rotated extent on-axis so AABB collision still works.
  const r = Math.max(length, width) / 2;
  return {
    group: g,
    colliderBoxes: [{
      min: [x - r, y, z - r],
      max: [x + r, y + height + 0.3, z + r],
    }],
  };
}

// ---------- ROCK (displaced icosahedron) ----------
export function buildRock({ x, z, y = 0, size = 0.6, rng = Math.random } = {}) {
  const geom = new THREE.IcosahedronGeometry(size, 1);
  // Displace vertices for a non-perfect shape
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    const n = (Math.sin(px * 7.1 + py * 3.3) + Math.cos(pz * 5.7)) * 0.08;
    const jitter = (rng() - 0.5) * 0.12 * size;
    pos.setX(i, px + n * px + jitter);
    pos.setY(i, py + n * py + jitter * 0.5);
    pos.setZ(i, pz + n * pz + jitter);
  }
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(geom, rockMat());
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.position.set(x, y + size * 0.5, z);
  mesh.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
  const g = new THREE.Group();
  g.add(mesh);
  return {
    group: g,
    colliderBoxes: [{
      min: [x - size * 0.8, y, z - size * 0.8],
      max: [x + size * 0.8, y + size * 1.4, z + size * 0.8],
    }],
  };
}

// ---------- TREE (pine-ish: trunk + tapering cone layers) ----------
export function buildTree({ x, z, y = 0, scale = 1, dry = false, rng = Math.random } = {}) {
  const g = new THREE.Group();
  const trunkH = 2.5 * scale + rng() * 1.0;
  const trunkR = 0.16 * scale;

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(trunkR * 0.6, trunkR, trunkH, 7),
    barkMat(),
  );
  trunk.position.y = trunkH / 2;
  // Jitter trunk vertices slightly for organic look
  const tp = trunk.geometry.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    tp.setX(i, tp.getX(i) + (rng() - 0.5) * 0.02);
    tp.setZ(i, tp.getZ(i) + (rng() - 0.5) * 0.02);
  }
  trunk.geometry.computeVertexNormals();
  g.add(trunk);

  // 3 leaf layers (cones)
  const leafM = dry ? leafMatDry() : leafMat();
  for (let i = 0; i < 3; i++) {
    const r = (1.4 - i * 0.35) * scale;
    const h = (1.3 - i * 0.15) * scale;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), leafM);
    cone.position.y = trunkH * 0.7 + i * 0.9 * scale;
    // Jitter
    const cp = cone.geometry.attributes.position;
    for (let j = 0; j < cp.count; j++) {
      cp.setX(j, cp.getX(j) + (rng() - 0.5) * 0.08);
      cp.setZ(j, cp.getZ(j) + (rng() - 0.5) * 0.08);
    }
    cone.geometry.computeVertexNormals();
    cone.rotation.y = rng() * Math.PI * 2;
    g.add(cone);
  }

  g.position.set(x, y, z);
  g.rotation.y = rng() * Math.PI * 2;
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return {
    group: g,
    colliderBoxes: [{
      min: [x - trunkR * 1.5, y, z - trunkR * 1.5],
      max: [x + trunkR * 1.5, y + trunkH, z + trunkR * 1.5],
    }],
  };
}

// ---------- DEAD/BROADLEAF TREE (branchier silhouette) ----------
export function buildBroadleaf({ x, z, y = 0, scale = 1, rng = Math.random } = {}) {
  const g = new THREE.Group();
  const trunkH = 3.0 * scale + rng() * 1.0;
  const trunkR = 0.22 * scale;

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(trunkR * 0.55, trunkR, trunkH, 8), barkMat());
  trunk.position.y = trunkH / 2;
  g.add(trunk);

  // Big leaf blob cluster of overlapping spheres
  const leafM = leafMat();
  for (let i = 0; i < 7; i++) {
    const r = (0.9 + rng() * 0.6) * scale;
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), leafM);
    const a = rng() * Math.PI * 2;
    const rad = (0.3 + rng() * 0.8) * scale;
    blob.position.set(Math.cos(a) * rad, trunkH + (rng() - 0.2) * scale, Math.sin(a) * rad);
    g.add(blob);
  }
  // A couple of big branches
  for (let i = 0; i < 3; i++) {
    const bl = 0.8 * scale + rng() * 0.5;
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.09, bl, 5), barkMat());
    const a = rng() * Math.PI * 2;
    branch.position.set(Math.cos(a) * 0.2, trunkH * 0.7 + rng() * 0.4, Math.sin(a) * 0.2);
    branch.rotation.z = Math.PI / 2 - 0.8 + rng() * 0.4;
    branch.rotation.y = a;
    g.add(branch);
  }

  g.position.set(x, y, z);
  g.rotation.y = rng() * Math.PI * 2;
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return {
    group: g,
    colliderBoxes: [{
      min: [x - trunkR * 1.8, y, z - trunkR * 1.8],
      max: [x + trunkR * 1.8, y + trunkH, z + trunkR * 1.8],
    }],
  };
}

// ---------- RUSTY CAR HUSK (Soviet-ish sedan, roughly) ----------
export function buildRustyCar({ x, z, y = 0, rng = Math.random } = {}) {
  const g = new THREE.Group();
  const carMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.85, metalness: 0.4 });
  const carDark = new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.95 });
  // Body lower
  const lower = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.9, 1.8), carMat);
  lower.position.set(0, 0.55, 0); g.add(lower);
  // Cabin
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.75, 1.6), carMat);
  cabin.position.set(-0.1, 1.35, 0); g.add(cabin);
  // Windows (broken / dark)
  const win = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.6, 1.5), carDark);
  win.position.set(-0.1, 1.35, 0); g.add(win);
  // Hood slight taper
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.15, 1.7), carMat);
  hood.position.set(1.4, 1.05, 0); g.add(hood);
  // Trunk
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.15, 1.7), carMat);
  trunk.position.set(-1.5, 1.05, 0); g.add(trunk);
  // Bumpers
  const frontB = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.25, 1.85), chrome());
  frontB.position.set(2.15, 0.65, 0); g.add(frontB);
  const backB = frontB.clone(); backB.position.x = -2.15; g.add(backB);
  // Flat tires
  for (const [wx, wz] of [[1.5, -0.9], [1.5, 0.9], [-1.5, -0.9], [-1.5, 0.9]]) {
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.25, 14), tireMat());
    tire.rotation.z = Math.PI / 2;
    tire.position.set(wx, 0.28, wz);
    g.add(tire);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.27, 10), hubMat());
    hub.rotation.z = Math.PI / 2;
    hub.position.set(wx, 0.28, wz);
    g.add(hub);
  }
  // Rust patches (dark emissive-free planes on hood/roof)
  for (let i = 0; i < 5; i++) {
    const patch = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3 + rng() * 0.4, 0.2 + rng() * 0.3),
      new THREE.MeshStandardMaterial({ color: 0x2a1808, roughness: 1, transparent: true, opacity: 0.75 }),
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(-1.5 + rng() * 3, 1.71, -0.8 + rng() * 1.6);
    g.add(patch);
  }
  g.position.set(x, y, z);
  g.rotation.y = rng() * Math.PI * 2;
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // Rotate-aware collider: loose square
  const r = 2.3;
  return {
    group: g,
    colliderBoxes: [{ min: [x - r, y, z - r], max: [x + r, y + 1.8, z + r] }],
  };
}

// ---------- YELLOW TRUCK (upgraded, more realistic KAMAZ-ish) ----------
export function buildYellowTruck({ x, z, y = 0 } = {}) {
  const g = new THREE.Group();
  const body = yellowMat();
  const bodyDirty = yellowDirty();
  const dark = new THREE.MeshStandardMaterial({ color: 0x0e0e0e, roughness: 0.95 });
  const gm = glassMat();
  const cm = chrome();
  const hl = headlightMat();
  const rd = redMat();

  // --- Chassis frame ---
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.25, 2.0), dark);
  chassis.position.set(0, 0.6, 0);
  g.add(chassis);

  // --- Cab ---
  // Floor
  const cabFloor = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.15, 2.2), bodyDirty);
  cabFloor.position.set(1.5, 0.85, 0);
  g.add(cabFloor);
  // Main cab box
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.7, 2.2), body);
  cab.position.set(1.5, 1.85, 0);
  g.add(cab);
  // Windshield (slanted)
  const wind = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 2.0), gm);
  wind.position.set(2.75, 2.35, 0);
  wind.rotation.z = -0.22;
  g.add(wind);
  // Side windows
  for (const zs of [-1.12, 1.12]) {
    const sw = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 0.08), gm);
    sw.position.set(1.5, 2.3, zs);
    g.add(sw);
    // Door seam
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.4, 0.1), dark);
    seam.position.set(1.3, 1.7, zs + (zs > 0 ? -0.01 : 0.01));
    g.add(seam);
    // Door handle
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.04, 0.04), cm);
    handle.position.set(1.2, 1.45, zs + (zs > 0 ? -0.06 : 0.06));
    g.add(handle);
    // Side mirror
    const mirror = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 6), cm);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(-0.2, 0, 0);
    mirror.add(arm);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.04), cm);
    glass.position.set(-0.45, 0, 0);
    mirror.add(glass);
    mirror.position.set(2.55, 2.6, zs + (zs > 0 ? -0.1 : 0.1));
    g.add(mirror);
  }
  // Roof with subtle curve (just a thin top)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.08, 2.1), body);
  roof.position.set(1.5, 2.75, 0);
  g.add(roof);

  // --- Hood / engine ---
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 2.0), body);
  hood.position.set(3.4, 1.55, 0);
  g.add(hood);
  // Grille (vertical bars)
  const grilleFrame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 1.7), cm);
  grilleFrame.position.set(4.12, 1.55, 0);
  g.add(grilleFrame);
  for (let i = 0; i < 7; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.8, 0.04), cm);
    bar.position.set(4.15, 1.55, -0.75 + i * 0.25);
    g.add(bar);
  }
  // Headlights
  for (const zs of [-0.65, 0.65]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 14), cm);
    ring.rotation.z = Math.PI / 2;
    ring.position.set(4.16, 1.75, zs);
    g.add(ring);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), hl);
    light.position.set(4.22, 1.75, zs);
    g.add(light);
  }
  // Fender bumper
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.25, 2.0), cm);
  bumper.position.set(4.2, 1.05, 0);
  g.add(bumper);

  // --- Cargo bed / flatbed with side rails ---
  const bed = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.2, 2.2), bodyDirty);
  bed.position.set(-1.4, 1.0, 0);
  g.add(bed);
  // Sides
  for (const zs of [-1.15, 1.15]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.6, 0.1), body);
    side.position.set(-1.4, 1.35, zs);
    g.add(side);
    // Plank lines
    for (let i = 0; i < 5; i++) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.55, 0.12), bodyDirty);
      seam.position.set(-2.8 + i * 0.7, 1.35, zs);
      g.add(seam);
    }
  }
  // Tailgate
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 2.1), body);
  tail.position.set(-3.0, 1.35, 0);
  g.add(tail);
  // Tail lights
  for (const zs of [-0.9, 0.9]) {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.25), rd);
    tl.position.set(-3.05, 1.1, zs);
    g.add(tl);
  }

  // --- Wheels with hubs, bolts, tread pattern ---
  function makeWheel(r = 0.55, w = 0.35) {
    const wg = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 18), tireMat());
    wg.add(tire);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.45, w + 0.02, 12), hubMat());
    wg.add(hub);
    // Bolts
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), cm);
      bolt.position.set(Math.cos(a) * r * 0.3, 0, Math.sin(a) * r * 0.3);
      wg.add(bolt);
    }
    // Tread lines
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const tread = new THREE.Mesh(new THREE.BoxGeometry(0.06, w + 0.01, 0.06), dark);
      tread.position.set(Math.cos(a) * (r - 0.02), 0, Math.sin(a) * (r - 0.02));
      wg.add(tread);
    }
    wg.rotation.z = Math.PI / 2;
    return wg;
  }
  for (const [wx, wz] of [[3.1, -1.05], [3.1, 1.05], [-1.6, -1.05], [-1.6, 1.05], [-2.6, -1.05], [-2.6, 1.05]]) {
    const w = makeWheel(0.55, 0.32);
    w.position.set(wx, 0.55, wz);
    g.add(w);
  }
  // Fuel tank
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.1, 12), cm);
  tank.rotation.z = Math.PI / 2;
  tank.position.set(-0.3, 0.55, -1.1);
  g.add(tank);
  // Exhaust pipe up behind cab
  const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.4, 10), cm);
  ex.position.set(0.4, 2.0, -1.1);
  g.add(ex);
  const exCap = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.15, 10), dark);
  exCap.position.set(0.4, 3.25, -1.1);
  g.add(exCap);

  g.position.set(x, y, z);
  // Headlights references for main.js to flip on
  g.userData.headlights = [];
  g.traverse(o => {
    if (o.isMesh && o.material === hl) g.userData.headlights.push(o);
  });
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  return { group: g, colliderBoxes: [{ min: [x - 4.2, y, z - 1.2], max: [x + 4.3, y + 3.3, z + 1.2] }] };
}

// ---------- INDUSTRIAL PIPE (curved + flanges) ----------
export function buildPipeSegment({ x, z, y = 0, length = 4, radius = 0.18, color = 0x4f4a41 } = {}) {
  const g = new THREE.Group();
  const pipeMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.7 });
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 14), pipeMat);
  pipe.rotation.z = Math.PI / 2;
  g.add(pipe);
  // Flanges at both ends
  for (const sx of [-length / 2 + 0.05, length / 2 - 0.05]) {
    const fl = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.4, radius * 1.4, 0.08, 16), ironBand());
    fl.rotation.z = Math.PI / 2;
    fl.position.x = sx;
    g.add(fl);
    // Bolts around flange
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), rivetMat());
      bolt.position.set(sx, Math.cos(a) * radius * 1.2, Math.sin(a) * radius * 1.2);
      g.add(bolt);
    }
  }
  g.position.set(x, y, z);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group: g, colliderBoxes: [] };
}

// ---------- CONCRETE BARRIER (rough, chipped) ----------
export function buildConcreteBarrier({ x, z, y = 0, rng = Math.random } = {}) {
  const g = new THREE.Group();
  const concMat = new THREE.MeshStandardMaterial({ color: 0x7a766e, roughness: 1.0, flatShading: true });

  // Trapezoidal shape via extruded shape
  const shape = new THREE.Shape();
  shape.moveTo(-0.4, 0);
  shape.lineTo(0.4, 0);
  shape.lineTo(0.25, 0.8);
  shape.lineTo(-0.25, 0.8);
  shape.closePath();
  const extGeom = new THREE.ExtrudeGeometry(shape, { depth: 2.2, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.02, bevelSegments: 1, steps: 1 });
  // Jitter vertices slightly for a chipped look
  const pos = extGeom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, pos.getX(i) + (rng() - 0.5) * 0.01);
    pos.setY(i, pos.getY(i) + (rng() - 0.5) * 0.01);
    pos.setZ(i, pos.getZ(i) + (rng() - 0.5) * 0.01);
  }
  extGeom.computeVertexNormals();
  const mesh = new THREE.Mesh(extGeom, concMat);
  mesh.position.z = -1.1;
  mesh.castShadow = true; mesh.receiveShadow = true;
  g.add(mesh);

  g.position.set(x, y, z);
  g.rotation.y = rng() * Math.PI * 2;
  return {
    group: g,
    colliderBoxes: [{ min: [x - 1.1, y, z - 0.5], max: [x + 1.1, y + 0.85, z + 0.5] }],
  };
}
