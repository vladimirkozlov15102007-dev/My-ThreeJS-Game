// Hyper-detailed humanoid archer skeleton.
// Realistic multi-stage bow animation:
//   idle -> raise -> nock -> draw -> anchor -> release -> recover
// All 20 skeletons spawn in COMBAT state and attack the player on sight
// (aggression is amped so they close distance and open fire immediately).
import * as THREE from 'three';
import { rand, randInt, clamp, damp, raySegBoxHit } from './utils.js';
import { matBone } from './materials.js';

const STATES = {
  PATROL: 'patrol',         // only briefly before first sight
  INVESTIGATE: 'investigate',
  ALERT: 'alert',
  COMBAT: 'combat',
  FLANK: 'flank',
  RETREAT: 'retreat',
  SEARCH: 'search',
  DEAD: 'dead',
};

// Archery phases
const AR = {
  IDLE: 0,
  RAISE: 1,
  NOCK: 2,
  DRAW: 3,
  ANCHOR: 4,
  RELEASE: 5,
  RECOVER: 6,
};

// Hit-zone boxes around the skeleton's origin (relative), height 0..1.75.
const HIT_ZONES = [
  { name: 'head',  min: [-0.25, 1.40, -0.25], max: [0.25, 1.80, 0.25] },
  { name: 'torso', min: [-0.38, 0.60, -0.32], max: [0.38, 1.40, 0.32] },
  { name: 'legs',  min: [-0.38, 0.0,  -0.32], max: [0.38, 0.60, 0.32] },
];

let _uid = 0;

export class Skeleton {
  constructor(scene, spawn, options = {}) {
    this.id = _uid++;
    this.scene = scene;
    this.position = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.home = this.position.clone();
    this.velocity = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.alive = true;
    this.hp = 100;
    this.maxHp = 100;

    // Weapon state
    this.usePickaxe = false;
    this.arrows = 99;                   // effectively unlimited for aggression
    this.meleeDamage = 30;
    this.arrowDamageByZone = { head: 30, torso: 20, legs: 10 };

    // AI — start ALREADY in combat, eager to attack
    this.state = STATES.COMBAT;
    this.stateT = 0;
    this.target = null;
    this.lastKnownTarget = null;
    this.awareness = 1.0;               // maxed from spawn: super-aggressive
    this.cooldownShoot = 0.3 + Math.random() * 0.4;
    this.meleeCooldown = 0;
    this.meleeActive = false;
    this.meleeSwingT = 0;
    this.meleeSwingDur = 0.5;
    this.meleeHitThisSwing = false;
    this.investigateUntil = 0;
    this.retreatUntil = 0;
    this.flankSide = Math.random() < 0.5 ? -1 : 1;
    this.nextPathT = 0;
    this.path = [];
    this.pathIdx = 0;
    this.pathStuckT = 0;

    // Adaptive preferences (main.js still nudges these)
    this.preferFlank = 0;
    this.preferSuppress = 0;
    this.preferDistance = 0;

    // Bow animation state machine
    this._arPhase = AR.IDLE;
    this._arPhaseT = 0;
    this._drawAmount = 0;     // 0..1 current visual draw of the bow string
    this._aimPitch = 0;       // radians — how high the bow is tilted
    this._desiredAimPitch = 0;

    // Build mesh
    const group = new THREE.Group();
    group.position.copy(this.position);
    scene.add(group);
    this.group = group;
    this._buildBody();

    // Death ragdoll state
    this.ragdollT = 0;
    this.ragdollAngle = 0;
    this.ragdollLean = new THREE.Vector3();

    // Walk phase
    this.walkT = 0;

    // Slight variation
    this.scale = 0.95 + Math.random() * 0.12;
    this.group.scale.setScalar(this.scale);
    this.speedMul = 1.1 + Math.random() * 0.2;   // a bit faster than before
  }

  // ---------------- Build ----------------

