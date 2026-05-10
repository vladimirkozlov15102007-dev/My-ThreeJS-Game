// Old Amber Factory — high-poly procedural props edition.
//
// v3 rocks were DodecahedronGeometry(r, 0) — twelve flat faces, literally
// Minecraft-tier. Barrels were plain cylinders, crates were plain cubes,
// containers were plain boxes. This file replaces every one of those with
// real procedural geometry:
//
//   - Rocks:       IcosahedronGeometry(size, 2) with per-vertex fBm displacement
//                  (flat-shaded for faceted look but many more faces).
//   - Barrels:     capped cylinder body + three torus ring bands + top disc
//                  + bung plug. Material is rust-tinted PBR.
//   - Crates:      bevelled wood box with 8 corner frames, plank strips on
//                  4 faces, 8 steel rivets, wood-grain coloured material.
//   - Containers:  corrugated steel shell (dozens of thin vertical ribs on
//                  each side), double doors with handles, 8 ISO corner castings.
//   - Trees:       tapered cylinder trunk + 3 displaced icosahedron canopy blobs.
//   - Truck:       cab + angled hood, windshield + side-window glass, cargo
//                  bed with stake posts, chrome grille (6 horizontal slats),
//                  emissive headlights, chrome exhaust stack with cap,
//                  chrome front bumper, 4 wheels with rims + chrome hubs,
//                  mud-flaps.
//   - Ground:      two-octave sinusoid noise + jitter (looks less flat).
import * as THREE from 'three';
import {
  matConcrete, matMetal, matBrick, matFloor, matDirt,
} from './materials.js';

export class BoxSet {
  constructor() { this.boxes = []; }
  add(min, max, data = {}) {
    this.boxes.push({ min: new THREE.Vector3(...min), max: new THREE.Vector3(...max), ...data });
  }
}

function blockBox(group, boxes, min, max, mat, { collide = true, cast = true, recv = true } = {}) {
  const sx = max[0] - min[0], sy = max[1] - min[1], sz = max[2] - min[2];
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const m = new THREE.Mesh(g, mat);
  m.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  m.castShadow = cast; m.receiveShadow = recv;
  group.add(m);
  if (collide) boxes.add(min, max);
  return m;
}

// --- High-detail procedural props ---------------------------------------

function makeRock(size = 1) {
  // Displaced icosahedron at detail=2 (~162 verts) for an organic shape.
  const geom = new THREE.IcosahedronGeometry(size, 2);
  const pos = geom.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const d = 1
      + (Math.random() - 0.5) * 0.42
      + Math.sin(n.x * 4 + Math.random() * 10) * 0.08
      + Math.cos(n.y * 5 + Math.random() * 10) * 0.06
      + Math.sin(n.z * 6 + Math.random() * 10) * 0.05;
    v.copy(n).multiplyScalar(size * d);
    // Flatten bottom so the rock sits on the ground.
    if (v.y < -size * 0.35) v.y = -size * 0.35 + (v.y + size * 0.35) * 0.25;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geom.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.08, 0.05, 0.32 + Math.random() * 0.08),
    roughness: 0.96, metalness: 0.04, flatShading: true,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

function makeBarrel() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x8a3a1e, roughness: 0.72, metalness: 0.55,
    emissive: 0x1a0800, emissiveIntensity: 0.06,
  });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.5, metalness: 0.85 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.95, 24, 1, false), bodyMat);
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  // Three rust-colored ring bands (torus) wrapping the barrel.
  for (const y of [-0.35, -0.05, 0.25]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.475, 0.035, 6, 28), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    ring.castShadow = true;
    g.add(ring);
  }
  // Top rim + bung
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.04, 24), ringMat);
  top.position.y = 0.49;
  g.add(top);
  const bung = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.025, 12), ringMat);
  bung.position.set(0.22, 0.51, 0.18);
  g.add(bung);
  return g;
}

