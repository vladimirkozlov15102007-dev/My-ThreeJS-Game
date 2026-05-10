// Procedural "Old Amber Factory" level for the GLTF Edition.
// Same 5-zone layout as v2 but rebuilt for bright daylight + PBR materials
// + more high-detail props.
import * as THREE from 'three';
// rand/choose may be used by expansions; import kept minimal.
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

  // --- Ground: bright sunny dirt/asphalt with gentle undulation ---
  const mGround = matDirt(18);
  const groundGeom = new THREE.PlaneGeometry(400, 400, 96, 96);
  const gPos = groundGeom.attributes.position;
  for (let i = 0; i < gPos.count; i++) {
    const x = gPos.getX(i), y = gPos.getY(i);
    if (Math.abs(x) > 55 || Math.abs(y) > 55) {
      const h = Math.sin(x * 0.09) * 0.25 + Math.cos(y * 0.07) * 0.3 + (Math.random() - 0.5) * 0.16;
      gPos.setZ(i, h);
    }
  }
  gPos.needsUpdate = true;
  groundGeom.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeom, mGround);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  // Scattered asphalt patches (darker) to break up the ground colour.
  for (let i = 0; i < 16; i++) {
    const x = -80 + Math.random() * 160;
    const z = -80 + Math.random() * 160;
    if (x > -48 && x < 74 && z > -30 && z < 34) continue;
    const patch = new THREE.Mesh(
      new THREE.CircleGeometry(3 + Math.random() * 4, 10),
      new THREE.MeshStandardMaterial({ color: 0x2f2a24, roughness: 1 }),
    );
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(x, 0.02, z);
    patch.receiveShadow = true;
    root.add(patch);
  }

  // Helper to build a walled room with a (shadow-transparent) roof.
  function buildRoom(x0, z0, x1, z1, floorY, wallH, { wall = mWall, floorMat = mFloorIn, roofMat = mRoof, thickness = 0.5, doors = [] } = {}) {
    const y0 = floorY, y1 = floorY + wallH;
    blockBox(root, colliders, [x0, y0 - 0.25, z0], [x1, y0, z1], floorMat, { collide: false });
    // Roof doesn't cast shadows so interiors stay sunny.
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

  // --- Zone 1: Admin corridor ---
  zones.admin = { min: new THREE.Vector3(-40, 0, -20), max: new THREE.Vector3(-10, 4, 20) };
  buildRoom(-40, -20, -10, 20, 0, 4, {
    doors: [{ side: 'S', at: -32, width: 3 }, { side: 'E', at: 10, width: 3 }],
  });
  // Guard-room inner walls
  blockBox(root, colliders, [-30, 0, 10], [-29, 3.2, 15], mWall);
  blockBox(root, colliders, [-30, 0, 17], [-29, 3.2, 20], mWall);
  blockBox(root, colliders, [-30, 2.2, 15], [-29, 3.2, 17], mWall);
  blockBox(root, colliders, [-25, 0, -3], [-24, 3.2, 8], mWall);
  blockBox(root, colliders, [-25, 0, -20], [-24, 3.2, -13], mWall);
  // Desk & chair in guard room (visual)
  blockBox(root, colliders, [-38, 0, 12], [-36, 0.9, 14], mMetal, { collide: false });
  blockBox(root, colliders, [-37.5, 0.9, 12.2], [-36.2, 1.6, 12.4], mMetal, { collide: false });
  // CRT monitor
  blockBox(root, colliders,
    [-37, 0.9, 13], [-36.5, 1.5, 13.5],
    new THREE.MeshStandardMaterial({
      color: 0x1a1a1a, emissive: 0x002211, emissiveIntensity: 0.4, roughness: 0.6,
    }),
    { collide: false, cast: false },
  );
  patrolPoints.push(
    { x: -35, z: 15 }, { x: -20, z: -15 }, { x: -15, z: 10 }, { x: -28, z: -8 },
  );

  // --- Zone 2: Production hall ---
  zones.production = { min: new THREE.Vector3(-10, 0, -24), max: new THREE.Vector3(40, 14, 24) };
  buildRoom(-10, -24, 40, 24, 0, 12, {
    wall: mWall2, roofMat: mMetal,
    doors: [
      { side: 'W', at: 10, width: 3 },
      { side: 'E', at: 0, width: 4 },
      { side: 'S', at: 20, width: 5 },
    ],
  });
  // Support columns.
  for (let x = 0; x <= 30; x += 10) {
    for (let z = -15; z <= 15; z += 10) {
      blockBox(root, colliders, [x - 0.5, 0, z - 0.5], [x + 0.5, 11.5, z + 0.5], mMetal);
    }
  }
  // Conveyor line.
  blockBox(root, colliders, [4, 1.0, -20], [7, 1.3, 20], mMetal, { collide: false });
  for (let z = -20; z <= 20; z += 3) {
    blockBox(root, colliders, [3.6, 0, z - 0.2], [4.0, 1.0, z + 0.2], mMetal);
    blockBox(root, colliders, [7.0, 0, z - 0.2], [7.4, 1.0, z + 0.2], mMetal);
  }
  // Press machines.
  for (const [px, pz] of [[14, -12], [22, -5], [28, 8], [20, 14]]) {
    blockBox(root, colliders, [px - 1.3, 0, pz - 1.3], [px + 1.3, 3.2, pz + 1.3], mMetal);
    blockBox(root, colliders, [px - 0.6, 3.2, pz - 0.6], [px + 0.6, 5.0, pz + 0.6], mMetal);
  }
  // Upper catwalk.
  blockBox(root, colliders, [0, 6.2, -1], [38, 6.5, 1], mMetal, { collide: false });
  for (let x = 0; x <= 38; x += 2) {
    blockBox(root, colliders, [x - 0.05, 6.5, -1.05], [x + 0.05, 7.4, -0.95], mMetal);
    blockBox(root, colliders, [x - 0.05, 6.5, 0.95], [x + 0.05, 7.4, 1.05], mMetal);
  }
  blockBox(root, colliders, [0, 7.3, -1.05], [38, 7.4, -0.95], mMetal);
  blockBox(root, colliders, [0, 7.3, 0.95], [38, 7.4, 1.05], mMetal);
  // Stairs.
  for (let i = 0; i < 10; i++) {
    const y0 = i * 0.6;
    blockBox(root, colliders, [38 - i * 0.6, 0, -2.5], [38 - i * 0.6 + 0.6, y0 + 0.6, -1.5], mMetal);
  }
  patrolPoints.push(
    { x: 0, z: 0 }, { x: 15, z: -18 }, { x: 30, z: -10 },
    { x: 35, z: 10 }, { x: 10, z: 18 }, { x: 25, z: 20 }, { x: 18, z: 0 },
  );

  // --- Zone 3: Warehouse ---
  zones.warehouse = { min: new THREE.Vector3(40, 0, -18), max: new THREE.Vector3(70, 8, 18) };
  buildRoom(40, -18, 70, 18, 0, 7.5, {
    wall: mWall2, roofMat: mMetal,
    doors: [
      { side: 'W', at: 0, width: 4 },
      { side: 'S', at: 60, width: 3 },
      { side: 'E', at: 0, width: 3 },
    ],
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
          const w = 1 + Math.random() * 0.8, h = 0.8 + Math.random() * 0.7;
          blockBox(root, colliders, [cx, sy, rz - 1.2], [cx + w, sy + h, rz + 1.2], mMetal, { collide: false });
        }
      }
    }
  }
  for (let i = 0; i < 25; i++) {
    const x = 42 + Math.random() * 26;
    const z = -16 + Math.random() * 32;
    if (Math.abs((z + 14) % 7) < 2) continue;
    const w = 0.9 + Math.random() * 0.6;
    blockBox(root, colliders, [x, 0, z], [x + w, w, z + w], mMetal);
  }
  patrolPoints.push(
    { x: 45, z: -14 }, { x: 55, z: 0 }, { x: 62, z: 14 },
    { x: 48, z: 10 }, { x: 65, z: -10 },
  );

  // --- Zone 4: Tunnels (narrow, low ceiling) ---
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

  // --- Zone 5: Outdoor yard ---
  zones.outdoor = { min: new THREE.Vector3(-100, 0, -100), max: new THREE.Vector3(100, 20, 100) };

  // Perimeter fence (block visuals).
  function fenceLine(x0, z0, x1, z1) {
    if (x0 === x1) blockBox(root, colliders, [x0 - 0.15, 0, Math.min(z0, z1)], [x0 + 0.15, 2.8, Math.max(z0, z1)], mMetal);
    else blockBox(root, colliders, [Math.min(x0, x1), 0, z0 - 0.15], [Math.max(x0, x1), 2.8, z0 + 0.15], mMetal);
  }
  fenceLine(-90, -70, -90, 70);
  fenceLine(90, -70, 90, 70);
  fenceLine(-90, -70, 90, -70);

  // Outdoor containers (shipping containers lined up).
  for (let i = 0; i < 12; i++) {
    const x = 80 + Math.random() * 8 - 4;
    const z = -60 + i * 10 + (Math.random() - 0.5) * 3;
    const colr = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL((i * 0.13) % 1, 0.55, 0.35),
      roughness: 0.7, metalness: 0.6,
    });
    blockBox(root, colliders, [x, 0, z], [x + 2.4, 2.6, z + 6], colr);
  }
  // Concrete road barriers.
  for (let i = 0; i < 20; i++) {
    const x = -80 + Math.random() * 160;
    const z = -90 + Math.random() * 180;
    if (Math.abs(x) < 45 || (z > -26 && z < 32 && x > -42 && x < 72)) continue;
    blockBox(root, colliders, [x, 0, z], [x + 1.8, 1.0, z + 1], mMetal);
  }

  // Grass: cross-plane billboards in outdoor area.
  const gc = document.createElement('canvas'); gc.width = gc.height = 128;
  const gg = gc.getContext('2d');
  gg.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 80; i++) {
    gg.strokeStyle = `rgba(${60 + Math.random()*30},${95 + Math.random()*50},${30 + Math.random()*25},0.9)`;
    gg.lineWidth = 1 + Math.random() * 1.5;
    gg.beginPath();
    const x = Math.random() * 128;
    gg.moveTo(x, 128);
    gg.lineTo(x + (Math.random() - 0.5) * 12, 128 - 30 - Math.random() * 70);
    gg.stroke();
  }
  const grassTex = new THREE.CanvasTexture(gc); grassTex.colorSpace = THREE.SRGBColorSpace;
  const grassMat = new THREE.MeshStandardMaterial({
    map: grassTex, alphaMap: grassTex, roughness: 1, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, color: 0xbddf9f,
  });
  for (let i = 0; i < 500; i++) {
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

  // Small rocks/pebbles sprinkled.
  for (let i = 0; i < 120; i++) {
    const x = -90 + Math.random() * 180;
    const z = -90 + Math.random() * 180;
    if (x > -45 && x < 72 && z > -26 && z < 32) continue;
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.12 + Math.random() * 0.35, 0),
      new THREE.MeshStandardMaterial({ color: 0x706a5e, roughness: 1 }),
    );
    rock.position.set(x, 0.1 + Math.random() * 0.15, z);
    rock.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    rock.castShadow = true; rock.receiveShadow = true;
    root.add(rock);
  }

  // --- YELLOW TRUCK (escape vehicle) ---
  const truckGroup = new THREE.Group();
  const truckPos = new THREE.Vector3(85, 0, 0);
  truckGroup.position.copy(truckPos);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xf4c828, roughness: 0.45, metalness: 0.55, emissive: 0x1a1000, emissiveIntensity: 0.08,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x334050, roughness: 0.15, metalness: 0.7, transparent: true, opacity: 0.72,
  });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.2, metalness: 1.0 });
  function addTBox(group, min, max, m) {
    const geom = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    const mesh = new THREE.Mesh(geom, m);
    mesh.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }
  addTBox(truckGroup, [0, 0.9, -1.6], [2.2, 2.8, 1.6], bodyMat);                  // cab
  addTBox(truckGroup, [2.2, 0.9, -1.6], [3.6, 2.0, 1.6], bodyMat);                // hood
  addTBox(truckGroup, [0.3, 1.95, -1.4], [2.0, 2.7, 1.4], glassMat);              // windows
  addTBox(truckGroup, [-2.8, 0.8, -1.6], [0, 2.6, 1.6], bodyMat);                 // cargo
  addTBox(truckGroup, [3.4, 1.4, -1.2], [3.7, 1.8, 1.2], chromeMat);              // grille
  addTBox(truckGroup, [-0.05, 2.65, -0.3], [0.1, 3.0, 0.3], chromeMat);           // stack
  for (const [wx, wz] of [[2.8, -1.5], [2.8, 1.5], [-2.0, -1.5], [-2.0, 1.5]]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.5, 18), darkMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.58, wz);
    wheel.castShadow = true;
    truckGroup.add(wheel);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.52, 10), chromeMat);
    rim.rotation.z = Math.PI / 2;
    rim.position.set(wx, 0.58, wz);
    truckGroup.add(rim);
  }
  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xfff0c0, emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.3,
  });
  const hl1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.35), headlightMat);
  hl1.position.set(3.6, 1.6, -1.1); truckGroup.add(hl1);
  const hl2 = hl1.clone(); hl2.position.z = 1.1; truckGroup.add(hl2);
  root.add(truckGroup);
  colliders.add([truckPos.x - 3, 0, truckPos.z - 1.6], [truckPos.x + 3.6, 2.8, truckPos.z + 1.6]);

  const truck = {
    group: truckGroup,
    position: truckPos,
    running: false,
    headlights: [hl1, hl2],
  };
  interactables.push({
    kind: 'truck', truck,
    position: new THREE.Vector3(truckPos.x + 1.1, 1.4, truckPos.z + 1.7),
    radius: 2.6,
    label: () => truck.running ? 'E: DRIVE AWAY' : 'E: Start engine',
  });

  // --- Ambient details: chains, barrels, wooden pallets, crates outside ---
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
  // Barrels scattered.
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x8b3a1e, roughness: 0.6, metalness: 0.55 });
  for (let i = 0; i < 24; i++) {
    const inFactory = Math.random() < 0.5;
    let x, z;
    if (inFactory) { x = -5 + Math.random() * 40; z = -18 + Math.random() * 38; }
    else { x = 72 + Math.random() * 16; z = -60 + Math.random() * 120; }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.0, 16), barrelMat);
    bar.position.set(x, 0.5, z);
    bar.castShadow = true; bar.receiveShadow = true;
    root.add(bar);
    colliders.add([x - 0.45, 0, z - 0.45], [x + 0.45, 1.0, z + 0.45]);
  }
  // Wooden crates (indoor + outdoor).
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a5c32, roughness: 0.85, metalness: 0.05 });
  for (let i = 0; i < 30; i++) {
    const s = 0.7 + Math.random() * 0.5;
    let x, z;
    if (Math.random() < 0.5) { x = 44 + Math.random() * 24; z = 20 + Math.random() * 8; }
    else { x = 72 + Math.random() * 16; z = -50 + Math.random() * 100; }
    const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
    crate.position.set(x, s / 2, z);
    crate.rotation.y = Math.random() * Math.PI;
    crate.castShadow = true; crate.receiveShadow = true;
    root.add(crate);
    colliders.add([x - s / 2, 0, z - s / 2], [x + s / 2, s, z + s / 2]);
  }

  // Broken concrete rubble (visual, non-colliding).
  for (let i = 0; i < 100; i++) {
    const inFactory = Math.random() < 0.6;
    let x, z;
    if (inFactory) { x = -30 + Math.random() * 90; z = -20 + Math.random() * 40; }
    else {
      x = -80 + Math.random() * 160; z = -80 + Math.random() * 160;
      if (x > -45 && x < 72 && z > -26 && z < 32) continue;
    }
    const g = new THREE.BoxGeometry(0.3 + Math.random() * 0.4, 0.12 + Math.random() * 0.18, 0.3 + Math.random() * 0.4);
    const m = new THREE.Mesh(g, mRoof);
    m.position.set(x, 0.07, z);
    m.rotation.y = Math.random() * Math.PI * 2;
    m.castShadow = true; m.receiveShadow = true;
    root.add(m);
  }

  // Floodlight pole.
  blockBox(root, colliders, [-10, 0, -60], [-9.5, 10, -59.5], mMetal);
  blockBox(root, colliders, [-10, 10, -62], [-6, 10.5, -58], mMetal, { collide: false });

  // Skeleton spawn points spread across all zones.
  spawnPoints.push(
    // Admin (3)
    { x: -18, z: -12 }, { x: -14, z: 14 }, { x: -35, z: -8 },
    // Production (6)
    { x: 8, z: -16 }, { x: 22, z: -8 }, { x: 30, z: 12 },
    { x: 14, z: 18 }, { x: -3, z: 0 }, { x: 35, z: -18 },
    // Warehouse (5)
    { x: 52, z: -10 }, { x: 62, z: 6 }, { x: 48, z: 14 },
    { x: 58, z: -14 }, { x: 66, z: 0 },
    // Tunnels (2)
    { x: 48, z: 24 }, { x: 62, z: 27 },
    // Outdoor yard (4)
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