  _buildBody() {
    const boneMat = matBone();
    const dirtyMat = matBone(); dirtyMat.color.setHex(0x9a8a66);
    const clothMat = new THREE.MeshStandardMaterial({ color: 0x2a2014, roughness: 1.0 });
    const armorMat = new THREE.MeshStandardMaterial({ color: 0x3b2e1a, roughness: 0.75, metalness: 0.4 });
    const leatherMat = new THREE.MeshStandardMaterial({ color: 0x1f1510, roughness: 0.9 });

    const G = this.group;

    // --- Pelvis ---
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.18, 0.24), boneMat);
    pelvis.position.y = 0.75;
    G.add(pelvis);
    this._pelvis = pelvis;

    // --- Spine (4 segments, each slightly tapering) ---
    this._spine = [];
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(
        new THREE.BoxGeometry(0.30 - i * 0.02, 0.11, 0.20 - i * 0.015),
        boneMat,
      );
      s.position.y = 0.92 + i * 0.10;
      G.add(s);
      this._spine.push(s);
    }

    // --- Ribcage (curved torus halves for a skeletal feel) ---
    for (let i = 0; i < 5; i++) {
      const rib = new THREE.Mesh(
        new THREE.TorusGeometry(0.22 - i * 0.014, 0.018, 4, 12, Math.PI),
        boneMat,
      );
      rib.position.set(0, 1.04 + i * 0.07, 0);
      rib.rotation.y = Math.PI / 2;
      rib.rotation.x = Math.PI / 2;
      G.add(rib);
    }
    // sternum
    const sternum = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 0.04), boneMat);
    sternum.position.set(0, 1.2, 0.13);
    G.add(sternum);

    // --- Shoulders (scapula-like pads) ---
    const shoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), boneMat);
    shoulderL.position.set(-0.20, 1.38, 0);
    const shoulderR = shoulderL.clone(); shoulderR.position.x = 0.20;
    G.add(shoulderL); G.add(shoulderR);

    // --- Arms ---
    const makeArmGroup = (side /* -1 L, +1 R */) => {
      const g = new THREE.Group();
      g.position.set(side * 0.20, 1.38, 0);

      // upper arm
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.36, 0.09), boneMat);
      upper.position.set(0, -0.18, 0);
      g.add(upper);

      // elbow joint ball
      const elbowBall = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), boneMat);
      elbowBall.position.set(0, -0.38, 0);
      g.add(elbowBall);

      const elbow = new THREE.Group();
      elbow.position.set(0, -0.38, 0);
      g.add(elbow);

      const lower = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.34, 0.08), boneMat);
      lower.position.set(0, -0.17, 0);
      elbow.add(lower);

      const wrist = new THREE.Group();
      wrist.position.set(0, -0.34, 0);
      elbow.add(wrist);

      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.10), boneMat);
      hand.position.set(0, -0.04, 0.02);
      wrist.add(hand);

      return { group: g, elbow, wrist, hand };
    };
    this._armL = makeArmGroup(-1); G.add(this._armL.group);
    this._armR = makeArmGroup(1); G.add(this._armR.group);

    // --- Legs ---
    const makeLegGroup = (side) => {
      const g = new THREE.Group();
      g.position.set(side * 0.1, 0.75, 0);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.40, 0.11), boneMat);
      upper.position.set(0, -0.20, 0);
      g.add(upper);
      const kneeBall = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), boneMat);
      kneeBall.position.set(0, -0.42, 0);
      g.add(kneeBall);
      const knee = new THREE.Group();
      knee.position.set(0, -0.42, 0);
      g.add(knee);
      const lower = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.36, 0.10), boneMat);
      lower.position.set(0, -0.18, 0);
      knee.add(lower);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.07, 0.24), boneMat);
      foot.position.set(0, -0.38, 0.05);
      knee.add(foot);
      return { group: g, knee };
    };
    this._legL = makeLegGroup(-1); G.add(this._legL.group);
    this._legR = makeLegGroup(1); G.add(this._legR.group);

    // --- Head ---
    const head = new THREE.Group();
    head.position.set(0, 1.58, 0);
    G.add(head);
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.26, 0.27), boneMat);
    head.add(skull);
    // Rounded dome on top
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), boneMat);
    dome.position.y = 0.08;
    head.add(dome);
    // Jaw
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.06, 0.22), dirtyMat);
    jaw.position.set(0, -0.15, 0.01);
    head.add(jaw);
    // Eye sockets (dark voids with glow)
    const socketMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1 });
    const sockL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), socketMat);
    sockL.position.set(-0.065, 0.02, 0.13); head.add(sockL);
    const sockR = sockL.clone(); sockR.position.x = 0.065; head.add(sockR);
    // Glowing eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff8844, transparent: true, opacity: 0.98 });
    for (const ex of [-0.065, 0.065]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), eyeMat);
      eye.position.set(ex, 0.02, 0.14);
      head.add(eye);
    }
    const eyeLight = new THREE.PointLight(0xff6a2a, 0.8, 4, 2);
    eyeLight.position.set(0, 0.04, 0.14);
    head.add(eyeLight);
    this._head = head;
    this._eyeLight = eyeLight;

    // --- Cloth tatters ---
    for (let i = 0; i < 6; i++) {
      const t = new THREE.Mesh(
        new THREE.PlaneGeometry(0.22 + Math.random() * 0.1, 0.4 + Math.random() * 0.4),
        clothMat,
      );
      t.position.set((Math.random() - 0.5) * 0.35, 0.75 + Math.random() * 0.4, 0.12);
      t.rotation.y = Math.random() * 0.6 - 0.3;
      t.rotation.z = Math.random() * 0.15 - 0.075;
      t.userData.cloth = { freq: 2 + Math.random() * 3, phase: Math.random() * 6.28 };
      G.add(t);
    }
    // --- Rusty chest plate ---
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.34, 0.06), armorMat);
    plate.position.set(0, 1.22, 0.15);
    G.add(plate);
    // rivets on plate
    for (let i = 0; i < 4; i++) {
      const rv = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 6),
        new THREE.MeshStandardMaterial({ color: 0x6a5a3a, metalness: 0.9, roughness: 0.3 }));
      rv.position.set(-0.15 + (i % 2) * 0.30, 1.33 - Math.floor(i / 2) * 0.22, 0.185);
      G.add(rv);
    }
    // --- Belt / leather straps ---
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.28), leatherMat);
    belt.position.set(0, 0.82, 0);
    G.add(belt);

    // --- Quiver on back (with arrows) ---
    const quiver = new THREE.Group();
    quiver.position.set(-0.12, 1.20, -0.20);
    quiver.rotation.z = 0.2;
    const quiverBody = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.08, 0.5, 10), leatherMat);
    quiver.add(quiverBody);
    // Visible arrow tops sticking up
    const arrowMat = new THREE.MeshStandardMaterial({ color: 0x6d5a3e, roughness: 0.9 });
    const featherMat = new THREE.MeshStandardMaterial({ color: 0x5a4533, roughness: 1 });
    for (let i = 0; i < 5; i++) {
      const a = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.35, 6), arrowMat);
      a.position.set((Math.random() - 0.5) * 0.06, 0.28, (Math.random() - 0.5) * 0.06);
      quiver.add(a);
      const feather = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.08), featherMat);
      feather.position.set(a.position.x, a.position.y + 0.16, a.position.z);
      feather.rotation.y = Math.random() * Math.PI * 2;
      quiver.add(feather);
    }
    G.add(quiver);

    // --- Build bow + nocked arrow + pickaxe ---
    this._buildWeapons();

    // Cast & receive shadows
    G.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  _buildWeapons() {
    // ===== BOW (detailed recurve) held in LEFT hand =====
    // Anatomy: riser (grip) + upper limb + lower limb + string made of 3 segments
    const bow = new THREE.Group();
    const bowWoodMat = new THREE.MeshStandardMaterial({ color: 0x3a2616, roughness: 0.85, metalness: 0.05 });
    const bowDarkMat = new THREE.MeshStandardMaterial({ color: 0x1b120a, roughness: 0.9 });
    const stringMat = new THREE.MeshStandardMaterial({ color: 0xe2d9be, roughness: 0.4, metalness: 0 });

    // Riser (central grip)
    const riser = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.045), bowDarkMat);
    riser.position.set(0, 0, 0);
    bow.add(riser);

    // Upper limb - curved via two segments
    const upperLimb1 = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.30, 0.028), bowWoodMat);
    upperLimb1.position.set(0, 0.22, 0.0);
    upperLimb1.rotation.z = 0.12;
    bow.add(upperLimb1);
    const upperLimb2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 0.024), bowWoodMat);
    upperLimb2.position.set(-0.04, 0.50, 0.0);
    upperLimb2.rotation.z = 0.38;
    bow.add(upperLimb2);
    // Upper tip
    const upperTip = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 6), bowDarkMat);
    upperTip.position.set(-0.075, 0.605, 0.0);
    bow.add(upperTip);

    // Lower limb — mirrored
    const lowerLimb1 = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.30, 0.028), bowWoodMat);
    lowerLimb1.position.set(0, -0.22, 0.0);
    lowerLimb1.rotation.z = -0.12;
    bow.add(lowerLimb1);
    const lowerLimb2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 0.024), bowWoodMat);
    lowerLimb2.position.set(-0.04, -0.50, 0.0);
    lowerLimb2.rotation.z = -0.38;
    bow.add(lowerLimb2);
    const lowerTip = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 6), bowDarkMat);
    lowerTip.position.set(-0.075, -0.605, 0.0);
    bow.add(lowerTip);

    // Grip wrap
    const gripWrap = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 10),
      new THREE.MeshStandardMaterial({ color: 0x1a110a, roughness: 1 }));
    gripWrap.position.set(0, 0, 0);
    bow.add(gripWrap);

    // Arrow rest
    const rest = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.008, 0.015),
      new THREE.MeshStandardMaterial({ color: 0x555144, metalness: 0.6, roughness: 0.5 }));
    rest.position.set(0.025, 0.02, 0);
    bow.add(rest);

    // String (3 segments that can deform). The two outer segments run from tips
    // to the nock point; the nock point is moved back when drawing.
    // We model each segment as a thin cylinder oriented to point from tip -> nock.
    const stringThickness = 0.004;
    const stringTopGeom = new THREE.CylinderGeometry(stringThickness, stringThickness, 1, 4);
    const stringBotGeom = new THREE.CylinderGeometry(stringThickness, stringThickness, 1, 4);
    const stringTop = new THREE.Mesh(stringTopGeom, stringMat);
    const stringBot = new THREE.Mesh(stringBotGeom, stringMat);
    bow.add(stringTop);
    bow.add(stringBot);

    // Nock point object — drives the string bend.
    const nockPoint = new THREE.Object3D();
    nockPoint.position.set(0.075, 0, 0);  // at rest, sits on front face of riser
    bow.add(nockPoint);

    // Visible nocked arrow — parented to the NOCK POINT (tail of arrow moves with string)
    const nockedArrow = new THREE.Group();
    const naShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.8, 6),
      new THREE.MeshStandardMaterial({ color: 0x6d5a3e, roughness: 0.9 }));
    naShaft.rotation.z = Math.PI / 2;
    // Shaft runs FORWARD from the nock point along +X (from the archer's perspective,
    // forward is +X in the bow's local frame here; bow is rotated to face -Z of skeleton)
    naShaft.position.x = 0.40;
    nockedArrow.add(naShaft);
    const naTip = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.06, 6),
      new THREE.MeshStandardMaterial({ color: 0x2a2824, metalness: 0.8, roughness: 0.35 }));
    naTip.rotation.z = -Math.PI / 2;
    naTip.position.x = 0.83;
    nockedArrow.add(naTip);
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.035),
        new THREE.MeshStandardMaterial({ color: 0x5a4533, roughness: 1, side: THREE.DoubleSide }));
      f.position.x = 0.03;
      f.rotation.y = Math.PI / 2;
      f.rotation.x = (i * Math.PI * 2) / 3;
      nockedArrow.add(f);
    }
    nockedArrow.visible = false;
    nockPoint.add(nockedArrow);

    // Orient the whole bow so it hangs vertically in the hand with the
    // string facing AWAY from the archer. In the arm's local frame:
    //   arm forward is -Y (hand hangs down), we want bow's +Y to be up.
    //   Bow should be on the "left side", string facing forward of skeleton.
    // Easiest: rotate bow 90° around X so its Y-axis maps to the world Y
    // when parented under the wrist pointing down; then further tweaks at animate time.
    bow.rotation.set(0, Math.PI / 2, 0);  // rotate so "front" of bow faces -Z (skeleton forward)
    bow.position.set(0, -0.04, 0.04);     // relative to left wrist

    this._armL.wrist.add(bow);

    this._bow = bow;
    this._bowStringTop = stringTop;
    this._bowStringBot = stringBot;
    this._bowNockPoint = nockPoint;
    this._bowNockedArrow = nockedArrow;
    this._bowUpperTip = upperTip;
    this._bowLowerTip = lowerTip;
    this._bowLimbs = { u1: upperLimb1, u2: upperLimb2, l1: lowerLimb1, l2: lowerLimb2, ut: upperTip, lt: lowerTip };
    // Initial string layout at rest
    this._layoutBowString(0);

    // ===== PICKAXE (back-slung, swapped to right hand in melee) =====
    const pickGroup = new THREE.Group();
    const haftMat = new THREE.MeshStandardMaterial({ color: 0x2e1e10, roughness: 0.9 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x2b2723, roughness: 0.55, metalness: 0.65 });
    const haft = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.7, 0.04), haftMat);
    haft.position.set(0, -0.2, 0);
    pickGroup.add(haft);
    // Leather grip wrap
    const pickGrip = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x1a110a, roughness: 1 }));
    pickGrip.position.set(0, -0.3, 0);
    pickGroup.add(pickGrip);
    const pickHead = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.06), headMat);
    pickHead.position.set(0, 0.1, 0);
    pickGroup.add(pickHead);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.22, 6), headMat);
    spike.rotation.z = Math.PI / 2;
    spike.position.set(0.2, 0.1, 0);
    pickGroup.add(spike);
    const backSpike = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.16, 6), headMat);
    backSpike.rotation.z = -Math.PI / 2;
    backSpike.position.set(-0.16, 0.1, 0);
    pickGroup.add(backSpike);

    this._pickSlungPos = { p: new THREE.Vector3(0.12, 1.20, -0.22), r: new THREE.Euler(0, 0, Math.PI / 2) };
    this._pickHandPos = { p: new THREE.Vector3(0, -0.20, 0.08), r: new THREE.Euler(0, 0, 0) };
    pickGroup.position.copy(this._pickSlungPos.p);
    pickGroup.rotation.copy(this._pickSlungPos.r);
    this.group.add(pickGroup);
    this._pickaxe = pickGroup;
  }

  // Re-layout string + limb tips based on drawAmount (0..1).
  // In the bow's local frame: +Y = up, +X = forward (away from archer).
  // Tips are at local y = ±0.605, x = -0.075 (slight curve back toward archer).
  // Nock point sits at x = 0.075 at rest and moves to x = -0.35 when fully drawn.
  _layoutBowString(drawAmount) {
    const nockX = 0.075 - drawAmount * 0.42;
    this._bowNockPoint.position.set(nockX, 0, 0);

    // Limb tips flex toward the archer a bit when drawn (classic bow bend)
    const flex = drawAmount * 0.05;
    this._bowUpperTip.position.x = -0.075 - flex * 2;
    this._bowLowerTip.position.x = -0.075 - flex * 2;
    // Slight extra bend on limbs
    this._bowLimbs.u2.rotation.z = 0.38 + flex * 2.5;
    this._bowLimbs.l2.rotation.z = -0.38 - flex * 2.5;

    // Top string: from upper tip to nock point
    const topA = this._bowUpperTip.position.clone();
    const topB = this._bowNockPoint.position.clone();
    const topMid = topA.clone().add(topB).multiplyScalar(0.5);
    const topDir = topB.clone().sub(topA);
    const topLen = topDir.length();
    this._bowStringTop.position.copy(topMid);
    // align cylinder (up axis Y) with topDir
    const q1 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), topDir.clone().normalize());
    this._bowStringTop.quaternion.copy(q1);
    this._bowStringTop.scale.set(1, topLen, 1);

    // Bot string
    const botA = this._bowLowerTip.position.clone();
    const botB = this._bowNockPoint.position.clone();
    const botMid = botA.clone().add(botB).multiplyScalar(0.5);
    const botDir = botB.clone().sub(botA);
    const botLen = botDir.length();
    this._bowStringBot.position.copy(botMid);
    const q2 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), botDir.clone().normalize());
    this._bowStringBot.quaternion.copy(q2);
    this._bowStringBot.scale.set(1, botLen, 1);
  }

  setMeleeMode(on) {
    if (this.usePickaxe === on) return;
    this.usePickaxe = on;
    if (on) {
      this.group.remove(this._pickaxe);
      this._armR.wrist.add(this._pickaxe);
      this._pickaxe.position.copy(this._pickHandPos.p);
      this._pickaxe.rotation.copy(this._pickHandPos.r);
      this._bow.visible = false;
    } else {
      this._armR.wrist.remove(this._pickaxe);
      this.group.add(this._pickaxe);
      this._pickaxe.position.copy(this._pickSlungPos.p);
      this._pickaxe.rotation.copy(this._pickSlungPos.r);
      this._bow.visible = true;
    }
  }

  takeDamage(amount, fromPos, hitPoint, zone) {
    if (!this.alive) return;
    this.hp -= amount;
    this.awareness = 1.0;
    if (!this.target) this.lastKnownTarget = fromPos.clone();
    if (this.state !== STATES.COMBAT && this.state !== STATES.FLANK) {
      this.state = STATES.COMBAT; this.stateT = 0;
    }
    // Interrupt draw on big hits
    if (amount >= 25 && this._arPhase !== AR.IDLE && this._arPhase !== AR.RELEASE) {
      this._arPhase = AR.RECOVER; this._arPhaseT = 0;
      this._drawAmount = 0;
      this._bowNockedArrow.visible = false;
    }
    if (this.hp <= 0) this._die(fromPos);
  }

  _die(fromPos) {
    this.alive = false;
    this.state = STATES.DEAD;
    this.ragdollT = 0;
    const away = new THREE.Vector3().subVectors(this.position, fromPos).normalize();
    this.ragdollLean.copy(away).multiplyScalar(1.2);
    this._eyeLight.intensity = 0;
    this._bowNockedArrow.visible = false;
  }

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
          t,
          zone: z.name,
          hitPoint: new THREE.Vector3(from.x + dir.x * maxT * t, from.y + dir.y * maxT * t, from.z + dir.z * maxT * t),
        };
      }
    }
    return best;
  }

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

    // Perception — ULTRA-AGGRESSIVE: much wider cone, longer sight.
    const player = game.player;
    const toPlayer = new THREE.Vector3().subVectors(player.position, this.position);
    const distToPlayer = toPlayer.length();
    const dirToPlayer = toPlayer.clone().multiplyScalar(1 / Math.max(0.001, distToPlayer));
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const dotForward = forward.dot(dirToPlayer);

    const viewCone = -0.3;                 // ~110° half-angle — nearly omnidirectional
    const sightMaxDist = 120;              // huge sight range
    const canSee = (distToPlayer < sightMaxDist) &&
                   (dotForward > viewCone || distToPlayer < 10) &&
                   this._hasLineOfSight(player.position, game.colliders);

    if (canSee) {
      this.awareness = 1.0;
      this.lastKnownTarget = player.position.clone();
      this.target = player;
    } else {
      this.awareness = Math.max(0.7, this.awareness - dt * 0.1);   // never really drops
      if (!this.target) this.target = player;
      if (!this.lastKnownTarget) this.lastKnownTarget = player.position.clone();
    }

    // --- Weapon mode: bow at range, pickaxe if very close ---
    const forceMelee = this.arrows <= 0 || distToPlayer < 2.6;
    this.setMeleeMode(forceMelee);

    // --- State transitions (simplified, combat-biased) ---
    this._chooseState(dt, distToPlayer, canSee);

    switch (this.state) {
      case STATES.PATROL:      this._sPatrol(dt, game); break;
      case STATES.INVESTIGATE: this._sInvestigate(dt, game); break;
      case STATES.COMBAT:      this._sCombat(dt, game, distToPlayer, canSee); break;
      case STATES.FLANK:       this._sFlank(dt, game, distToPlayer, canSee); break;
      case STATES.RETREAT:     this._sRetreat(dt); break;
      case STATES.SEARCH:      this._sSearch(dt); break;
    }

    this._moveAndCollide(dt, game);
    this._animate(dt, game);
  }

  _chooseState(dt, distToPlayer, canSee) {
    // Low HP & random → brief retreat, then back to combat
    if (this.hp < 20 && this.state !== STATES.RETREAT && Math.random() < 0.02) {
      this.state = STATES.RETREAT; this.stateT = 0;
      this.retreatUntil = 1.2 + Math.random() * 1.2;
      return;
    }
    if (this.state === STATES.RETREAT && this.stateT > this.retreatUntil) {
      this.state = STATES.COMBAT; this.stateT = 0;
      return;
    }
    // Any sign of player — immediate combat / flank
    if (this.target) {
      if (this.state !== STATES.FLANK && Math.random() < 0.004 + this.preferFlank * 0.008) {
        this.state = STATES.FLANK; this.stateT = 0;
        this.flankSide = Math.random() < 0.5 ? -1 : 1;
      } else if (this.state !== STATES.COMBAT && this.state !== STATES.FLANK) {
        this.state = STATES.COMBAT; this.stateT = 0;
      }
    }
  }

  _sPatrol(dt, game) {
    // Rare since skeletons start in combat.
    if (this.nextPathT <= 0 || !this.path.length || this.pathIdx >= this.path.length) {
      const pts = game.patrolPoints;
      const pick = pts[randInt(0, pts.length)];
      this.path = [{ x: pick.x, z: pick.z }]; this.pathIdx = 0;
      this.nextPathT = 5;
    }
    this.nextPathT -= dt;
    this._followPath(dt, 1.4 * this.speedMul);
  }

  _sInvestigate(dt, game) {
    if (!this.lastKnownTarget) { this.state = STATES.COMBAT; return; }
    this.path = [{ x: this.lastKnownTarget.x, z: this.lastKnownTarget.z }];
    this.pathIdx = 0;
    this._followPath(dt, 3.0 * this.speedMul);
  }

  _sCombat(dt, game, distToPlayer, canSee) {
    const player = this.target;
    if (!player) { this.state = STATES.SEARCH; this.stateT = 0; return; }

    // Face target
    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const desiredYaw = Math.atan2(-dx, -dz);
    this.yaw = this._approachYaw(this.yaw, desiredYaw, dt * 6);

    if (this.usePickaxe) {
      // Charge and swing. No hesitation.
      if (distToPlayer > 1.7) {
        this.path = [{ x: player.position.x, z: player.position.z }];
        this.pathIdx = 0;
        this._followPath(dt, 3.6 * this.speedMul);
      } else {
        this.velocity.x *= 0.5; this.velocity.z *= 0.5;
        this._trySwingMelee(dt, game, player, distToPlayer);
      }
    } else {
      // Archer: aggressive pressure — don't back off much, keep advancing.
      const idealDist = 8 + this.preferDistance * 2;
      if (distToPlayer > idealDist + 2) {
        this.path = [{ x: player.position.x, z: player.position.z }];
        this.pathIdx = 0;
        this._followPath(dt, 2.8 * this.speedMul);
      } else if (distToPlayer < idealDist - 3) {
        // small backstep only
        const away = new THREE.Vector3(-dx, 0, -dz).normalize();
        this.velocity.x = damp(this.velocity.x, away.x * 1.2, 4, dt);
        this.velocity.z = damp(this.velocity.z, away.z * 1.2, 4, dt);
      } else {
        // Stand and fire
        this.velocity.x *= 0.7; this.velocity.z *= 0.7;
      }

      // Aim vertically at player
      const dy = (player.position.y - this.position.y) - 0.4;
      this._desiredAimPitch = Math.atan2(dy, Math.max(0.5, distToPlayer)) + 0.05;

      this._runArchery(dt, game, canSee, player, distToPlayer);
    }
  }

  _runArchery(dt, game, canSee, player, distToPlayer) {
    // Auto-drive the bow animation state machine.
    this._arPhaseT += dt;
    switch (this._arPhase) {
      case AR.IDLE:
        if (this.cooldownShoot <= 0 && canSee && this.arrows > 0) {
          this._arPhase = AR.RAISE; this._arPhaseT = 0;
        }
        break;
      case AR.RAISE:
        // bow rises into firing position
        if (this._arPhaseT >= 0.22) { this._arPhase = AR.NOCK; this._arPhaseT = 0; }
        break;
      case AR.NOCK:
        // arrow appears mid-way through
        if (this._arPhaseT >= 0.08) this._bowNockedArrow.visible = true;
        if (this._arPhaseT >= 0.22) { this._arPhase = AR.DRAW; this._arPhaseT = 0; }
        break;
      case AR.DRAW: {
        const t = clamp(this._arPhaseT / 0.40, 0, 1);
        this._drawAmount = t * t * (3 - 2 * t); // smoothstep
        if (this._arPhaseT >= 0.40) { this._arPhase = AR.ANCHOR; this._arPhaseT = 0; this._drawAmount = 1; }
        break;
      }
      case AR.ANCHOR: {
        // hold at full draw
        this._drawAmount = 1;
        if (this._arPhaseT >= 0.15) {
          this._fireArrow(game, player);
          this._arPhase = AR.RELEASE; this._arPhaseT = 0;
        }
        break;
      }
      case AR.RELEASE:
        // string snaps forward visually
        this._drawAmount = Math.max(0, 1 - this._arPhaseT / 0.08);
        if (this._arPhaseT >= 0.08) {
          this._drawAmount = 0;
          this._arPhase = AR.RECOVER; this._arPhaseT = 0;
        }
        break;
      case AR.RECOVER:
        // brief recovery then ready for next shot — very short for aggression
        if (this._arPhaseT >= 0.35) {
          this._arPhase = AR.IDLE; this._arPhaseT = 0;
          this.cooldownShoot = 0.15 + Math.random() * 0.25; // ~0.5s total interval → super-aggressive
        }
        break;
    }
    // Apply current draw visually
    this._layoutBowString(this._drawAmount);
  }

  _fireArrow(game, player) {
    // Spawn arrow from the nock point world position.
    const from = this._bowNockPoint.getWorldPosition(new THREE.Vector3());
    const target = player.position.clone(); target.y += 1.1;
    // Lead slightly
    target.addScaledVector(player.velocity, 0.15);

    const dir = target.clone().sub(from);
    const dist = dir.length();
    dir.normalize();
    // Small inaccuracy (they're good shots now)
    const spread = 0.02 + (dist / 50) * 0.03;
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();

    const speed = 38;
    game.spawnArrow(from, dir.clone().multiplyScalar(speed), this);
    game.audio.bow(this.position);
    this._bowNockedArrow.visible = false;
    this.arrows -= 1;
  }

  _sFlank(dt, game, distToPlayer, canSee) {
    const player = this.target;
    if (!player) { this.state = STATES.SEARCH; this.stateT = 0; return; }
    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const nd = Math.hypot(dx, dz) || 1;
    const px = -dz / nd, pz = dx / nd;
    const tx = this.position.x + px * this.flankSide * 7;
    const tz = this.position.z + pz * this.flankSide * 7;
    this.path = [{ x: tx, z: tz }];
    this.pathIdx = 0;
    this._followPath(dt, 3.2 * this.speedMul);
    if (this.stateT > 2.5) { this.state = STATES.COMBAT; this.stateT = 0; }
    // Still fire while flanking
    this._desiredAimPitch = 0.05;
    this._runArchery(dt, game, canSee, player, distToPlayer);
  }

  _sRetreat(dt) {
    if (!this.target) { this.state = STATES.COMBAT; this.stateT = 0; return; }
    const dx = this.position.x - this.target.position.x;
    const dz = this.position.z - this.target.position.z;
    const d = Math.hypot(dx, dz) || 1;
    this.velocity.x = damp(this.velocity.x, (dx / d) * 3.5, 6, dt);
    this.velocity.z = damp(this.velocity.z, (dz / d) * 3.5, 6, dt);
    this.yaw = this._approachYaw(this.yaw, Math.atan2(-this.velocity.x, -this.velocity.z), dt * 5);
  }

  _sSearch(dt) {
    if (!this.lastKnownTarget) { this.state = STATES.COMBAT; this.stateT = 0; return; }
    if (!this.path.length || this.pathIdx >= this.path.length) {
      this.path = [{
        x: this.lastKnownTarget.x + (Math.random() - 0.5) * 6,
        z: this.lastKnownTarget.z + (Math.random() - 0.5) * 6,
      }];
      this.pathIdx = 0;
    }
    this._followPath(dt, 2.4 * this.speedMul);
  }

  _trySwingMelee(dt, game, player, distToPlayer) {
    if (this.meleeActive) {
      this.meleeSwingT += dt;
      if (!this.meleeHitThisSwing &&
          this.meleeSwingT > this.meleeSwingDur * 0.35 &&
          this.meleeSwingT < this.meleeSwingDur * 0.65) {
        if (distToPlayer < 2.1) {
          const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
          const toP = new THREE.Vector3().subVectors(player.position, this.position).normalize();
          if (fwd.dot(toP) > 0.4) {
            this.meleeHitThisSwing = true;
            const fromDir = new THREE.Vector3().subVectors(player.position, this.position).normalize();
            player.takeDamage(this.meleeDamage, fromDir);
            game.audio.hitFlesh(player.position);
          }
        }
      }
      if (this.meleeSwingT >= this.meleeSwingDur) {
        this.meleeActive = false;
        this.meleeCooldown = 0.3;
      }
    } else if (this.meleeCooldown <= 0 && distToPlayer < 2.2) {
      this.meleeActive = true;
      this.meleeSwingT = 0;
      this.meleeHitThisSwing = false;
      game.audio.swoosh(this.position);
    }
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
    const desiredYaw = Math.atan2(-nx, -nz);
    this.yaw = this._approachYaw(this.yaw, desiredYaw, dt * 5);
  }

  _approachYaw(cur, target, maxStep) {
    let diff = target - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) < maxStep) return target;
    return cur + Math.sign(diff) * maxStep;
  }

  _animate(dt, game) {
    // Walking rig driven by planar speed
    this.walkT += dt * Math.hypot(this.velocity.x, this.velocity.z) * 1.9;
    const phase = this.walkT;
    const strike = Math.sin(phase);

    // Legs
    this._legL.group.rotation.x = Math.sin(phase) * 0.6;
    this._legR.group.rotation.x = -Math.sin(phase) * 0.6;
    this._legL.knee.rotation.x = Math.max(0, Math.sin(phase + Math.PI / 2)) * 0.8;
    this._legR.knee.rotation.x = Math.max(0, Math.sin(phase - Math.PI / 2)) * 0.8;

    // === Archery IK pose ===
    // When in any archery phase we override the default arm swing.
    const archeryActive = !this.usePickaxe &&
                          this._arPhase !== AR.IDLE &&
                          this._arPhase !== AR.RECOVER;
    const archeryBlend = archeryActive ? 1 :
                          (this._arPhase === AR.RECOVER ?
                            Math.max(0, 1 - this._arPhaseT / 0.35) : 0);

    if (this.usePickaxe && this.meleeActive) {
      const t = this.meleeSwingT / this.meleeSwingDur;
      const rx = -1.9 + Math.sin(t * Math.PI) * 2.6;
      this._armR.group.rotation.x = rx;
      this._armR.group.rotation.y = -0.4;
      this._armR.elbow.rotation.x = -0.6 - Math.sin(t * Math.PI) * 0.6;
      this._armL.group.rotation.x = -0.5;
      this._armL.elbow.rotation.x = -0.5;
    } else if (archeryBlend > 0.01) {
      const aim = this._desiredAimPitch;
      // Aim smoothly
      this._aimPitch = damp(this._aimPitch, aim, 10, dt);

      // LEFT arm holds bow forward-left, straight, slightly out in front of the body.
      // Pose: shoulder rotates forward (-X), arm raised out (-Z around Y is just shoulder spread).
      // We aim the bow-arm to be mostly straight and horizontal toward the target's XZ,
      // with a pitch determined by _aimPitch.
      const lTargetRX = -Math.PI / 2 + this._aimPitch;   // raise forward
      const lTargetRY = 0.2;
      const lElbowRX = -0.05;                            // nearly straight
      this._armL.group.rotation.x = damp(this._armL.group.rotation.x, lTargetRX * archeryBlend, 14, dt);
      this._armL.group.rotation.y = damp(this._armL.group.rotation.y, lTargetRY * archeryBlend, 14, dt);
      this._armL.elbow.rotation.x = damp(this._armL.elbow.rotation.x, lElbowRX, 14, dt);

      // RIGHT arm is the DRAW arm: elbow very high (near ear), hand pulls back.
      // We model this by rotating shoulder up and out + heavy elbow bend.
      // Phase variations:
      //   NOCK: hand moves toward bow (to put arrow on string) then back to draw
      //   DRAW: elbow rises, forearm pulls toward cheek anchor as drawAmount rises
      //   ANCHOR: held at full draw
      //   RELEASE: snap forward
      //   RECOVER: lower arm
      let drawAmt = this._drawAmount;
      let reachForward = 0;
      if (this._arPhase === AR.NOCK) {
        const t = clamp(this._arPhaseT / 0.22, 0, 1);
        reachForward = Math.sin(t * Math.PI) * 1.0;  // reach toward bow momentarily
        drawAmt = 0;
      }
      // Shoulder: raised up-back as we draw
      const rTargetRX = -Math.PI / 2 + this._aimPitch * 0.9 + reachForward * 0.3;
      const rTargetRY = -0.45 - 0.25 * drawAmt;
      const rTargetRZ = 0.4 * drawAmt - reachForward * 0.2;
      // Heavy elbow bend that increases with draw
      const rElbowRX = -0.4 - 1.8 * drawAmt - reachForward * 0.4;
      const rElbowRY = -0.25 * drawAmt;
      this._armR.group.rotation.x = damp(this._armR.group.rotation.x, rTargetRX * archeryBlend, 16, dt);
      this._armR.group.rotation.y = damp(this._armR.group.rotation.y, rTargetRY * archeryBlend, 16, dt);
      this._armR.group.rotation.z = damp(this._armR.group.rotation.z, rTargetRZ * archeryBlend, 16, dt);
      this._armR.elbow.rotation.x = damp(this._armR.elbow.rotation.x, rElbowRX * archeryBlend, 16, dt);
      this._armR.elbow.rotation.y = damp(this._armR.elbow.rotation.y, rElbowRY * archeryBlend, 16, dt);

      // Tiny aim-steadying sway on anchor
      if (this._arPhase === AR.ANCHOR) {
        const sway = Math.sin(performance.now() * 0.01 + this.id) * 0.01;
        this._armL.group.rotation.z += sway;
        this._armR.group.rotation.z += sway * 0.8;
      }
    } else {
      // Default arm swing while walking
      const armSwing = -strike * 0.55;
      this._armL.group.rotation.x = damp(this._armL.group.rotation.x, -armSwing, 10, dt);
      this._armR.group.rotation.x = damp(this._armR.group.rotation.x, armSwing, 10, dt);
      this._armL.group.rotation.y = damp(this._armL.group.rotation.y, 0, 10, dt);
      this._armR.group.rotation.y = damp(this._armR.group.rotation.y, 0, 10, dt);
      this._armL.group.rotation.z = damp(this._armL.group.rotation.z, 0, 10, dt);
      this._armR.group.rotation.z = damp(this._armR.group.rotation.z, 0, 10, dt);
      this._armL.elbow.rotation.x = damp(this._armL.elbow.rotation.x, -0.25, 10, dt);
      this._armR.elbow.rotation.x = damp(this._armR.elbow.rotation.x, -0.25, 10, dt);
      this._armL.elbow.rotation.y = damp(this._armL.elbow.rotation.y, 0, 10, dt);
      this._armR.elbow.rotation.y = damp(this._armR.elbow.rotation.y, 0, 10, dt);
    }

    // Idle breathing / spine sway
    const breath = Math.sin(performance.now() * 0.002 + this.id) * 0.02;
    this._pelvis.rotation.z = breath * 0.5;
    for (let i = 0; i < this._spine.length; i++) {
      this._spine[i].rotation.z = breath * (0.3 + i * 0.1);
    }
    // Head tracks target when aiming, else subtle sway
    if (this.target && (archeryActive || this.usePickaxe)) {
      const dx = this.target.position.x - this.position.x;
      const dz = this.target.position.z - this.position.z;
      const desired = Math.atan2(-dx, -dz) - this.yaw;
      this._head.rotation.y = damp(this._head.rotation.y, desired * 0.5, 8, dt);
      // pitch head a bit to aim
      this._head.rotation.x = damp(this._head.rotation.x, -this._desiredAimPitch * 0.3, 8, dt);
    } else {
      this._head.rotation.y = Math.sin(performance.now() * 0.001 + this.id) * 0.15;
      this._head.rotation.x = 0;
    }

    // Eye flicker
    this._eyeLight.intensity = 0.6 + Math.sin(performance.now() * 0.012 + this.id) * 0.2;
  }

  _updateRagdoll(dt) {
    this.ragdollT += dt;
    const t = clamp(this.ragdollT / 1.2, 0, 1);
    const ease = t * t * (3 - 2 * t);
    this.ragdollAngle = ease * (Math.PI / 2);
    this.group.rotation.set(-this.ragdollAngle * 0.9, this.yaw, 0);
    this.group.position.set(
      this.position.x + this.ragdollLean.x * ease * 0.3,
      0,
      this.position.z + this.ragdollLean.z * ease * 0.3,
    );
    this._eyeLight.intensity = Math.max(0, this._eyeLight.intensity - dt * 2);
    const flop = ease * 0.6;
    this._armL.group.rotation.x = -1.2 * flop;
    this._armR.group.rotation.x = -1.0 * flop;
    this._legL.group.rotation.x = 0.4 * flop;
    this._legR.group.rotation.x = -0.4 * flop;
  }

  hearNoise(pos, intensity, game) {
    // Already at max awareness, but noise sharpens last-known position.
    this.lastKnownTarget = pos.clone();
    if (this.state === STATES.PATROL || this.state === STATES.SEARCH) {
      this.state = STATES.INVESTIGATE; this.stateT = 0;
      this.investigateUntil = 4;
    }
  }

  receiveAlert(pos) {
    if (!this.alive) return;
    this.awareness = 1.0;
    this.lastKnownTarget = pos.clone();
    if (this.state !== STATES.COMBAT && this.state !== STATES.FLANK) {
      this.state = STATES.COMBAT; this.stateT = 0;
    }
  }
}