function makeCrate(size = 0.85) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.08, 0.4, 0.3 + Math.random() * 0.08),
    roughness: 0.9, metalness: 0.05,
  });
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x4a2818, roughness: 0.95 });
  const rivetMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.4, metalness: 0.9 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), wood);
  box.castShadow = true; box.receiveShadow = true;
  g.add(box);
  // Plank strips + corner frames on +/- Z faces.
  for (const face of [1, -1]) {
    for (let y = -1; y <= 1; y++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(size * 0.96, size * 0.26, 0.015), darkWood);
      plank.position.set(0, y * size * 0.33, face * size * 0.501);
      g.add(plank);
    }
    for (const [cx, cy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.05, size, 0.02), darkWood);
      frame.position.set(cx * size * 0.47, 0, face * size * 0.502);
      g.add(frame);
    }
  }
  // Steel rivets on each corner.
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const r = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5), rivetMat);
    r.position.set(sx * size * 0.48, sy * size * 0.48, sz * size * 0.51);
    g.add(r);
  }
  return g;
}

function makeContainer(hue) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(hue, 0.5, 0.35),
    roughness: 0.78, metalness: 0.45,
  });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x1e1a15, roughness: 0.6, metalness: 0.6 });
  const cornerMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.9 });
  // Main shell
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 6.0), bodyMat);
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  // Corrugated ribs on +/-X faces (thin vertical bars).
  for (const sx of [-1, 1]) {
    for (let i = -11; i <= 11; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.55, 0.045), bodyMat);
      rib.position.set(sx * 1.22, 0, i * 0.26);
      g.add(rib);
    }
  }
  // Doors on +/-Z end
  for (const sz of [-1, 1]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.45, 0.06), doorMat);
    door.position.set(0, 0, sz * 3.01);
    g.add(door);
    for (const hx of [-0.5, 0.5]) {
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.6, 0.08), doorMat);
      handle.position.set(hx, 0, sz * 3.04);
      g.add(handle);
    }
  }
  // ISO corner castings
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), cornerMat);
    c.position.set(sx * 1.25, sy * 1.3, sz * 3.05);
    g.add(c);
  }
  return g;
}

function makeTree(h = 6) {
  const g = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3920, roughness: 0.95 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, h * 0.6, 10), trunkMat);
  trunk.position.y = h * 0.3;
  trunk.castShadow = true; trunk.receiveShadow = true;
  g.add(trunk);
  const foliage = new THREE.MeshStandardMaterial({
    color: 0x4a6a30, roughness: 0.9, metalness: 0, flatShading: true,
  });
  for (let i = 0; i < 3; i++) {
    const s = 1.4 - i * 0.25;
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), foliage);
    const pos = blob.geometry.attributes.position;
    const v = new THREE.Vector3();
    for (let j = 0; j < pos.count; j++) {
      v.fromBufferAttribute(pos, j);
      v.multiplyScalar(1 + (Math.random() - 0.5) * 0.35);
      pos.setXYZ(j, v.x, v.y, v.z);
    }
    blob.geometry.computeVertexNormals();
    blob.position.set((Math.random() - 0.5) * 0.6, h * 0.55 + i * 0.7, (Math.random() - 0.5) * 0.6);
    blob.castShadow = true; blob.receiveShadow = true;
    g.add(blob);
  }
  return g;
}

