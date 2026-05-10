// Hyper-aggressive skeleton archer.
//
// Uses a fully-articulated procedural humanoid rig with separate shoulder,
// elbow, wrist, pelvis, knee, ankle bone groups so that the bow-draw can be
// driven with true IK: left arm extends to hold the bow, right hand pulls
// back toward the jaw, bowstring deforms, release snaps forward. A high
// number of geometric details (ribcage bars, pelvis, vertebrae, cracked
// skull with glowing eyes, quiver with visible arrows, cloth tatters and
// rusty armor pieces) makes these look much closer to real skeletal
// remains than simple boxes.
import * as THREE from 'three';
import { clamp, damp, raySegBoxHit, approachYaw } from './utils.js';
import { matBone } from './materials.js';

const STATES = {
  PATROL: 'patrol',
  COMBAT: 'combat',
  FLANK: 'flank',
  SEARCH: 'search',
  DEAD: 'dead',
};

// Hit-zone AABBs (offsets from skeleton root in world scale).
const HIT_ZONES = [
  { name: 'head',  min: [-0.25, 1.55, -0.25], max: [0.25, 1.95, 0.25] },
  { name: 'torso', min: [-0.38, 0.70, -0.35], max: [0.38, 1.55, 0.35] },
  { name: 'legs',  min: [-0.38, 0.00, -0.35], max: [0.38, 0.70, 0.35] },
];

let _uid = 0;

export class Skeleton {
  constructor(scene, spawn, options = {}) {
    this.id = _uid++;
    this.scene = scene;
    this.position = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.velocity = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.alive = true;

    // Hyper-aggressive tuning.
    this.hp = 100;
    this.maxHp = 100;
    this.arrows = 999;  // effectively infinite quiver — they will chase you forever
    this.meleeDamage = 28;
    this.arrowDamageByZone = { head: 30, torso: 20, legs: 10 };

    this.state = STATES.COMBAT; // spawn straight into combat - "super-aggressive, attack immediately"
    this.stateT = 0;
    this.target = null;
    this.lastKnownTarget = null;
    this.awareness = 1.0;   // fully aware from spawn
    this.drawT = 0;         // 0..1 bow-draw progress
    this.drawSpeed = 1.8 + Math.random() * 0.5;
    this.cooldownShoot = Math.random() * 0.6; // first shot within ~0.6s of spawn
    this.meleeCooldown = 0;
    this.meleeActive = false;
    this.meleeSwingT = 0;
    this.meleeSwingDur = 0.48;
    this.meleeHitThisSwing = false;
    this.flankSide = Math.random() < 0.5 ? -1 : 1;
    this.path = [];
    this.pathIdx = 0;
    this.pathStuckT = 0;

    this._releasePulseT = 0;   // 0..1 decays on release for animating snap
    this._walkT = 0;

    // Per-skeleton variation.
    this.scale = 1.0 + (Math.random() - 0.5) * 0.12;
    this.speedMul = 1.15 + Math.random() * 0.2;

    // Build hierarchy.
    this.group = new THREE.Group();
    this.group.position.copy(this.position);
    this.group.scale.setScalar(this.scale);
    scene.add(this.group);
    this._buildBody();

    this.ragdollT = 0;
    this.ragdollLean = new THREE.Vector3();
  }

