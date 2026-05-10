// Procedural "Old Amber Factory" level — upgraded build.
// Walls/floors remain AABB for collision + shadowing, but all props use
// detailed meshes from ./props.js so the scene reads as high-fidelity.
import * as THREE from 'three';
import { rand, randInt, choose } from './utils.js';
import {
  matConcrete, matMetal, matBrick, matFloor, matDirt,
} from './materials.js';
import {
  buildBarrel, buildCrate, buildContainer, buildRock,
  buildTree, buildBroadleaf, buildRustyCar, buildYellowTruck,
  buildPipeSegment, buildConcreteBarrier,
} from './props.js';

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

// Register a detailed prop (group + optional colliders) with the level.
function addProp(root, colliders, prop) {
  root.add(prop.group);
  if (prop.colliderBoxes) {
    for (const cb of prop.colliderBoxes) colliders.add(cb.min, cb.max);
  }
  return prop.group;
}

export function buildLevel(scene) {
  const root = new THREE.Group();
  scene.add(root);
  const colliders = new BoxSet();
  const zones = {};
  const patrolPoints = [];
  const interactables = [];
  const throwables = [];
  const spawnPoints = [];

  const mFloorIn = matFloor(8);
  const mFloorOut = matDirt(14);
  const mWall = matBrick(2);
  const mWall2 = matConcrete(3);
  const mMetal = matMetal(2);
  const mRoof = matConcrete(6);

  // ---------- Ground ----------
  const groundSize = 400;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize, 96, 96),
    mFloorOut,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  const pos = ground.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    if (Math.abs(x) > 50 || Math.abs(y) > 50) {
      pos.setZ(i, (Math.sin(x * 0.08) + Math.cos(y * 0.07)) * 0.25 + (Math.random() - 0.5) * 0.18);
    }
  }
  pos.needsUpdate = true;
  ground.geometry.computeVertexNormals();
  root.add(ground);

  // ---------- Factory rooms ----------
  function buildRoom(x0, z0, x1, z1, floorY, wallH, { wall = mWall, floorMat = mFloorIn, roofMat = mRoof, thickness = 0.5, doors = [] } = {}) {
    const y0 = floorY, y1 = floorY + wallH;
    blockBox(root, colliders, [x0, y0 - 0.25, z0], [x1, y0, z1], floorMat, { collide: false });
    blockBox(root, colliders, [x0, y1, z0], [x1, y1 + thickness, z1], roofMat, { collide: false, cast: false });

    const wallsByFace = { N: z1 - thickness, S: z0, E: x1 - thickness, W: x0 };
    function wallRow(face) {
      if (face === 'N' || face === 'S') {
        const doorsOnFace = doors.filter(d => d.side === face).sort((a, b) => a.at - b.at);
        let cursor = x0;
        for (const d of doorsOnFace) {
          const dx0 = d.at - d.width / 2;
          if (dx0 > cursor) blockBox(root, colliders, [cursor, y0, wallsByFace[face]], [dx0, y1, wallsByFace[face] + thickness], wall);
          cursor = d.at + d.width / 2;
          blockBox(root, colliders, [dx0, y1 - 1.0, wallsByFace[face]], [cursor, y1, wallsByFace[face] + thickness], wall);
        }
        if (cursor < x1) blockBox(root, colliders, [cursor, y0, wallsByFace[face]], [x1, y1, wallsByFace[face] + thickness], wall);
      } else {
        const doorsOnFace = doors.filter(d => d.side === face).sort((a, b) => a.at - b.at);
        let cursor = z0;
        for (const d of doorsOnFace) {
          const dz0 = d.at - d.width / 2;
          if (dz0 > cursor) blockBox(root, colliders, [wallsByFace[face], y0, cursor], [wallsByFace[face] + thickness, y1, dz0], wall);
          cursor = d.at + d.width / 2;
          blockBox(root, colliders, [wallsByFace[face], y1 - 1.0, dz0], [wallsByFace[face] + thickness, y1, cursor], wall);
        }
        if (cursor < z1) blockBox(root, colliders, [wallsByFace[face], y0, cursor], [wallsByFace[face] + thickness, y1, z1], wall);
      }
    }
    wallRow('N'); wallRow('S'); wallRow('E'); wallRow('W');
  }

  // ---------- Zone 1: Admin ----------
  zones.admin = { min: new THREE.Vector3(-40, 0, -20), max: new THREE.Vector3(-10, 4, 20) };
  buildRoom(-40, -20, -10, 20, 0, 4, {
    doors: [
      { side: 'S', at: -32, width: 3 },
      { side: 'E', at: 10,  width: 3 },
    ],
  });
  blockBox(root, colliders, [-30, 0, 10],   [-29, 3.2, 15], mWall);
  blockBox(root, colliders, [-30, 0, 17],   [-29, 3.2, 20], mWall);
  blockBox(root, colliders, [-30, 2.2, 15], [-29, 3.2, 17], mWall);
  blockBox(root, colliders, [-25, 0, -3], [-24, 3.2, 8], mWall);
  blockBox(root, colliders, [-25, 0, -20], [-24, 3.2, -13], mWall);

  patrolPoints.push(
    { x: -35, y: 0, z: 15, zone: 'admin' },
    { x: -20, y: 0, z: -15, zone: 'admin' },
    { x: -15, y: 0, z: 10, zone: 'admin' },
    { x: -28, y: 0, z: -8, zone: 'admin' },
  );

  // A couple of admin-room crates & barrels
  addProp(root, colliders, buildCrate({ x: -22, z: 17, w: 1.0, h: 0.9, d: 1.0 }));
  addProp(root, colliders, buildCrate({ x: -16, z: -10, w: 1.2, h: 1.2, d: 1.0 }));
  addProp(root, colliders, buildBarrel({ x: -20, z: 5, height: 1.0, color: 0x3a5a2a }));
  addProp(root, colliders, buildBarrel({ x: -14, z: 15, height: 1.0, color: 0x4a2e1a }));

  // ---------- Zone 2: Production ----------
  zones.production = { min: new THREE.Vector3(-10, 0, -24), max: new THREE.Vector3(40, 14, 24) };
  buildRoom(-10, -24, 40, 24, 0, 12, {
    wall: mWall2, roofMat: mMetal,
    doors: [
      { side: 'W', at: 10,  width: 3 },
      { side: 'E', at: 0,   width: 4 },
      { side: 'S', at: 20,  width: 5 },
    ],
  });

  // Columns
  for (let x = 0; x <= 30; x += 10) {
    for (let z = -15; z <= 15; z += 10) {
      blockBox(root, colliders, [x - 0.5, 0, z - 0.5], [x + 0.5, 11.5, z + 0.5], mMetal);
    }
  }

  // Conveyor line with supports
  blockBox(root, colliders, [4, 1.0, -20], [7, 1.3, 20], mMetal, { collide: false });
  for (let z = -20; z <= 20; z += 3) {
    blockBox(root, colliders, [3.6, 0, z - 0.2], [4.0, 1.0, z + 0.2], mMetal);
    blockBox(root, colliders, [7.0, 0, z - 0.2], [7.4, 1.0, z + 0.2], mMetal);
  }
  // Press machines with real detail
  for (const [px, pz] of [[14, -12], [22, -5], [28, 8], [20, 14]]) {
    blockBox(root, colliders, [px - 1.3, 0, pz - 1.3], [px + 1.3, 3.2, pz + 1.3], mMetal);
    blockBox(root, colliders, [px - 0.6, 3.2, pz - 0.6], [px + 0.6, 5.0, pz + 0.6], mMetal);
  }
  // Catwalk
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

  // DETAILED PROPS in production
  // Barrels grouped by pillars
  for (const [bx, bz] of [[0, -18], [10, -20], [24, -18], [36, -4], [2, 20], [18, 22]]) {
    addProp(root, colliders, buildBarrel({ x: bx, z: bz, height: 1.05, color: 0x3a2410 }));
    if (Math.random() < 0.6) addProp(root, colliders, buildBarrel({ x: bx + 1.0, z: bz + 0.3, height: 1.05, color: 0x4a2e1a }));
  }
  // Crate stacks
  addProp(root, colliders, buildCrate({ x: 12, z: 18, w: 1.2, h: 1.0, d: 1.2 }));
  addProp(root, colliders, buildCrate({ x: 12, z: 18, y: 1.0, w: 1.0, h: 0.9, d: 1.0 }));
  addProp(root, colliders, buildCrate({ x: 32, z: -18, w: 1.4, h: 1.1, d: 1.4 }));
  addProp(root, colliders, buildCrate({ x: 32, z: -16.5, w: 1.0, h: 0.9, d: 1.0 }));
  // Industrial pipes running overhead (visual only)
  for (let x = -8; x < 40; x += 6) {
    const p = buildPipeSegment({ x: x + 2, z: -22.5, y: 9.5, length: 5, radius: 0.2, color: 0x5a4a30 });
    root.add(p.group);
    const p2 = buildPipeSegment({ x: x + 2, z: 22.5, y: 9.5, length: 5, radius: 0.2, color: 0x4a5a4a });
    root.add(p2.group);
  }

  patrolPoints.push(
    { x: 0, y: 0, z: 0, zone: 'production' },
    { x: 15, y: 0, z: -18, zone: 'production' },
    { x: 30, y: 0, z: -10, zone: 'production' },
    { x: 35, y: 0, z: 10, zone: 'production' },
    { x: 10, y: 0, z: 18, zone: 'production' },
    { x: 25, y: 0, z: 20, zone: 'production' },
    { x: 18, y: 6.5, z: 0, zone: 'production' },
  );

  // ---------- Zone 3: Warehouse ----------
  zones.warehouse = { min: new THREE.Vector3(40, 0, -18), max: new THREE.Vector3(70, 8, 18) };
  buildRoom(40, -18, 70, 18, 0, 7.5, {
    wall: mWall2, roofMat: mMetal,
    doors: [
      { side: 'W', at: 0, width: 4 },
      { side: 'S', at: 60, width: 3 },
      { side: 'E', at: 0, width: 3 },
    ],
  });
  // Racks (uprights + horizontal shelves, collidable uprights only)
  for (let rz = -14; rz <= 14; rz += 7) {
    for (let rx = 45; rx <= 65; rx += 2.5) {
      blockBox(root, colliders, [rx - 0.1, 0, rz - 1.5], [rx + 0.1, 6.5, rz - 1.3], mMetal);
      blockBox(root, colliders, [rx - 0.1, 0, rz + 1.3], [rx + 0.1, 6.5, rz + 1.5], mMetal);
    }
    for (let sy = 1.4; sy <= 5.8; sy += 2.2) {
      blockBox(root, colliders, [44.8, sy, rz - 1.5], [65.2, sy + 0.15, rz + 1.5], mMetal, { collide: false });
    }
  }
  // Real crates + barrels on the shelves & floor
  for (let rz = -14; rz <= 14; rz += 7) {
    for (let sy = 1.55; sy <= 5.8; sy += 2.2) {
      for (let cx = 46; cx <= 63; cx += 1.6 + Math.random() * 0.8) {
        if (Math.random() < 0.4) {
          addProp(root, colliders,
            buildCrate({ x: cx, z: rz, y: sy, w: 1.0 + Math.random() * 0.3, h: 0.8 + Math.random() * 0.3, d: 1.0 + Math.random() * 0.3 }));
        } else if (Math.random() < 0.6) {
          addProp(root, colliders,
            buildBarrel({ x: cx, z: rz, y: sy, height: 0.9 + Math.random() * 0.2, radius: 0.38 }));
        }
      }
    }
  }
  // Floor clutter
  for (let i = 0; i < 18; i++) {
    const x = 42 + Math.random() * 26;
    const z = -16 + Math.random() * 32;
    if (Math.abs((z + 14) % 7) < 2) continue;
    if (Math.random() < 0.5) {
      addProp(root, colliders, buildBarrel({ x, z, height: 1.05, radius: 0.42 }));
    } else {
      addProp(root, colliders, buildCrate({ x, z, w: 0.9 + Math.random() * 0.4, h: 0.8 + Math.random() * 0.3, d: 0.9 + Math.random() * 0.4 }));
    }
  }

  patrolPoints.push(
    { x: 45, y: 0, z: -14, zone: 'warehouse' },
    { x: 55, y: 0, z: 0, zone: 'warehouse' },
    { x: 62, y: 0, z: 14, zone: 'warehouse' },
    { x: 48, y: 0, z: 10, zone: 'warehouse' },
    { x: 65, y: 0, z: -10, zone: 'warehouse' },
  );

  // ---------- Zone 4: Tunnels ----------
  zones.tunnels = { min: new THREE.Vector3(40, 0, 18), max: new THREE.Vector3(70, 3, 30) };
  buildRoom(40, 18, 70, 30, 0, 2.8, {
    wall: mMetal, roofMat: mMetal,
    doors: [
      { side: 'N', at: 60, width: 3 },
      { side: 'E', at: 24, width: 3 },
    ],
  });
  for (let x = 41; x < 70; x += 1.8) {
    blockBox(root, colliders, [x, 2.2, 19], [x + 0.3, 2.5, 29.5], mMetal, { collide: false });
  }
  // Real pipes running at waist height
  addProp(root, colliders, buildPipeSegment({ x: 55, z: 22, y: 0.8, length: 24, radius: 0.15 }));
  addProp(root, colliders, buildPipeSegment({ x: 55, z: 27, y: 0.8, length: 24, radius: 0.15, color: 0x3a4a55 }));
  blockBox(root, colliders, [48, 0, 22], [49.5, 1.2, 24], mMetal);
  blockBox(root, colliders, [58, 0, 25], [59.5, 1.2, 27], mMetal);

  patrolPoints.push(
    { x: 47, y: 0, z: 24, zone: 'tunnels' },
    { x: 60, y: 0, z: 25, zone: 'tunnels' },
  );

  // ---------- Zone 5: Outdoor ----------
  zones.outdoor = { min: new THREE.Vector3(-100, 0, -100), max: new THREE.Vector3(100, 20, 100) };

  // Perimeter fence
  const fenceMat = mMetal;
  function fenceLine(x0, z0, x1, z1) {
    if (x0 === x1) blockBox(root, colliders, [x0 - 0.15, 0, Math.min(z0, z1)], [x0 + 0.15, 2.8, Math.max(z0, z1)], fenceMat);
    else blockBox(root, colliders, [Math.min(x0, x1), 0, z0 - 0.15], [Math.max(x0, x1), 2.8, z0 + 0.15], fenceMat);
  }
  fenceLine(-90, -70, -90, 70);
  fenceLine(90, -70, 90, 70);
  fenceLine(-90, -70, 90, -70);

  // --- Shipping containers along east fence ---
  for (let i = 0; i < 6; i++) {
    const zBase = -55 + i * 20 + (Math.random() - 0.5) * 4;
    const color = choose([0x6a1f1f, 0x1f4a6a, 0x5a5a1f, 0x2a5a2a, 0x6a4a1f]);
    const c = buildContainer({ x: 82 + (Math.random() - 0.5) * 2, z: zBase, length: 6, width: 2.4, height: 2.6, color });
    c.group.rotation.y = Math.PI / 2 + (Math.random() - 0.5) * 0.2;
    addProp(root, colliders, c);
    if (Math.random() < 0.5) {
      const c2 = buildContainer({ x: 82 + (Math.random() - 0.5) * 2, z: zBase, y: 2.75, length: 6, width: 2.4, height: 2.6, color: choose([0x4a2a2a, 0x2a4a4a, 0x4a4a2a]) });
      c2.group.rotation.y = Math.PI / 2 + (Math.random() - 0.5) * 0.2;
      addProp(root, colliders, c2);
    }
  }

  // --- Shipping containers to the west (make an outdoor area with cover) ---
  for (let i = 0; i < 4; i++) {
    const xBase = -70 + i * 12 + (Math.random() - 0.5) * 3;
    const color = choose([0x6a1f1f, 0x1f4a6a, 0x5a5a1f, 0x2a5a2a]);
    const c = buildContainer({ x: xBase, z: -40 + (Math.random() - 0.5) * 4, length: 6, width: 2.4, height: 2.6, color });
    addProp(root, colliders, c);
  }

  // --- Rusty cars scattered ---
  for (let i = 0; i < 5; i++) {
    const x = -60 + i * 25 + (Math.random() - 0.5) * 6;
    const z = 40 + (Math.random() - 0.5) * 10;
    addProp(root, colliders, buildRustyCar({ x, z }));
  }
  addProp(root, colliders, buildRustyCar({ x: -55, z: -20 }));
  addProp(root, colliders, buildRustyCar({ x: -25, z: -45 }));

  // --- Concrete barriers near outside entrance ---
  for (let i = 0; i < 5; i++) {
    addProp(root, colliders, buildConcreteBarrier({ x: 22 + i * 2.3, z: -30 }));
  }

  // --- Rocks around the yard ---
  for (let i = 0; i < 40; i++) {
    const x = -85 + Math.random() * 170;
    const z = -85 + Math.random() * 170;
    if (x > -45 && x < 72 && z > -26 && z < 32) continue;
    if (x > 80 && x < 90 && z > -65 && z < 65) continue;
    const size = 0.3 + Math.random() * 0.9;
    addProp(root, colliders, buildRock({ x, z, size }));
  }

  // --- Trees (pines + some dead broadleafs) ---
  const treeCount = 60;
  for (let i = 0; i < treeCount; i++) {
    const x = -85 + Math.random() * 170;
    const z = -85 + Math.random() * 170;
    if (x > -45 && x < 72 && z > -26 && z < 32) continue;
    if (x > 78 && x < 92 && z > -65 && z < 65) continue;
    const scale = 0.8 + Math.random() * 0.8;
    if (Math.random() < 0.75) {
      addProp(root, colliders, buildTree({ x, z, scale, dry: Math.random() < 0.2 }));
    } else {
      addProp(root, colliders, buildBroadleaf({ x, z, scale }));
    }
  }

  // --- High grass patches (cross planes) ---
  const grassMat = new THREE.MeshStandardMaterial({
    color: 0x5a6a38, roughness: 1, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, depthWrite: true,
  });
  const gc = document.createElement('canvas'); gc.width = gc.height = 128;
  const gg = gc.getContext('2d');
  gg.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 70; i++) {
    gg.strokeStyle = `rgba(${60 + Math.random() * 30},${80 + Math.random() * 40},${30 + Math.random() * 20},${0.7})`;
    gg.lineWidth = 1 + Math.random() * 1.5;
    gg.beginPath();
    const x = Math.random() * 128;
    gg.moveTo(x, 128);
    gg.lineTo(x + (Math.random() - 0.5) * 12, 128 - 30 - Math.random() * 70);
    gg.stroke();
  }
  const grassTex = new THREE.CanvasTexture(gc); grassTex.needsUpdate = true;
  grassMat.map = grassTex; grassMat.alphaMap = grassTex; grassMat.needsUpdate = true;
  for (let i = 0; i < 300; i++) {
    const x = -90 + Math.random() * 180;
    const z = -90 + Math.random() * 180;
    if (x > -45 && x < 72 && z > -26 && z < 32) continue;
    if (x > 80 && x < 90 && z > -65 && z < 65) continue;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), grassMat);
    mesh.position.set(x, 0.6, z);
    mesh.rotation.y = Math.random() * Math.PI;
    root.add(mesh);
    const mesh2 = mesh.clone(); mesh2.rotation.y += Math.PI / 2; root.add(mesh2);
  }

  // --- Floodlight pole (visible but off during daytime) ---
  blockBox(root, colliders, [-10, 0, -60], [-9.5, 10, -59.5], mMetal);
  blockBox(root, colliders, [-10, 10, -62], [-6, 10.5, -58], mMetal, { collide: false });

  // ---------- YELLOW TRUCK (detailed) ----------
  const truckPos = new THREE.Vector3(82, 0, 0);
  const truckProp = buildYellowTruck({ x: truckPos.x, z: truckPos.z });
  addProp(root, colliders, truckProp);
  const truck = {
    group: truckProp.group,
    position: truckPos,
    hasPower: false,
    hasKey: false,
    running: false,
    escapeProgress: 0,
    headlights: truckProp.group.userData.headlights || [],
  };
  interactables.push({
    kind: 'truck', truck,
    position: new THREE.Vector3(truckPos.x + 1.4, 1.8, truckPos.z + 1.4),
    radius: 3.2,
    label: () =>
      !truck.hasPower ? 'E: First restore factory power'
      : !truck.hasKey ? 'E: Find the key'
      : !truck.running ? 'E: Start engine'
      : 'E: DRIVE AWAY',
  });

  // ---------- POWER SWITCH ----------
  const switchPos = new THREE.Vector3(-37, 1.2, 15);
  const sw = new THREE.Group();
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.15), mMetal);
  sw.add(panel);
  const lever = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.5, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x992222, emissive: 0x441111, emissiveIntensity: 0.5 }),
  );
  lever.position.set(0, 0.2, 0.12);
  lever.rotation.x = -0.5;
  sw.add(lever);
  sw.position.copy(switchPos);
  root.add(sw);
  interactables.push({
    kind: 'power', switchMesh: sw, lever,
    position: switchPos.clone(),
    radius: 1.8,
    activated: false,
    label: () => 'E: Restore power',
  });

  // ---------- KEY ----------
  const keyPos = new THREE.Vector3(64, 0.9, -10);
  const keyGroup = new THREE.Group();
  const keyBody = new THREE.Mesh(
    new THREE.TorusGeometry(0.1, 0.03, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0xd9a614, emissive: 0x553311, emissiveIntensity: 0.5, metalness: 0.8, roughness: 0.4 }),
  );
  keyGroup.add(keyBody);
  const keyShaft = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.02, 0.28),
    new THREE.MeshStandardMaterial({ color: 0xd9a614, metalness: 0.8, roughness: 0.4 }),
  );
  keyShaft.position.z = 0.2;
  keyGroup.add(keyShaft);
  keyGroup.position.copy(keyPos);
  root.add(keyGroup);
  interactables.push({
    kind: 'key', keyGroup,
    position: keyPos.clone(),
    radius: 1.2,
    picked: false,
    label: () => 'E: Pick up key',
  });

  // ---------- Throwables ----------
  function addThrowable(x, y, z, type) { throwables.push({ x, y, z, type }); }
  for (let i = 0; i < 14; i++) addThrowable(-35 + Math.random() * 25, 0.15, -15 + Math.random() * 30, choose(['bottle', 'can']));
  for (let i = 0; i < 20; i++) addThrowable(-5 + Math.random() * 40, 0.15, -20 + Math.random() * 40, choose(['bottle', 'pipe', 'brick']));
  for (let i = 0; i < 18; i++) addThrowable(42 + Math.random() * 26, 0.15, -16 + Math.random() * 32, choose(['can', 'pipe', 'brick']));
  for (let i = 0; i < 8; i++) addThrowable(42 + Math.random() * 26, 0.15, 20 + Math.random() * 8, choose(['pipe', 'can']));

  // ---------- 20 skeleton spawn points ----------
  spawnPoints.push(
    // Admin (2)
    { x: -18, y: 0, z: -12 }, { x: -14, y: 0, z: 14 },
    // Production (6)
    { x:  6, y: 0, z: -18 }, { x: 22, y: 0, z: -8 },
    { x: 30, y: 0, z: 12 },  { x: 14, y: 0, z: 18 },
    { x:  4, y: 0, z: -4 },  { x: 36, y: 0, z: -16 },
    // Warehouse (4)
    { x: 48, y: 0, z: -10 }, { x: 62, y: 0, z:  6 },
    { x: 54, y: 0, z: 12 },  { x: 66, y: 0, z: -14 },
    // Tunnels (2)
    { x: 48, y: 0, z: 24 },  { x: 62, y: 0, z: 27 },
    // Outdoor (6) — surround the player from multiple sides
    { x:  78, y: 0, z: 20 },
    { x: -30, y: 0, z: -40 },
    { x: -50, y: 0, z:  10 },
    { x: -20, y: 0, z:  50 },
    { x:  40, y: 0, z: -45 },
    { x:  70, y: 0, z: -50 },
  );

  // ---------- Ambient detail: rubble, hanging chains ----------
  for (let i = 0; i < 80; i++) {
    const inFactory = Math.random() < 0.7;
    let x, z;
    if (inFactory) { x = -30 + Math.random() * 90; z = -20 + Math.random() * 40; }
    else { x = -80 + Math.random() * 160; z = -80 + Math.random() * 160;
      if (x > -45 && x < 72 && z > -26 && z < 32) continue; }
    const g = new THREE.BoxGeometry(0.3 + Math.random() * 0.4, 0.1 + Math.random() * 0.15, 0.3 + Math.random() * 0.4);
    const m = new THREE.Mesh(g, mRoof);
    m.position.set(x, 0.05, z);
    m.rotation.y = Math.random() * Math.PI * 2;
    m.castShadow = true; m.receiveShadow = true;
    root.add(m);
  }
  for (let i = 0; i < 10; i++) {
    const x = Math.random() * 38;
    const z = -20 + Math.random() * 40;
    const len = 2 + Math.random() * 4;
    const geom = new THREE.CylinderGeometry(0.03, 0.03, len, 6);
    const chain = new THREE.Mesh(geom, mMetal);
    chain.position.set(x, 12 - len / 2, z);
    chain.userData.sway = { a: Math.random() * Math.PI * 2, amp: 0.01 + Math.random() * 0.015 };
    root.add(chain);
  }

  return {
    root, colliders, zones, patrolPoints, interactables, throwables, spawnPoints, truck,
  };
}

export function zoneAt(zones, x, z) {
  const order = ['admin', 'production', 'warehouse', 'tunnels'];
  for (const name of order) {
    const z2 = zones[name];
    if (!z2) continue;
    if (x >= z2.min.x && x <= z2.max.x && z >= z2.min.z && z <= z2.max.z) return name;
  }
  return 'outdoor';
}
