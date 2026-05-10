// Procedural "Old Amber Factory" level.
// 5 zones in a single connected map, built from boxes + props with collision.
import * as THREE from 'three';
import { rand, randInt, choose, makeRng } from './utils.js';
import {
  matConcrete, matMetal, matBrick, matFloor, matDirt,
} from './materials.js';

// Collision box container
export class BoxSet {
  constructor() { this.boxes = []; }
  add(min, max, data = {}) {
    this.boxes.push({ min: new THREE.Vector3(...min), max: new THREE.Vector3(...max), ...data });
  }
}

// Build a box mesh at given range with a material; also adds a collision box.
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
  // Semantic zones with bounding regions (used for audio reverb hints / spawn areas).
  const zones = {};
  // Patrol points per zone
  const patrolPoints = [];
  // Interactables that we can reference (truck, key, power)
  const interactables = [];
  // Throwables are spawned here with a position; ThrowSystem will build meshes.
  const throwables = [];
  // Free "spawn" floor positions for skeletons
  const spawnPoints = [];

  const mFloorIn = matFloor(8);
  const mFloorOut = matDirt(14);
  const mWall = matBrick(2);
  const mWall2 = matConcrete(3);
  const mMetal = matMetal(2);
  const mRoof = matConcrete(6);

  // --- Global ground (outdoor yard) ---
  // We'll put everything on a large base plane, with indoor floor on top where needed.
  const groundSize = 400;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize, 64, 64),
    mFloorOut,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  // Some gentle unevenness
  const pos = ground.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    if (Math.abs(x) > 50 || Math.abs(y) > 50) {
      pos.setZ(i, (Math.sin(x * 0.08) + Math.cos(y * 0.07)) * 0.18 + (Math.random() - 0.5) * 0.12);
    }
  }
  pos.needsUpdate = true;
  ground.geometry.computeVertexNormals();
  root.add(ground);

  // --- Factory bounding envelope ---
  // Admin (small)   : x -40..-10, z -20..20  (enter from -40)
  // Production (big): x -10..40,  z -24..24
  // Warehouse       : x  40..70,  z -18..18
  // Tunnels         : x  40..70,  z  18..30  (low, narrow) -> leads out
  // Outdoor yard    : x anywhere outside factory, truck at x=85,z=0

  // Helper to build a walled room with roof.
  function buildRoom(x0, z0, x1, z1, floorY, wallH, { wall = mWall, floorMat = mFloorIn, roofMat = mRoof, thickness = 0.5, doors = [] } = {}) {
    const y0 = floorY, y1 = floorY + wallH;
    // Floor
    blockBox(root, colliders, [x0, y0 - 0.25, z0], [x1, y0, z1], floorMat, { collide: false });
    // Roof — NON-CASTING so sunlight floods the interior without being blocked by the ceiling.
    // The roof mesh is still visible but doesn't appear in the shadow map.
    blockBox(root, colliders, [x0, y1, z0], [x1, y1 + thickness, z1], roofMat, { collide: false, cast: false });

    // Walls with door gaps. doors = [{ side: 'N'|'S'|'E'|'W', at:number, width }]
    const wallsByFace = { N: z1 - thickness, S: z0, E: x1 - thickness, W: x0 };

    function wallRow(face) {
      if (face === 'N' || face === 'S') {
        // Along X
        const doorsOnFace = doors.filter(d => d.side === face).sort((a, b) => a.at - b.at);
        let cursor = x0;
        for (const d of doorsOnFace) {
          const dx0 = d.at - d.width / 2;
          if (dx0 > cursor) {
            blockBox(root, colliders,
              [cursor, y0, wallsByFace[face]],
              [dx0, y1, wallsByFace[face] + thickness], wall);
          }
          cursor = d.at + d.width / 2;
          // Lintel above door
          blockBox(root, colliders,
            [dx0, y1 - 1.0, wallsByFace[face]],
            [cursor, y1, wallsByFace[face] + thickness], wall);
        }
        if (cursor < x1) {
          blockBox(root, colliders,
            [cursor, y0, wallsByFace[face]],
            [x1, y1, wallsByFace[face] + thickness], wall);
        }
      } else {
        const doorsOnFace = doors.filter(d => d.side === face).sort((a, b) => a.at - b.at);
        let cursor = z0;
        for (const d of doorsOnFace) {
          const dz0 = d.at - d.width / 2;
          if (dz0 > cursor) {
            blockBox(root, colliders,
              [wallsByFace[face], y0, cursor],
              [wallsByFace[face] + thickness, y1, dz0], wall);
          }
          cursor = d.at + d.width / 2;
          blockBox(root, colliders,
            [wallsByFace[face], y1 - 1.0, dz0],
            [wallsByFace[face] + thickness, y1, cursor], wall);
        }
        if (cursor < z1) {
          blockBox(root, colliders,
            [wallsByFace[face], y0, cursor],
            [wallsByFace[face] + thickness, y1, z1], wall);
        }
      }
    }
    wallRow('N'); wallRow('S'); wallRow('E'); wallRow('W');
  }

  // --- Zone 1: Admin corridor ---
  zones.admin = { min: new THREE.Vector3(-40, 0, -20), max: new THREE.Vector3(-10, 4, 20) };
  buildRoom(-40, -20, -10, 20, 0, 4, {
    doors: [
      { side: 'S', at: -32, width: 3 },  // entrance from outside
      { side: 'E', at: 10,  width: 3 },  // to production (east wall at x=-10, door along Z)
    ],
  });

  // Inner offices - partial walls
  // Guard room: -40..-30, 10..20, with a doorway at z=16
  blockBox(root, colliders, [-30, 0, 10],   [-29, 3.2, 15], mWall);
  blockBox(root, colliders, [-30, 0, 17],   [-29, 3.2, 20], mWall);
  blockBox(root, colliders, [-30, 2.2, 15], [-29, 3.2, 17], mWall); // lintel over door
  // Corridor dividers (walk around on either end)
  blockBox(root, colliders, [-25, 0, -3], [-24, 3.2, 8], mWall);
  blockBox(root, colliders, [-25, 0, -20], [-24, 3.2, -13], mWall);

  patrolPoints.push(
    { x: -35, y: 0, z: 15, zone: 'admin' },
    { x: -20, y: 0, z: -15, zone: 'admin' },
    { x: -15, y: 0, z: 10, zone: 'admin' },
    { x: -28, y: 0, z: -8, zone: 'admin' },
  );

  // --- Zone 2: Main production hall ---
  zones.production = { min: new THREE.Vector3(-10, 0, -24), max: new THREE.Vector3(40, 14, 24) };
  buildRoom(-10, -24, 40, 24, 0, 12, {
    wall: mWall2, roofMat: mMetal,
    doors: [
      { side: 'W', at: 10,  width: 3 },   // from admin
      { side: 'E', at: 0,   width: 4 },   // to warehouse
      { side: 'S', at: 20,  width: 5 },   // big gate to outside yard
    ],
  });

  // Support columns
  for (let x = 0; x <= 30; x += 10) {
    for (let z = -15; z <= 15; z += 10) {
      blockBox(root, colliders, [x - 0.5, 0, z - 0.5], [x + 0.5, 11.5, z + 0.5], mMetal);
    }
  }

  // Catwalks + metal ramps on two levels
  // Lower conveyor line along Z at x=5
  blockBox(root, colliders, [4, 1.0, -20], [7, 1.3, 20], mMetal, { collide: false });
  for (let z = -20; z <= 20; z += 3) {
    blockBox(root, colliders, [3.6, 0, z - 0.2], [4.0, 1.0, z + 0.2], mMetal);
    blockBox(root, colliders, [7.0, 0, z - 0.2], [7.4, 1.0, z + 0.2], mMetal);
  }
  // Press machines
  for (const [px, pz] of [[14, -12], [22, -5], [28, 8], [20, 14]]) {
    blockBox(root, colliders, [px - 1.3, 0, pz - 1.3], [px + 1.3, 3.2, pz + 1.3], mMetal);
    blockBox(root, colliders, [px - 0.6, 3.2, pz - 0.6], [px + 0.6, 5.0, pz + 0.6], mMetal);
  }
  // Upper catwalk
  blockBox(root, colliders, [0, 6.2, -1], [38, 6.5, 1], mMetal, { collide: false });
  // rails
  for (let x = 0; x <= 38; x += 2) {
    blockBox(root, colliders, [x - 0.05, 6.5, -1.05], [x + 0.05, 7.4, -0.95], mMetal);
    blockBox(root, colliders, [x - 0.05, 6.5, 0.95], [x + 0.05, 7.4, 1.05], mMetal);
  }
  blockBox(root, colliders, [0, 7.3, -1.05], [38, 7.4, -0.95], mMetal);
  blockBox(root, colliders, [0, 7.3, 0.95], [38, 7.4, 1.05], mMetal);
  // Stairs up to catwalk
  for (let i = 0; i < 10; i++) {
    const y0 = i * 0.6;
    blockBox(root, colliders,
      [38 - i * 0.6, 0, -2.5],
      [38 - i * 0.6 + 0.6, y0 + 0.6, -1.5], mMetal);
  }

  patrolPoints.push(
    { x: 0, y: 0, z: 0, zone: 'production' },
    { x: 15, y: 0, z: -18, zone: 'production' },
    { x: 30, y: 0, z: -10, zone: 'production' },
    { x: 35, y: 0, z: 10, zone: 'production' },
    { x: 10, y: 0, z: 18, zone: 'production' },
    { x: 25, y: 0, z: 20, zone: 'production' },
    { x: 18, y: 6.5, z: 0, zone: 'production' }, // catwalk
  );

  // --- Zone 3: Warehouse ---
  zones.warehouse = { min: new THREE.Vector3(40, 0, -18), max: new THREE.Vector3(70, 8, 18) };
  buildRoom(40, -18, 70, 18, 0, 7.5, {
    wall: mWall2, roofMat: mMetal,
    doors: [
      { side: 'W', at: 0, width: 4 }, // from production
      { side: 'S', at: 60, width: 3 }, // to tunnels entry (south-east corner)
      { side: 'E', at: 0, width: 3 }, // to outdoor yard (east)
    ],
  });

  // Racks
  for (let rz = -14; rz <= 14; rz += 7) {
    for (let rx = 45; rx <= 65; rx += 2.5) {
      // uprights
      blockBox(root, colliders, [rx - 0.1, 0, rz - 1.5], [rx + 0.1, 6.5, rz - 1.3], mMetal);
      blockBox(root, colliders, [rx - 0.1, 0, rz + 1.3], [rx + 0.1, 6.5, rz + 1.5], mMetal);
    }
    // shelves
    for (let sy = 1.4; sy <= 5.8; sy += 2.2) {
      blockBox(root, colliders, [44.8, sy, rz - 1.5], [65.2, sy + 0.15, rz + 1.5], mMetal, { collide: false });
    }
    // crates on shelves
    for (let cx = 45; cx <= 64; cx += 2 + Math.random() * 1.5) {
      for (let sy = 1.55; sy <= 6; sy += 2.2) {
        if (Math.random() < 0.55) {
          const w = 1 + Math.random() * 0.8, h = 0.8 + Math.random() * 0.7;
          blockBox(root, colliders, [cx, sy, rz - 1.2], [cx + w, sy + h, rz + 1.2], mMetal, { collide: false });
        }
      }
    }
  }
  // Scattered barrels/crates on floor
  for (let i = 0; i < 25; i++) {
    const x = 42 + Math.random() * 26;
    const z = -16 + Math.random() * 32;
    if (Math.abs((z + 14) % 7) < 2) continue;
    const w = 0.9 + Math.random() * 0.6;
    blockBox(root, colliders, [x, 0, z], [x + w, w, z + w], mMetal);
  }

  patrolPoints.push(
    { x: 45, y: 0, z: -14, zone: 'warehouse' },
    { x: 55, y: 0, z: 0, zone: 'warehouse' },
    { x: 62, y: 0, z: 14, zone: 'warehouse' },
    { x: 48, y: 0, z: 10, zone: 'warehouse' },
    { x: 65, y: 0, z: -10, zone: 'warehouse' },
  );

  // --- Zone 4: Tunnels (narrow, low ceiling) ---
  zones.tunnels = { min: new THREE.Vector3(40, 0, 18), max: new THREE.Vector3(70, 3, 30) };
  buildRoom(40, 18, 70, 30, 0, 2.8, {
    wall: mMetal, roofMat: mMetal,
    doors: [
      { side: 'N', at: 60, width: 3 }, // back to warehouse south
      { side: 'E', at: 24, width: 3 }, // exit to outdoor yard
    ],
  });
  // Pipes running along
  for (let x = 41; x < 70; x += 1.8) {
    blockBox(root, colliders, [x, 2.2, 19], [x + 0.3, 2.5, 29.5], mMetal, { collide: false });
  }
  // A couple of low obstacles
  blockBox(root, colliders, [48, 0, 22], [49.5, 1.2, 24], mMetal);
  blockBox(root, colliders, [58, 0, 25], [59.5, 1.2, 27], mMetal);

  patrolPoints.push(
    { x: 47, y: 0, z: 24, zone: 'tunnels' },
    { x: 60, y: 0, z: 25, zone: 'tunnels' },
  );

  // --- Zone 5: Outdoor yard ---
  zones.outdoor = { min: new THREE.Vector3(-100, 0, -100), max: new THREE.Vector3(100, 20, 100) };

  // Perimeter fence (visual) - just blockers around yard
  const fenceMat = mMetal;
  function fenceLine(x0, z0, x1, z1) {
    if (x0 === x1) {
      blockBox(root, colliders, [x0 - 0.15, 0, Math.min(z0, z1)], [x0 + 0.15, 2.8, Math.max(z0, z1)], fenceMat);
    } else {
      blockBox(root, colliders, [Math.min(x0, x1), 0, z0 - 0.15], [Math.max(x0, x1), 2.8, z0 + 0.15], fenceMat);
    }
  }
  // perimeter around the factory footprint (with gaps near exits)
  fenceLine(-90, -70, -90, 70);
  fenceLine(90, -70, 90, 70);
  fenceLine(-90, -70, 90, -70);
  // North side open for dramatic fog

  // Scattered outdoor props: rusty cars, containers, concrete blocks
  for (let i = 0; i < 12; i++) {
    const x = 80 + Math.random() * 8 - 4;
    const z = -60 + i * 10 + (Math.random() - 0.5) * 3;
    blockBox(root, colliders, [x, 0, z], [x + 2.4, 1.4, z + 5], mMetal); // container
    blockBox(root, colliders, [x + 0.2, 1.4, z + 0.2], [x + 2.2, 1.42, z + 4.8], mMetal, { collide: false });
  }
  for (let i = 0; i < 20; i++) {
    const x = -80 + Math.random() * 160;
    const z = -90 + Math.random() * 180;
    if (Math.abs(x) < 45 || (z > -26 && z < 32 && x > -42 && x < 72)) continue; // skip near factory
    blockBox(root, colliders, [x, 0, z], [x + 1.6, 0.8, z + 1], mMetal);
  }
  // Hi grass bushes (visual) - cross planes
  const grassMat = new THREE.MeshStandardMaterial({
    color: 0x5a6a38, roughness: 1, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, depthWrite: true,
  });
  // Build a grass texture once
  const gc = document.createElement('canvas'); gc.width = gc.height = 128;
  const gg = gc.getContext('2d');
  gg.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 70; i++) {
    gg.strokeStyle = `rgba(${60 + Math.random()*30},${80 + Math.random()*40},${30 + Math.random()*20},${0.7})`;
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
    if (x > -45 && x < 72 && z > -26 && z < 32) continue; // skip indoors area
    if (x > 80 && x < 90 && z > -65 && z < 65) continue;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), grassMat);
    mesh.position.set(x, 0.6, z);
    mesh.rotation.y = Math.random() * Math.PI;
    root.add(mesh);
    const mesh2 = mesh.clone(); mesh2.rotation.y += Math.PI / 2; root.add(mesh2);
  }

  // Flood/prospect light pole pointing at yard
  // (light itself added by main; here just a pole)
  blockBox(root, colliders, [-10, 0, -60], [-9.5, 10, -59.5], mMetal);
  blockBox(root, colliders, [-10, 10, -62], [-6, 10.5, -58], mMetal, { collide: false });

  // --- YELLOW TRUCK ---
  const truckGroup = new THREE.Group();
  const truckPos = new THREE.Vector3(85, 0, 0);
  truckGroup.position.copy(truckPos);
  // chassis
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd9a614, roughness: 0.55, metalness: 0.4 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x223038, roughness: 0.15, metalness: 0.6, transparent: true, opacity: 0.6 });
  function addTruckBox(group, min, max, m) {
    const geom = new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    const mesh = new THREE.Mesh(geom, m);
    mesh.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }
  // cab
  addTruckBox(truckGroup, [0, 0.9, -1.6], [2.2, 2.6, 1.6], bodyMat);
  // hood
  addTruckBox(truckGroup, [2.2, 0.9, -1.6], [3.6, 2.0, 1.6], bodyMat);
  // windows
  addTruckBox(truckGroup, [0.3, 1.9, -1.4], [2.0, 2.55, 1.4], glassMat);
  // bed / rear cargo
  addTruckBox(truckGroup, [-2.8, 0.8, -1.6], [0, 2.4, 1.6], bodyMat);
  // wheels
  for (const [wx, wz] of [[2.8, -1.5], [2.8, 1.5], [-2.0, -1.5], [-2.0, 1.5]]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.5, 16), darkMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.55, wz);
    wheel.castShadow = true;
    truckGroup.add(wheel);
  }
  // headlights
  const headlightMat = new THREE.MeshStandardMaterial({ color: 0xfff1c4, emissive: 0xfff1c4, emissiveIntensity: 0.4 });
  const hl1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.25, 0.35), headlightMat);
  hl1.position.set(3.6, 1.6, -1.1); truckGroup.add(hl1);
  const hl2 = hl1.clone(); hl2.position.z = 1.1; truckGroup.add(hl2);
  truckGroup.userData.headlights = [hl1, hl2];

  root.add(truckGroup);
  // Collider for truck (rough block)
  colliders.add([truckPos.x - 3, 0, truckPos.z - 1.6], [truckPos.x + 3.6, 2.6, truckPos.z + 1.6]);

  const truck = {
    group: truckGroup,
    position: truckPos,
    hasPower: false,
    hasKey: false,
    running: false,
    escapeProgress: 0, // 0..1
    headlights: [hl1, hl2],
  };
  interactables.push({
    kind: 'truck', truck,
    position: new THREE.Vector3(truckPos.x + 1.1, 1.4, truckPos.z + 1.7),
    radius: 2.2,
    label: () =>
      !truck.hasPower ? 'E: First restore factory power'
      : !truck.hasKey ? 'E: Find the key'
      : !truck.running ? 'E: Start engine'
      : 'E: DRIVE AWAY',
  });

  // --- POWER SWITCH (in admin guard room) ---
  const switchPos = new THREE.Vector3(-37, 1.2, 15);
  const sw = new THREE.Group();
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.15), mMetal);
  sw.add(panel);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x992222, emissive: 0x441111, emissiveIntensity: 0.5 }));
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

  // --- KEY (somewhere in warehouse — hidden behind racks) ---
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

  // --- Ambient throwables (bottles, pipes, bricks, cans) ---
  function addThrowable(x, y, z, type) {
    throwables.push({ x, y, z, type });
  }
  for (let i = 0; i < 14; i++) {
    addThrowable(-35 + Math.random() * 25, 0.15, -15 + Math.random() * 30, choose(['bottle', 'can']));
  }
  for (let i = 0; i < 20; i++) {
    addThrowable(-5 + Math.random() * 40, 0.15, -20 + Math.random() * 40, choose(['bottle', 'pipe', 'brick']));
  }
  for (let i = 0; i < 18; i++) {
    addThrowable(42 + Math.random() * 26, 0.15, -16 + Math.random() * 32, choose(['can', 'pipe', 'brick']));
  }
  for (let i = 0; i < 8; i++) {
    addThrowable(42 + Math.random() * 26, 0.15, 20 + Math.random() * 8, choose(['pipe', 'can']));
  }

  // --- Skeleton spawn points (spread across zones) ---
  spawnPoints.push(
    { x: -18, y: 0, z: -12 }, { x: -14, y: 0, z: 14 },          // admin (2)
    { x: 8, y: 0, z: -16 }, { x: 22, y: 0, z: -8 },
    { x: 30, y: 0, z: 12 }, { x: 14, y: 0, z: 18 },             // production (4)
    { x: 52, y: 0, z: -10 }, { x: 62, y: 0, z: 6 },              // warehouse (2)
    { x: 48, y: 0, z: 24 },                                      // tunnels (1)
    { x: 78, y: 0, z: 20 },                                      // outdoor near fence (1)
  );

  // -- Scatter ambient detail: broken concrete, random rotated debris (visual only) --
  for (let i = 0; i < 80; i++) {
    const inFactory = Math.random() < 0.7;
    let x, z;
    if (inFactory) {
      x = -30 + Math.random() * 90; z = -20 + Math.random() * 40;
    } else {
      x = -80 + Math.random() * 160; z = -80 + Math.random() * 160;
      if (x > -45 && x < 72 && z > -26 && z < 32) continue;
    }
    const g = new THREE.BoxGeometry(0.3 + Math.random() * 0.4, 0.1 + Math.random() * 0.15, 0.3 + Math.random() * 0.4);
    const m = new THREE.Mesh(g, mRoof);
    m.position.set(x, 0.05, z);
    m.rotation.y = Math.random() * Math.PI * 2;
    m.castShadow = true; m.receiveShadow = true;
    root.add(m);
  }

  // hanging chain decorations
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
    root,
    colliders,
    zones,
    patrolPoints,
    interactables,
    throwables,
    spawnPoints,
    truck,
  };
}

// Determine zone name for a world XZ point (for audio / AI hints).
export function zoneAt(zones, x, z) {
  // Check specific interior zones first; fall back to outdoor.
  const order = ['admin', 'production', 'warehouse', 'tunnels'];
  for (const name of order) {
    const z2 = zones[name];
    if (!z2) continue;
    if (x >= z2.min.x && x <= z2.max.x && z >= z2.min.z && z <= z2.max.z) return name;
  }
  return 'outdoor';
}