  // -------- Body construction --------
  _buildBody() {
    const bMat = matBone();
    const dirty = matBone();
    dirty.color.setHex(0x8d7c56);
    const cloth = new THREE.MeshStandardMaterial({
      color: 0x453020, roughness: 1.0, metalness: 0,
      side: THREE.DoubleSide, transparent: true, alphaTest: 0.3,
    });
    const rust = new THREE.MeshStandardMaterial({
      color: 0x5a3a20, roughness: 0.55, metalness: 0.7, emissive: 0x150800, emissiveIntensity: 0.15,
    });

    const G = this.group;

    // --- Pelvis ---
    const pelvis = new THREE.Group();
    pelvis.position.y = 0.8;
    G.add(pelvis);
    this._pelvis = pelvis;
    const pelvisMesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.25), bMat);
    pelvis.add(pelvisMesh);
    // Iliac crests (sides of pelvis)
    for (const sx of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.14), bMat);
      wing.position.set(sx * 0.22, 0.04, -0.04);
      wing.rotation.z = sx * 0.35;
      pelvis.add(wing);
    }

    // --- Spine (segmented vertebrae) ---
    const spine = new THREE.Group();
    spine.position.y = 0.1;
    pelvis.add(spine);
    this._spine = spine;
    for (let i = 0; i < 5; i++) {
      const v = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05 - i * 0.004, 0.055 - i * 0.004, 0.075, 10),
        bMat,
      );
      v.position.y = 0.06 + i * 0.09;
      spine.add(v);
      // side processes
      const proc1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.03), bMat);
      proc1.position.y = v.position.y;
      spine.add(proc1);
    }

    // --- Chest / ribcage carrier ---
    const chest = new THREE.Group();
    chest.position.y = 0.55;
    pelvis.add(chest);
    this._chest = chest;
    // Sternum
    const sternum = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.05), bMat);
    sternum.position.set(0, 0.0, 0.18);
    chest.add(sternum);
    // Curved ribs (half-tori) - 6 pairs
    for (let i = 0; i < 6; i++) {
      const r = 0.22 - i * 0.01;
      for (const side of [-1, 1]) {
        const rib = new THREE.Mesh(
          new THREE.TorusGeometry(r, 0.016, 4, 12, Math.PI),
          bMat,
        );
        rib.position.set(0, -0.18 + i * 0.072, 0.03);
        rib.rotation.x = Math.PI / 2;
        rib.rotation.z = side > 0 ? 0 : Math.PI;
        chest.add(rib);
      }
    }
    // Shoulder blades
    for (const side of [-1, 1]) {
      const sb = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.03), bMat);
      sb.position.set(side * 0.16, 0.18, -0.15);
      chest.add(sb);
    }
    // Rusted chest plate on top
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.42, 0.06), rust);
    plate.position.set(0, 0.06, 0.2);
    plate.castShadow = true; plate.receiveShadow = true;
    chest.add(plate);
    // Shoulder strap (cloth)
    const strap = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.5), cloth);
    strap.position.set(0.1, 0.05, 0.22);
    strap.rotation.z = 0.2;
    chest.add(strap);

    // --- Neck + Head ---
    const neck = new THREE.Group();
    neck.position.y = 0.42;
    chest.add(neck);
    this._neck = neck;
    const neckBone = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.12, 8), bMat);
    neckBone.position.y = 0.06;
    neck.add(neckBone);

    const head = new THREE.Group();
    head.position.y = 0.22;
    neck.add(head);
    this._head = head;
    // Cranium
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), bMat);
    skull.scale.set(1, 1.15, 1.1);
    head.add(skull);
    // Jaw
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.07, 0.18), dirty);
    jaw.position.set(0, -0.14, 0.02);
    head.add(jaw);
    // Teeth hint
    for (let i = -3; i <= 3; i++) {
      const th = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.02, 0.015), bMat);
      th.position.set(i * 0.022, -0.107, 0.1);
      head.add(th);
    }
    // Eye sockets (dark)
    for (const ex of [-0.055, 0.055]) {
      const socket = new THREE.Mesh(
        new THREE.SphereGeometry(0.033, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 1 }),
      );
      socket.position.set(ex, 0.02, 0.11);
      head.add(socket);
    }
    // Glowing red eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2a10, transparent: true, opacity: 0.95 });
    for (const ex of [-0.055, 0.055]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), eyeMat);
      eye.position.set(ex, 0.022, 0.135);
      head.add(eye);
    }
    const eyeLight = new THREE.PointLight(0xff3020, 0.9, 4, 2);
    eyeLight.position.set(0, 0.02, 0.13);
    head.add(eyeLight);
    this._eyeLight = eyeLight;
    this._eyeMat = eyeMat;
    // Cracks in the skull (dark lines)
    for (let i = 0; i < 3; i++) {
      const crack = new THREE.Mesh(
        new THREE.BoxGeometry(0.003, 0.05 + Math.random() * 0.05, 0.003),
        new THREE.MeshBasicMaterial({ color: 0x1a0f08 }),
      );
      crack.position.set((Math.random() - 0.5) * 0.2, 0.05 + Math.random() * 0.05, 0.13);
      crack.rotation.z = (Math.random() - 0.5) * 1.5;
      head.add(crack);
    }

    // --- Arms ---
    const makeArm = (side /* -1 left, +1 right */) => {
      // Shoulder group - rotates shoulder joint
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.22, 0.32, 0);
      chest.add(shoulder);
      // Shoulder bone ball
      const sBall = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), bMat);
      shoulder.add(sBall);
      // Upper arm (humerus)
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.032, 0.34, 8), bMat);
      upper.position.y = -0.17;
      shoulder.add(upper);
      // Elbow group - rotates forearm
      const elbow = new THREE.Group();
      elbow.position.y = -0.34;
      shoulder.add(elbow);
      const eBall = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), bMat);
      elbow.add(eBall);
      // Forearm (ulna+radius simplified)
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.025, 0.30, 8), bMat);
      lower.position.y = -0.15;
      elbow.add(lower);
      // Wrist + hand
      const wrist = new THREE.Group();
      wrist.position.y = -0.30;
      elbow.add(wrist);
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.09), bMat);
      palm.position.y = -0.05;
      wrist.add(palm);
      // Finger bones
      for (let f = 0; f < 4; f++) {
        const finger = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.06, 0.012), bMat);
        finger.position.set(-0.025 + f * 0.016, -0.12, 0.02);
        wrist.add(finger);
      }
      // Thumb
      const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.045, 0.014), bMat);
      thumb.position.set(side * 0.03, -0.08, 0.025);
      thumb.rotation.z = side * 0.5;
      wrist.add(thumb);

      // Cloth tatter on upper arm
      const tatter = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.22), cloth);
      tatter.position.set(0, -0.18, 0.05);
      tatter.rotation.y = side * 0.3;
      shoulder.add(tatter);

      return { shoulder, elbow, wrist };
    };
    this._armL = makeArm(-1);
    this._armR = makeArm(1);

    // --- Legs ---
    const makeLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.12, -0.05, 0);
      pelvis.add(hip);
      const hipBall = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), bMat);
      hip.add(hipBall);
      // Femur
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.38, 8), bMat);
      upper.position.y = -0.19;
      hip.add(upper);
      const knee = new THREE.Group();
      knee.position.y = -0.38;
      hip.add(knee);
      const kBall = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), bMat);
      knee.add(kBall);
      // Tibia+fibula
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.36, 8), bMat);
      lower.position.y = -0.18;
      knee.add(lower);
      const ankle = new THREE.Group();
      ankle.position.y = -0.36;
      knee.add(ankle);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.055, 0.22), bMat);
      foot.position.set(0, -0.03, 0.05);
      ankle.add(foot);

      // Shin wrap cloth
      const wrap = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.24), cloth);
      wrap.position.set(0, -0.18, 0.05);
      knee.add(wrap);

      return { hip, knee, ankle };
    };
    this._legL = makeLeg(-1);
    this._legR = makeLeg(1);

    // --- Bow in left hand (real, long) ---
    const bow = new THREE.Group();
    // Grip + limbs
    const bowMat = new THREE.MeshStandardMaterial({ color: 0x2a1608, roughness: 0.85, metalness: 0.05 });
    const stringMat = new THREE.MeshStandardMaterial({ color: 0xd8cfb5, roughness: 0.45, metalness: 0.0 });
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.25, 0.04), bowMat);
    bow.add(grip);
    // Upper limb (curved via chained segments)
    const ul = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.28, 0.032), bowMat);
    ul.position.set(0, 0.22, 0);
    ul.rotation.z = 0.28;
    bow.add(ul);
    const ul2 = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.24, 0.028), bowMat);
    ul2.position.set(0.05, 0.43, 0);
    ul2.rotation.z = 0.5;
    bow.add(ul2);
    // Lower limb
    const ll = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.28, 0.032), bowMat);
    ll.position.set(0, -0.22, 0);
    ll.rotation.z = -0.28;
    bow.add(ll);
    const ll2 = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.24, 0.028), bowMat);
    ll2.position.set(0.05, -0.43, 0);
    ll2.rotation.z = -0.5;
    bow.add(ll2);
    // Bowstring — we'll animate its length/offset on draw. Keep as a thin box pivoted from center.
    const string = new THREE.Mesh(new THREE.BoxGeometry(0.006, 1.1, 0.006), stringMat);
    string.position.set(0.09, 0, 0);
    bow.add(string);
    this._bowString = string;
    // Arrow resting on bow (visible during draw)
    const arrow = new THREE.Group();
    const aShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.75, 6),
      new THREE.MeshStandardMaterial({ color: 0x6b5a3e, roughness: 0.9 }));
    aShaft.rotation.z = Math.PI / 2;
    arrow.add(aShaft);
    const aTip = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.08, 6),
      new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.3, metalness: 0.9 }));
    aTip.rotation.z = -Math.PI / 2;
    aTip.position.set(0.4, 0, 0);
    arrow.add(aTip);
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(
        new THREE.PlaneGeometry(0.09, 0.05),
        new THREE.MeshStandardMaterial({ color: 0x4a4230, roughness: 1, side: THREE.DoubleSide }),
      );
      f.position.set(-0.35, 0, 0);
      f.rotation.x = (i * Math.PI * 2) / 3;
      f.rotation.y = Math.PI / 2;
      arrow.add(f);
    }
    arrow.position.set(0.09, 0, 0);
    arrow.visible = false;   // only shown while drawing
    bow.add(arrow);
    this._arrowOnBow = arrow;

    // Orient bow: blade plane in X (from left hand the bow hangs vertically
    // in front of the body, so rotate so limbs face up/down, limbs lie in the Y
    // axis of world once hand is raised).
    bow.rotation.z = Math.PI / 2; // limbs horizontal when hand is down; becomes vertical when hand raised
    bow.position.set(0, -0.08, 0.02);
    this._armL.wrist.add(bow);
    this._bow = bow;

    // --- Quiver on back ---
    const quiver = new THREE.Group();
    const qTube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.07, 0.45, 10),
      new THREE.MeshStandardMaterial({ color: 0x3a2416, roughness: 0.9 }),
    );
    qTube.rotation.z = 0.35;
    quiver.add(qTube);
    // Visible arrow shafts poking out
    for (let i = 0; i < 6; i++) {
      const a = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, 0.5, 6),
        new THREE.MeshStandardMaterial({ color: 0x6b5a3e, roughness: 0.9 }),
      );
      a.position.set(-0.02 + (i - 3) * 0.015, 0.22, (Math.random() - 0.5) * 0.04);
      a.rotation.z = 0.35 + (Math.random() - 0.5) * 0.08;
      quiver.add(a);
      // Fletching
      const f = new THREE.Mesh(
        new THREE.PlaneGeometry(0.03, 0.05),
        new THREE.MeshStandardMaterial({ color: 0x602020, roughness: 1, side: THREE.DoubleSide }),
      );
      f.position.copy(a.position);
      f.position.y += 0.2;
      quiver.add(f);
    }
    quiver.position.set(0, 0.05, -0.22);
    quiver.rotation.y = Math.PI;
    chest.add(quiver);

    // --- Overall hierarchy cast shadows ---
    G.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
  }

  // -------- Public API --------
  takeDamage(amount, fromPos) {
    if (!this.alive) return;
    this.hp -= amount;
    this.awareness = 1.0;
    this.lastKnownTarget = fromPos.clone();
    if (this.hp <= 0) this._die(fromPos);
  }

  _die(fromPos) {
    this.alive = false;
    this.state = STATES.DEAD;
    this.ragdollT = 0;
    const away = new THREE.Vector3().subVectors(this.position, fromPos).normalize();
    this.ragdollLean.copy(away).multiplyScalar(1.5);
    this._eyeLight.intensity = 0;
    this._eyeMat.opacity = 0.0;
  }

  // Segment raycast vs this skeleton's hit-zones.
  raycast(from, dir, maxT) {
    if (!this.alive) return null;
    let best = null;
    for (const z of HIT_ZONES) {
      const b = {
        min: new THREE.Vector3(this.position.x + z.min[0], this.position.y + z.min[1], this.position.z + z.min[2]),
        max: new THREE.Vector3(this.position.x + z.max[0], this.position.y + z.max[1], this.position.z + z.max[2]),
      };
      const t = raySegBoxHit(from.x, from.y, from.z, dir.x * maxT, dir.y * maxT, dir.z * maxT, b);
      if (t >= 0 && t <= 1 && (!best || t < best.t)) {
        best = {
          t, zone: z.name,
          hitPoint: new THREE.Vector3(from.x + dir.x * maxT * t, from.y + dir.y * maxT * t, from.z + dir.z * maxT * t),
        };
      }
    }
    return best;
  }

  // Hyper-aggressive LOS: we ignore FOV/sight-cone entirely for spawning in
  // combat. We still require a line-of-sight to actually FIRE the bow,
  // otherwise the skeleton will path toward the player through the level.
  _hasLineOfSight(targetPos, colliders) {
    const from = this.position.clone(); from.y += 1.5;
    const to = targetPos.clone(); to.y += 1.1;
    const d = to.clone().sub(from);
    const dist = d.length();
    if (dist < 0.01) return true;
    d.normalize();
    let tmin = 1.0;
    for (const b of colliders.boxes) {
      const t = raySegBoxHit(from.x, from.y, from.z, d.x * dist, d.y * dist, d.z * dist, b);
      if (t >= 0 && t < tmin) tmin = t;
    }
    return tmin >= 0.999;
  }

  update(dt, game) {
    if (!this.alive) { this._updateRagdoll(dt); return; }
    this.stateT += dt;
    this.cooldownShoot -= dt;
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    this._releasePulseT = Math.max(0, this._releasePulseT - dt * 3.5);

    const player = game.player;
    const toPlayer = new THREE.Vector3().subVectors(player.position, this.position);
    const distToPlayer = toPlayer.length();
    const canSee = this._hasLineOfSight(player.position, game.colliders);

    // ALWAYS consider the player our target — these are hyper-aggressive.
    this.target = player;
    if (canSee) this.lastKnownTarget = player.position.clone();

    // State machine: always combat; occasionally flank to swarm from different
    // directions. Never patrol/retreat/search — they came to kill you.
    if (this.state === STATES.COMBAT) {
      if (Math.random() < 0.003) { this.state = STATES.FLANK; this.stateT = 0; }
    } else if (this.state === STATES.FLANK) {
      if (this.stateT > 2.0) { this.state = STATES.COMBAT; this.stateT = 0; }
    }

    // --- Combat / movement ---
    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const desiredYaw = Math.atan2(-dx, -dz);
    this.yaw = approachYaw(this.yaw, desiredYaw, dt * 7);

    if (distToPlayer < 2.2) {
      // Close enough to punch/claw.
      this.velocity.x *= 0.5; this.velocity.z *= 0.5;
      this._trySwingMelee(dt, game, player, distToPlayer);
      this.drawT = Math.max(0, this.drawT - dt * 3);
      this._arrowOnBow.visible = false;
    } else if (this.state === STATES.FLANK) {
      // Sidestep around the player.
      const nd = Math.hypot(dx, dz) || 1;
      const px = -dz / nd, pz = dx / nd;
      this.path = [{
        x: this.position.x + px * this.flankSide * 8,
        z: this.position.z + pz * this.flankSide * 8,
      }];
      this.pathIdx = 0;
      this._followPath(dt, 3.2 * this.speedMul);
      this.drawT = Math.max(0, this.drawT - dt * 0.6);
    } else {
      // COMBAT: hold ideal range, stop to draw & shoot when LOS.
      const idealDist = 8;
      if (!canSee) {
        // chase the last known position aggressively
        this.path = [{ x: player.position.x, z: player.position.z }];
        this.pathIdx = 0;
        this._followPath(dt, 3.6 * this.speedMul);
        this.drawT = Math.max(0, this.drawT - dt * 0.5);
      } else if (distToPlayer > idealDist + 3) {
        this.path = [{ x: player.position.x - dx / distToPlayer * idealDist, z: player.position.z - dz / distToPlayer * idealDist }];
        this.pathIdx = 0;
        this._followPath(dt, 3.0 * this.speedMul);
        this.drawT = Math.max(0, this.drawT - dt * 0.5);
      } else if (distToPlayer < idealDist - 3) {
        const away = new THREE.Vector3(-dx, 0, -dz).normalize();
        this.velocity.x = damp(this.velocity.x, away.x * 2.0, 4, dt);
        this.velocity.z = damp(this.velocity.z, away.z * 2.0, 4, dt);
      } else {
        this.velocity.x *= 0.75; this.velocity.z *= 0.75;
      }

      // Draw & shoot
      if (canSee && this.cooldownShoot <= 0) {
        if (this.drawT < 0.01) game.audio.bowDraw(this.position);
        this.drawT = Math.min(1, this.drawT + dt * this.drawSpeed);
        this._arrowOnBow.visible = true;
        if (this.drawT >= 1.0) {
          this._releaseArrow(game, player);
          this.drawT = 0;
          this._arrowOnBow.visible = false;
          this._releasePulseT = 1.0;
          this.cooldownShoot = 0.6 + Math.random() * 0.4;
        }
      } else {
        this.drawT = Math.max(0, this.drawT - dt * 0.8);
        if (this.drawT < 0.05) this._arrowOnBow.visible = false;
      }
    }

    this._moveAndCollide(dt, game);
    this._animate(dt);
  }

  _trySwingMelee(dt, game, player, distToPlayer) {
    if (this.meleeActive) {
      this.meleeSwingT += dt;
      if (!this.meleeHitThisSwing &&
          this.meleeSwingT > this.meleeSwingDur * 0.35 &&
          this.meleeSwingT < this.meleeSwingDur * 0.65 &&
          distToPlayer < 2.3) {
        this.meleeHitThisSwing = true;
        const fromDir = new THREE.Vector3().subVectors(player.position, this.position).normalize();
        player.takeDamage(this.meleeDamage, fromDir);
        game.audio.hitFlesh(player.position);
      }
      if (this.meleeSwingT >= this.meleeSwingDur) {
        this.meleeActive = false;
        this.meleeCooldown = 0.4;
      }
    } else if (this.meleeCooldown <= 0) {
      this.meleeActive = true;
      this.meleeSwingT = 0;
      this.meleeHitThisSwing = false;
    }
  }

  _releaseArrow(game, player) {
    // Spawn arrow from bow world position going toward player.
    const from = this._bow.getWorldPosition(new THREE.Vector3());
    const target = player.position.clone(); target.y += 1.05;
    // Predict lead.
    target.addScaledVector(player.velocity, 0.22);
    const dir = target.clone().sub(from);
    const dist = dir.length();
    dir.normalize();
    // Mild inaccuracy scaled with range.
    const spread = 0.015 + (dist / 60) * 0.02;
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();
    const speed = 48;
    game.spawnArrow(from, dir.clone().multiplyScalar(speed), this);
    game.audio.bow(this.position);
  }

  _moveAndCollide(dt, game) {
    const tentative = this.position.clone();
    tentative.x += this.velocity.x * dt;
    tentative.z += this.velocity.z * dt;
    const vec = new THREE.Vector3(tentative.x, 1.0, tentative.z);
    game._resolveXZ(vec, 0.38);
    this.position.x = vec.x;
    this.position.z = vec.z;
    this.group.position.set(this.position.x, 0, this.position.z);
    this.group.rotation.y = this.yaw;

    const planar = Math.hypot(this.velocity.x, this.velocity.z);
    if (planar > 0.5) {
      this.pathStuckT += dt;
      if (this.pathStuckT > 1.5) {
        const side = (Math.random() - 0.5) * 2;
        this.path = [{ x: this.position.x + side * 3, z: this.position.z + (Math.random() - 0.5) * 3 }];
        this.pathIdx = 0;
        this.pathStuckT = 0;
      }
    } else {
      this.pathStuckT = 0;
    }
  }

  _followPath(dt, speed) {
    if (!this.path.length || this.pathIdx >= this.path.length) {
      this.velocity.x *= 0.7; this.velocity.z *= 0.7; return;
    }
    const p = this.path[this.pathIdx];
    const dx = p.x - this.position.x;
    const dz = p.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.6) { this.pathIdx++; return; }
    const nx = dx / d, nz = dz / d;
    this.velocity.x = damp(this.velocity.x, nx * speed, 6, dt);
    this.velocity.z = damp(this.velocity.z, nz * speed, 6, dt);
    const dy = Math.atan2(-nx, -nz);
    this.yaw = approachYaw(this.yaw, dy, dt * 5);
  }

  // --- Procedural animation ---
  _animate(dt) {
    const planar = Math.hypot(this.velocity.x, this.velocity.z);
    this._walkT += dt * (2.0 + planar * 1.8);
    const walking = planar > 0.5;

    // Eye pulse (breathing rage)
    if (this._eyeLight) {
      const e = 0.8 + Math.sin(this._walkT * 2.1) * 0.2;
      this._eyeLight.intensity = e;
      this._eyeMat.opacity = 0.75 + 0.25 * Math.sin(this._walkT * 3.7);
    }

    // Torso bob
    this._pelvis.position.y = 0.8 + Math.sin(this._walkT * 2) * (walking ? 0.04 : 0.01);

    // Legs: walk cycle if moving, idle sway if not.
    const stride = walking ? Math.sin(this._walkT) * 0.75 : Math.sin(this._walkT * 0.6) * 0.05;
    this._legL.hip.rotation.x = stride;
    this._legR.hip.rotation.x = -stride;
    this._legL.knee.rotation.x = Math.max(0, Math.sin(this._walkT + Math.PI / 2) * 0.9) * (walking ? 1 : 0.2);
    this._legR.knee.rotation.x = Math.max(0, Math.sin(this._walkT - Math.PI / 2) * 0.9) * (walking ? 1 : 0.2);

    // Head slight tilt toward target
    this._neck.rotation.y = 0; this._head.rotation.y = 0;
    this._head.rotation.x = Math.sin(this._walkT * 0.9) * 0.04;

    // --- Bow-draw pose ---
    // Draw progress fed from state machine; also "release pulse" adds a
    // sharp snap of the right arm forward when the arrow is fired.
    const draw = this.drawT;
    const release = this._releasePulseT;

    // Left arm: lifts forward & up to ~shoulder height when drawing.
    // Rest pose has arms hanging; we rotate shoulder so arm points forward.
    const drawBase = Math.max(draw, release);  // keep bow held briefly after release
    if (drawBase > 0.02) {
      // Left shoulder: arm out forward (rotate to bring arm up ~90 deg)
      this._armL.shoulder.rotation.x = -1.55 * drawBase;
      this._armL.shoulder.rotation.z = -0.05 * drawBase;
      this._armL.shoulder.rotation.y = 0.2 * drawBase;
      // Elbow nearly straight when holding bow
      this._armL.elbow.rotation.x = -0.15 * drawBase;
      // Wrist slight tilt so bow limbs are vertical
      this._armL.wrist.rotation.z = -0.25 * drawBase;
      this._armL.wrist.rotation.x = 0.0;

      // Right arm: pulls back toward ear. At draw=0, arm hangs; at draw=1,
      // hand is beside the jaw. On release, arm snaps forward and down briefly.
      const drawPull = draw;
      this._armR.shoulder.rotation.x = (-1.25 + 0.15 * release) * drawBase;
      this._armR.shoulder.rotation.y = (-0.75 - 0.15 * drawPull) * drawBase;
      this._armR.shoulder.rotation.z = 0.2 * drawBase;
      // Elbow bends strongly on draw, straightens on release
      this._armR.elbow.rotation.x = (-1.15 - 0.6 * drawPull + 1.2 * release) * drawBase;
      this._armR.wrist.rotation.z = 0.15 * drawBase;

      // Bowstring deformation: pull back (along bow local X) as draw rises,
      // then snap forward quickly as release fires.
      const stringPull = drawPull * 0.18 + release * -0.03;
      this._bowString.position.x = 0.09 + stringPull;
      // String becomes slightly longer due to tension
      this._bowString.scale.y = 1 + release * 0.02 - stringPull * 0.15;

      // Head aims down arm — tilt head forward slightly.
      this._head.rotation.x += -0.15 * drawBase;
    } else {
      // Idle: arms dangle, bow vertical in left hand.
      this._armL.shoulder.rotation.set(0, 0, 0.06);
      this._armL.elbow.rotation.set(0, 0, 0);
      this._armL.wrist.rotation.set(0, 0, 0);
      this._armR.shoulder.rotation.set(0, 0, -0.06);
      this._armR.elbow.rotation.set(-0.1, 0, 0);
      this._armR.wrist.rotation.set(0, 0, 0);
      this._bowString.position.x = 0.09;
      this._bowString.scale.y = 1;
    }

    // --- Melee swing overrides right arm if active ---
    if (this.meleeActive) {
      const t = this.meleeSwingT / this.meleeSwingDur;
      const wind = clamp(t / 0.25, 0, 1);
      const slash = clamp((t - 0.25) / 0.4, 0, 1);
      const recover = clamp((t - 0.65) / 0.35, 0, 1);
      this._armR.shoulder.rotation.x = -0.5 - wind * 1.4 + slash * 2.4 - recover * 1.0;
      this._armR.shoulder.rotation.y = 0.2;
      this._armR.shoulder.rotation.z = 0.1;
      this._armR.elbow.rotation.x = -0.8 + slash * 0.8;
    }
  }

  _updateRagdoll(dt) {
    this.ragdollT += dt;
    // Collapse: torso leans in damage direction, legs splay.
    const t = Math.min(1, this.ragdollT * 2.5);
    this._pelvis.position.y = 0.8 * (1 - t) + 0.25 * t;
    this._pelvis.rotation.x = this.ragdollLean.z * 0.6 * t;
    this._pelvis.rotation.z = -this.ragdollLean.x * 0.6 * t;
    // Arms flop
    this._armL.shoulder.rotation.x = -0.8 * t;
    this._armR.shoulder.rotation.x = 0.8 * t;
    this._armL.elbow.rotation.x = -0.6 * t;
    this._armR.elbow.rotation.x = -0.6 * t;
    // Legs splay
    this._legL.hip.rotation.x = 0.5 * t;
    this._legR.hip.rotation.x = -0.5 * t;
    this._legL.knee.rotation.x = 0.6 * t;
    this._legR.knee.rotation.x = 0.6 * t;
    // Head drops
    this._head.rotation.x = 0.4 * t;
    this._neck.rotation.x = -0.2 * t;
  }
}