function makeTruck() {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({
    color: 0xf4c828, roughness: 0.4, metalness: 0.6,
    emissive: 0x1a1000, emissiveIntensity: 0.05,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.85 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x223040, roughness: 0.08, metalness: 0.9,
    transparent: true, opacity: 0.72, envMapIntensity: 1.5,
  });
  const chrome = new THREE.MeshStandardMaterial({
    color: 0xefefef, roughness: 0.12, metalness: 1.0, envMapIntensity: 1.4,
  });

  const box = (sx, sy, sz, x, y, z, mat = body) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    return m;
  };

  // Cab + hood
  box(2.4, 1.7, 2.2, 1.1, 1.85, 0);
  box(1.6, 0.9, 2.0, 3.0, 1.45, 0);
  box(1.5, 0.1, 2.0, 3.0, 1.95, 0, chrome);
  // Windshield (tilted via rotated mesh)
  const ws = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.05, 2.1), glass);
  ws.position.set(2.15, 2.15, 0);
  ws.rotation.z = -0.25;
  g.add(ws);
  // Side windows
  for (const sz of [-1.05, 1.05]) box(2.0, 0.9, 0.06, 1.1, 2.2, sz, glass);
  // Cargo bed with stake posts
  box(3.0, 1.8, 2.2, -1.5, 1.6, 0);
  box(3.0, 0.1, 2.2, -1.5, 2.55, 0, chrome);
  for (const sx of [-3, -0.1]) for (const sz of [-1.1, 1.1]) box(0.1, 0.5, 0.1, sx, 2.75, sz, dark);
  // Grille — 6 chrome slats
  for (let i = 0; i < 6; i++) box(0.06, 0.6, 1.4, 3.85, 1.3 + i * 0.08, 0, chrome);
  // Headlights (emissive)
  const hlMat = new THREE.MeshStandardMaterial({
    color: 0xfff0c0, emissive: 0xfff0c0, emissiveIntensity: 1.2,
    roughness: 0.2, metalness: 0.2,
  });
  box(0.15, 0.35, 0.35, 3.9, 1.7, -0.8, hlMat);
  box(0.15, 0.35, 0.35, 3.9, 1.7, 0.8, hlMat);
  // Exhaust stack
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.3, 12), chrome);
  stack.position.set(1.8, 3.3, -0.9);
  stack.castShadow = true;
  g.add(stack);
  const stackCap = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 12), dark);
  stackCap.position.set(1.8, 3.95, -0.9);
  g.add(stackCap);
  // Front bumper
  box(0.3, 0.25, 2.3, 3.95, 0.95, 0, chrome);
  // Wheels + rims + hubs
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.85 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.25, metalness: 0.9 });
  for (const [wx, wz] of [[2.8, -1.25], [2.8, 1.25], [-2.4, -1.25], [-2.4, 1.25]]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.45, 20), wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.6, wz);
    wheel.castShadow = true;
    g.add(wheel);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.47, 16), rimMat);
    rim.rotation.z = Math.PI / 2;
    rim.position.copy(wheel.position);
    g.add(rim);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 10), chrome);
    hub.rotation.z = Math.PI / 2;
    hub.position.copy(wheel.position);
    g.add(hub);
  }
  // Mud-flaps behind rear wheels
  const flapMat = new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 1 });
  for (const [fx, fz] of [[-3.1, -1.2], [-3.1, 1.2]]) {
    const flap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.35), flapMat);
    flap.position.set(fx, 0.3, fz);
    g.add(flap);
  }
  return g;
}

// -------------------------------------------------------------------------
export function buildLevel(scene) {
  const root = new THREE.Group();
  scene.add(root);
  const colliders = new BoxSet();
  const zones = {};
  const patrolPoints = [];
  const interactables = [];
  const spawnPoints = [];

  const mFloorIn = matFloor(8);
  const mWall = matBrick(2);
  const mWall2 = matConcrete(3);
  const mMetal = matMetal(2);
  const mRoof = matConcrete(6);

  // Terrain (two-octave sinusoid + jitter, detail 160x160).
  const mGround = matDirt(18);
  const groundGeom = new THREE.PlaneGeometry(400, 400, 160, 160);
  const gPos = groundGeom.attributes.position;
  for (let i = 0; i < gPos.count; i++) {
    const x = gPos.getX(i), y = gPos.getY(i);
    if (Math.abs(x) > 55 || Math.abs(y) > 55) {
      const h =
          Math.sin(x * 0.06) * 0.45
        + Math.cos(y * 0.048) * 0.45
        + Math.sin(x * 0.21 + y * 0.17) * 0.18
        + Math.cos(y * 0.22 - x * 0.19) * 0.16
        + (Math.random() - 0.5) * 0.12;
      gPos.setZ(i, h);
    }
  }
  gPos.needsUpdate = true;
  groundGeom.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeom, mGround);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  // Dark asphalt patches
  for (let i = 0; i < 20; i++) {
    const x = -80 + Math.random() * 160;
    const z = -80 + Math.random() * 160;
    if (x > -48 && x < 74 && z > -30 && z < 34) continue;
    const patch = new THREE.Mesh(
      new THREE.CircleGeometry(3 + Math.random() * 5, 14),
      new THREE.MeshStandardMaterial({ color: 0x2c2824, roughness: 1 }),
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(x, 0.02, z);
    patch.receiveShadow = true;
    root.add(patch);
  }

  // Building generator
  function buildRoom(x0, z0, x1, z1, floorY, wallH, { wall = mWall, floorMat = mFloorIn, roofMat = mRoof, thickness = 0.5, doors = [] } = {}) {
    const y0 = floorY, y1 = floorY + wallH;
    blockBox(root, colliders, [x0, y0 - 0.25, z0], [x1, y0, z1], floorMat, { collide: false });
    blockBox(root, colliders, [x0, y1, z0], [x1, y1 + thickness, z1], roofMat, { collide: false, cast: false });
    const faces = { N: z1 - thickness, S: z0, E: x1 - thickness, W: x0 };
    function wallRow(face) {
      if (face === 'N' || face === 'S') {
        const onFace = doors.filter(d => d.side === face).sort((a, b) => a.at - b.at);
        let cursor = x0;
        for (const d of onFace) {
          const dx0 = d.at - d.width / 2;
          if (dx0 > cursor) blockBox(root, colliders, [cursor, y0, faces[face]], [dx0, y1, faces[face] + thickness], wall);
          cursor = d.at + d.width / 2;
          blockBox(root, colliders, [dx0, y1 - 1.0, faces[face]], [cursor, y1, faces[face] + thickness], wall);
        }
        if (cursor < x1) blockBox(root, colliders, [cursor, y0, faces[face]], [x1, y1, faces[face] + thickness], wall);
      } else {
        const onFace = doors.filter(d => d.side === face).sort((a, b) => a.at - b.at);
        let cursor = z0;
        for (const d of onFace) {
          const dz0 = d.at - d.width / 2;
          if (dz0 > cursor) blockBox(root, colliders, [faces[face], y0, cursor], [faces[face] + thickness, y1, dz0], wall);
          cursor = d.at + d.width / 2;
          blockBox(root, colliders, [faces[face], y1 - 1.0, dz0], [faces[face] + thickness, y1, cursor], wall);
        }
        if (cursor < z1) blockBox(root, colliders, [faces[face], y0, cursor], [faces[face] + thickness, y1, z1], wall);
      }
    }
    wallRow('N'); wallRow('S'); wallRow('E'); wallRow('W');
  }

  // ===== Zone 1: Admin =====
  zones.admin = { min: new THREE.Vector3(-40, 0, -20), max: new THREE.Vector3(-10, 4, 20) };
  buildRoom(-40, -20, -10, 20, 0, 4, {
    doors: [{ side: 'S', at: -32, width: 3 }, { side: 'E', at: 10, width: 3 }],
  });
  blockBox(root, colliders, [-30, 0, 10], [-29, 3.2, 15], mWall);
  blockBox(root, colliders, [-30, 0, 17], [-29, 3.2, 20], mWall);
  blockBox(root, colliders, [-30, 2.2, 15], [-29, 3.2, 17], mWall);
  blockBox(root, colliders, [-25, 0, -3], [-24, 3.2, 8], mWall);
  blockBox(root, colliders, [-25, 0, -20], [-24, 3.2, -13], mWall);
  blockBox(root, colliders, [-38, 0, 12], [-36, 0.9, 14], mMetal, { collide: false });
  blockBox(root, colliders, [-37.5, 0.9, 12.2], [-36.2, 1.6, 12.4], mMetal, { collide: false });
  blockBox(root, colliders, [-37, 0.9, 13], [-36.5, 1.5, 13.5],
    new THREE.MeshStandardMaterial({
      color: 0x1a1a1a, emissive: 0x002211, emissiveIntensity: 0.4, roughness: 0.6,
    }),
    { collide: false, cast: false },
  );
  patrolPoints.push({ x: -35, z: 15 }, { x: -20, z: -15 }, { x: -15, z: 10 }, { x: -28, z: -8 });

  // ===== Zone 2: Production =====
  zones.production = { min: new THREE.Vector3(-10, 0, -24), max: new THREE.Vector3(40, 14, 24) };
  buildRoom(-10, -24, 40, 24, 0, 12, {
    wall: mWall2, roofMat: mMetal,
    doors: [{ side: 'W', at: 10, width: 3 }, { side: 'E', at: 0, width: 4 }, { side: 'S', at: 20, width: 5 }],
  });
  for (let x = 0; x <= 30; x += 10) {
    for (let z = -15; z <= 15; z += 10) {
      blockBox(root, colliders, [x - 0.5, 0, z - 0.5], [x + 0.5, 11.5, z + 0.5], mMetal);
    }
  }
  blockBox(root, colliders, [4, 1.0, -20], [7, 1.3, 20], mMetal, { collide: false });
  for (let z = -20; z <= 20; z += 3) {
    blockBox(root, colliders, [3.6, 0, z - 0.2], [4.0, 1.0, z + 0.2], mMetal);
    blockBox(root, colliders, [7.0, 0, z - 0.2], [7.4, 1.0, z + 0.2], mMetal);
  }
  for (const [px, pz] of [[14, -12], [22, -5], [28, 8], [20, 14]]) {
    blockBox(root, colliders, [px - 1.3, 0, pz - 1.3], [px + 1.3, 3.2, pz + 1.3], mMetal);
    blockBox(root, colliders, [px - 0.6, 3.2, pz - 0.6], [px + 0.6, 5.0, pz + 0.6], mMetal);
  }
  blockBox(root, colliders, [0, 6.2, -1], [38, 6.5, 1], mMetal, { collide: false });
  for (let x = 0; x <= 38; x += 2) {
    blockBox(root, colliders, [x - 0.05, 6.5, -1.05], [x + 0.05, 7.4, -0.95], mMetal);
    blockBox(root, colliders, [x - 0.05, 6.5, 0.95], [x + 0.05, 7.4, 1.05], mMetal);
  }
  blockBox(root, colliders, [0, 7.3, -1.05], [38, 7.4, -0.95], mMetal);
  blockBox(root, colliders, [0, 7.3, 0.95], [38, 7.4, 1.05], mMetal);
  for (let i = 0; i < 10; i++) {
    const y0 = i * 0.6;
    blockBox(root, colliders, [38 - i * 0.6, 0, -2.5], [38 - i * 0.6 + 0.6, y0 + 0.6, -1.5], mMetal);
  }
  patrolPoints.push({ x: 0, z: 0 }, { x: 15, z: -18 }, { x: 30, z: -10 }, { x: 35, z: 10 }, { x: 10, z: 18 }, { x: 25, z: 20 }, { x: 18, z: 0 });

  // ===== Zone 3: Warehouse =====
  zones.warehouse = { min: new THREE.Vector3(40, 0, -18), max: new THREE.Vector3(70, 8, 18) };
  buildRoom(40, -18, 70, 18, 0, 7.5, {
    wall: mWall2, roofMat: mMetal,
    doors: [{ side: 'W', at: 0, width: 4 }, { side: 'S', at: 60, width: 3 }, { side: 'E', at: 0, width: 3 }],
  });
  for (let rz = -14; rz <= 14; rz += 7) {
    for (let rx = 45; rx <= 65; rx += 2.5) {
      blockBox(root, colliders, [rx - 0.1, 0, rz - 1.5], [rx + 0.1, 6.5, rz - 1.3], mMetal);
      blockBox(root, colliders, [rx - 0.1, 0, rz + 1.3], [rx + 0.1, 6.5, rz + 1.5], mMetal);
    }
    for (let sy = 1.4; sy <= 5.8; sy += 2.2) {
      blockBox(root, colliders, [44.8, sy, rz - 1.5], [65.2, sy + 0.15, rz + 1.5], mMetal, { collide: false });
    }
    for (let cx = 45; cx <= 64; cx += 2 + Math.random() * 1.5) {
      for (let sy = 1.55; sy <= 6; sy += 2.2) {
        if (Math.random() < 0.55) {
          const crate = makeCrate(0.9 + Math.random() * 0.5);
          crate.position.set(cx, sy, rz);
          crate.rotation.y = (Math.random() - 0.5) * 0.3;
          root.add(crate);
        }
      }
    }
  }
  for (let i = 0; i < 25; i++) {
    const x = 42 + Math.random() * 26;
    const z = -16 + Math.random() * 32;
    if (Math.abs((z + 14) % 7) < 2) continue;
    const s = 0.8 + Math.random() * 0.5;
    const crate = makeCrate(s);
    crate.position.set(x, s / 2, z);
    crate.rotation.y = Math.random() * Math.PI;
    root.add(crate);
    colliders.add([x - s / 2, 0, z - s / 2], [x + s / 2, s, z + s / 2]);
  }
  patrolPoints.push({ x: 45, z: -14 }, { x: 55, z: 0 }, { x: 62, z: 14 }, { x: 48, z: 10 }, { x: 65, z: -10 });

  // ===== Zone 4: Tunnels =====
  zones.tunnels = { min: new THREE.Vector3(40, 0, 18), max: new THREE.Vector3(70, 3, 30) };
  buildRoom(40, 18, 70, 30, 0, 2.8, {
    wall: mMetal, roofMat: mMetal,
    doors: [{ side: 'N', at: 60, width: 3 }, { side: 'E', at: 24, width: 3 }],
  });
  for (let x = 41; x < 70; x += 1.8) {
    blockBox(root, colliders, [x, 2.2, 19], [x + 0.3, 2.5, 29.5], mMetal, { collide: false });
  }
  blockBox(root, colliders, [48, 0, 22], [49.5, 1.2, 24], mMetal);
  blockBox(root, colliders, [58, 0, 25], [59.5, 1.2, 27], mMetal);
  patrolPoints.push({ x: 47, z: 24 }, { x: 60, z: 25 });

  // ===== Zone 5: Outdoor =====
  zones.outdoor = { min: new THREE.Vector3(-100, 0, -100), max: new THREE.Vector3(100, 20, 100) };

  function fenceLine(x0, z0, x1, z1) {
    if (x0 === x1) blockBox(root, colliders, [x0 - 0.15, 0, Math.min(z0, z1)], [x0 + 0.15, 2.8, Math.max(z0, z1)], mMetal);
    else blockBox(root, colliders, [Math.min(x0, x1), 0, z0 - 0.15], [Math.max(x0, x1), 2.8, z0 + 0.15], mMetal);
  }
  fenceLine(-90, -70, -90, 70);
  fenceLine(90, -70, 90, 70);
  fenceLine(-90, -70, 90, -70);

  // High-detail containers (corrugated walls + doors + corner castings)
  for (let i = 0; i < 12; i++) {
    const x = 80 + Math.random() * 8 - 4;
    const z = -60 + i * 10 + (Math.random() - 0.5) * 3;
    const c = makeContainer((i * 0.13) % 1);
    c.position.set(x + 1.2, 1.3, z + 3);
    c.rotation.y = (Math.random() - 0.5) * 0.15;
    root.add(c);
    colliders.add([x, 0, z], [x + 2.4, 2.6, z + 6]);
  }

  // Concrete jersey barriers
  for (let i = 0; i < 20; i++) {
    const x = -80 + Math.random() * 160;
    const z = -90 + Math.random() * 180;
    if (Math.abs(x) < 45 || (z > -26 && z < 32 && x > -42 && x < 72)) continue;
    blockBox(root, colliders, [x, 0, z], [x + 1.8, 1.0, z + 1], mWall2);
  }

  // Triple-plane grass for fullness
  const gc = document.createElement('canvas'); gc.width = gc.height = 128;
  const ggx = gc.getContext('2d');
  ggx.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 90; i++) {
    ggx.strokeStyle = `rgba(${60 + Math.random()*30},${95 + Math.random()*60},${30 + Math.random()*30},0.95)`;
    ggx.lineWidth = 1.2 + Math.random() * 1.8;
    ggx.beginPath();
    const x = Math.random() * 128;
    ggx.moveTo(x, 128);
    ggx.lineTo(x + (Math.random() - 0.5) * 14, 128 - 30 - Math.random() * 78);
    ggx.stroke();
  }
  const grassTex = new THREE.CanvasTexture(gc); grassTex.colorSpace = THREE.SRGBColorSpace;
  const grassMat = new THREE.MeshStandardMaterial({
    map: grassTex, alphaMap: grassTex, roughness: 1, transparent: true,
    alphaTest: 0.35, side: THREE.DoubleSide, color: 0xb8dd95,
  });
  for (let i = 0; i < 600; i++) {
    const x = -90 + Math.random() * 180;
    const z = -90 + Math.random() * 180;
    if (x > -45 && x < 72 && z > -26 && z < 32) continue;
    if (x > 80 && x < 90 && z > -65 && z < 65) continue;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), grassMat);
    mesh.position.set(x, 0.6, z);
    mesh.rotation.y = Math.random() * Math.PI;
    root.add(mesh);
    const mesh2 = mesh.clone(); mesh2.rotation.y += Math.PI / 3; root.add(mesh2);
    const mesh3 = mesh.clone(); mesh3.rotation.y += (2 * Math.PI) / 3; root.add(mesh3);
  }

  // 3D Trees (trunk + canopy) scattered around
  for (let i = 0; i < 20; i++) {
    const x = -90 + Math.random() * 180;
    const z = -90 + Math.random() * 180;
    if (x > -48 && x < 76 && z > -30 && z < 34) continue;
    if (x > 76 && x < 94 && z > -65 && z < 65) continue;
    const tree = makeTree(4 + Math.random() * 4);
    tree.position.set(x, 0, z);
    tree.rotation.y = Math.random() * Math.PI * 2;
    root.add(tree);
  }

  // Outdoor rocks (proper high-poly displaced icosahedrons)
  for (let i = 0; i < 140; i++) {
    const x = -90 + Math.random() * 180;
    const z = -90 + Math.random() * 180;
    if (x > -45 && x < 72 && z > -26 && z < 32) continue;
    const s = 0.15 + Math.random() * 0.45;
    const rock = makeRock(s);
    rock.position.set(x, s * 0.5, z);
    rock.rotation.y = Math.random() * Math.PI * 2;
    root.add(rock);
  }
  // Indoor rubble
  for (let i = 0; i < 80; i++) {
    const x = -30 + Math.random() * 90;
    const z = -20 + Math.random() * 40;
    const s = 0.12 + Math.random() * 0.3;
    const rock = makeRock(s);
    rock.position.set(x, s * 0.45, z);
    rock.rotation.y = Math.random() * Math.PI * 2;
    root.add(rock);
  }

  // Yellow truck (detailed)
  const truckGroup = makeTruck();
  const truckPos = new THREE.Vector3(85, 0, 0);
  truckGroup.position.copy(truckPos);
  root.add(truckGroup);
  colliders.add([truckPos.x - 3, 0, truckPos.z - 1.6], [truckPos.x + 4, 2.8, truckPos.z + 1.6]);

  const truck = { group: truckGroup, position: truckPos, running: false };
  interactables.push({
    kind: 'truck', truck,
    position: new THREE.Vector3(truckPos.x + 1.1, 1.4, truckPos.z + 1.7),
    radius: 2.6,
    label: () => truck.running ? 'E: DRIVE AWAY' : 'E: Start engine',
  });

  // Swaying chains from ceiling
  for (let i = 0; i < 12; i++) {
    const x = Math.random() * 38;
    const z = -20 + Math.random() * 40;
    const len = 2 + Math.random() * 4;
    const chain = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, len, 6),
      new THREE.MeshStandardMaterial({ color: 0x4a4036, roughness: 0.4, metalness: 0.7 }),
    );
    chain.position.set(x, 12 - len / 2, z);
    chain.userData.sway = { a: Math.random() * Math.PI * 2, amp: 0.01 + Math.random() * 0.015 };
    chain.castShadow = true;
    root.add(chain);
  }

  // Realistic barrels (with rings, top rim, bung)
  for (let i = 0; i < 26; i++) {
    const inFactory = Math.random() < 0.5;
    let x, z;
    if (inFactory) { x = -5 + Math.random() * 40; z = -18 + Math.random() * 38; }
    else { x = 72 + Math.random() * 16; z = -60 + Math.random() * 120; }
    const bar = makeBarrel();
    bar.position.set(x, 0.48, z);
    bar.rotation.y = Math.random() * Math.PI * 2;
    root.add(bar);
    colliders.add([x - 0.48, 0, z - 0.48], [x + 0.48, 1.0, z + 0.48]);
  }

  // Outdoor crates
  for (let i = 0; i < 16; i++) {
    const x = 72 + Math.random() * 16;
    const z = -50 + Math.random() * 100;
    const s = 0.8 + Math.random() * 0.6;
    const crate = makeCrate(s);
    crate.position.set(x, s / 2, z);
    crate.rotation.y = Math.random() * Math.PI;
    root.add(crate);
    colliders.add([x - s / 2, 0, z - s / 2], [x + s / 2, s, z + s / 2]);
  }

  // Floodlight pole
  blockBox(root, colliders, [-10, 0, -60], [-9.5, 10, -59.5], mMetal);
  blockBox(root, colliders, [-10, 10, -62], [-6, 10.5, -58], mMetal, { collide: false });

  // Skeleton spawn points (same 20 zones)
  spawnPoints.push(
    { x: -18, z: -12 }, { x: -14, z: 14 }, { x: -35, z: -8 },
    { x: 8, z: -16 }, { x: 22, z: -8 }, { x: 30, z: 12 },
    { x: 14, z: 18 }, { x: -3, z: 0 }, { x: 35, z: -18 },
    { x: 52, z: -10 }, { x: 62, z: 6 }, { x: 48, z: 14 },
    { x: 58, z: -14 }, { x: 66, z: 0 },
    { x: 48, z: 24 }, { x: 62, z: 27 },
    { x: 78, z: 20 }, { x: 78, z: -20 }, { x: 60, z: 40 }, { x: 76, z: -40 },
  );

  return { root, colliders, zones, patrolPoints, interactables, spawnPoints, truck };
}

export function zoneAt(zones, x, z) {
  for (const name of ['admin', 'production', 'warehouse', 'tunnels']) {
    const zb = zones[name];
    if (!zb) continue;
    if (x >= zb.min.x && x <= zb.max.x && z >= zb.min.z && z <= zb.max.z) return name;
  }
  return 'outdoor';
}
