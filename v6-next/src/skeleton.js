// Skeleton archer powered by a REAL rigged glTF character (Soldier.glb).
//
// The base mesh is Mixamo-rigged (65 bones). Per enemy we:
//   1. SkeletonUtils.clone the scene (preserves bones + skinning).
//   2. Rebind the four Mixamo clips (Idle/Walk/Run/TPose) to the clone via
//      AnimationMixer so 20 skeletons can each animate independently.
//   3. Swap materials to pale bone-like PBR + add a rust chest-plate, cloth
//      strap, quiver with arrow shafts, and glowing red eyes (point-light).
//   4. Attach a 3D bow to the LeftHand bone.
//   5. Drive Idle/Walk/Run from planar velocity.
//   6. AFTER the mixer has posed the skeleton each frame, overlay a bow-draw
//      pose by writing to LeftArm / RightArm / RightForeArm / Spine2 / Head
//      bone.quaternion directly. This gives reasonable aiming while the mixer
//      keeps the legs animating naturally.
//
// If the glTF failed to load we fall back to a minimal box humanoid so the
// game still runs.
import * as THREE from 'three';
import { SkeletonUtils } from 'three/addons/utils/SkeletonUtils.js';
import { clamp, damp, raySegBoxHit, approachYaw } from './utils.js';

const STATES = { COMBAT: 'combat', FLANK: 'flank', DEAD: 'dead' };

// Hit-zones used for player pistol shots (head / torso / legs damage).
const HIT_ZONES = [
  { name: 'head',  min: [-0.28, 1.55, -0.28], max: [0.28, 1.95, 0.28] },
  { name: 'torso', min: [-0.40, 0.75, -0.35], max: [0.40, 1.55, 0.35] },
  { name: 'legs',  min: [-0.40, 0.00, -0.35], max: [0.40, 0.75, 0.35] },
];

let _uid = 0;

// Walk the scene graph and find the first bone whose name ENDS with `key`
// (case-insensitive). Mixamo names all bones `mixamorig:Hips` etc, so we
// match on the suffix only.
function findBone(root, key) {
  const k = key.toLowerCase();
  let found = null;
  root.traverse(n => {
    if (found) return;
    if (!n.isBone) return;
    const nm = (n.name || '').toLowerCase();
    if (nm.endsWith(k) || nm.endsWith(':' + k)) found = n;
  });
  return found;
}

export class Skeleton {
  constructor(scene, spawn, gltfSource) {
    this.id = _uid++;
    this.scene = scene;
    this.position = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.velocity = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.alive = true;

    this.hp = 100;
    this.maxHp = 100;
    this.meleeDamage = 28;
    this.arrowDamageByZone = { head: 30, torso: 20, legs: 10 };

    // Hyper-aggressive: spawn in combat, fire within ~0.6 s.
    this.state = STATES.COMBAT;
    this.stateT = 0;
    this.lastKnownTarget = null;
    this.drawT = 0;
    this.drawSpeed = 1.6 + Math.random() * 0.5;
    this.cooldownShoot = Math.random() * 0.6;
    this.meleeCooldown = 0;
    this.meleeActive = false;
    this.meleeSwingT = 0;
    this.meleeSwingDur = 0.48;
    this.meleeHitThisSwing = false;
    this.flankSide = Math.random() < 0.5 ? -1 : 1;
    this.path = [];
    this.pathIdx = 0;
    this.pathStuckT = 0;
    this._releasePulseT = 0;

    this.scale = 1.0 + (Math.random() - 0.5) * 0.1;

    this.group = new THREE.Group();
    this.group.position.copy(this.position);
    this.group.scale.setScalar(this.scale);
    scene.add(this.group);

    this._fromGLTF = !!(gltfSource && gltfSource.scene);
    if (this._fromGLTF) this._buildFromGLTF(gltfSource);
    else this._buildFallback();

    this.ragdollT = 0;
    this.ragdollLean = new THREE.Vector3();
    this.ragdollFrozen = false;
  }

  _buildFromGLTF(gltf) {
    const rigRoot = SkeletonUtils.clone(gltf.scene);
    // Rotate so forward is -Z to match our yaw math (Soldier.glb faces +Z).
    rigRoot.rotation.y = Math.PI;
    this.group.add(rigRoot);
    this._rigRoot = rigRoot;

    // The Soldier is authored in centimeters (~175 units tall). Scale down
    // so its feet land on the floor and the head reaches our 1.8m hit-zone.
    rigRoot.scale.setScalar(0.011);

    this.bones = {
      hips:         findBone(rigRoot, 'hips'),
      spine:        findBone(rigRoot, 'spine'),
      spine1:       findBone(rigRoot, 'spine1'),
      spine2:       findBone(rigRoot, 'spine2'),
      neck:         findBone(rigRoot, 'neck'),
      head:         findBone(rigRoot, 'head'),
      leftShoulder: findBone(rigRoot, 'leftshoulder'),
      leftArm:      findBone(rigRoot, 'leftarm'),
      leftForeArm:  findBone(rigRoot, 'leftforearm'),
      leftHand:     findBone(rigRoot, 'lefthand'),
      rightShoulder:findBone(rigRoot, 'rightshoulder'),
      rightArm:     findBone(rigRoot, 'rightarm'),
      rightForeArm: findBone(rigRoot, 'rightforearm'),
      rightHand:    findBone(rigRoot, 'righthand'),
    };
    for (const k of Object.keys(this.bones)) {
      const b = this.bones[k];
      if (b) b.userData.restQuat = b.quaternion.clone();
    }

    // ---- Reskin the vanguard meshes to look like aged bone + dirt ----
    const hueShift = (Math.random() - 0.5) * 0.03;
    const lightShift = (Math.random() - 0.5) * 0.08;
    const boneMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xc8baa0).offsetHSL(hueShift, -0.1, lightShift),
      roughness: 0.88, metalness: 0.04, envMapIntensity: 0.7,
    });
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x120a06, roughness: 0.9, metalness: 0.05,
    });
    rigRoot.traverse(obj => {
      if (obj.isMesh || obj.isSkinnedMesh) {
        const nm = (obj.name || '').toLowerCase();
        obj.material = nm.includes('visor') ? visorMat : boneMat;
        obj.castShadow = true; obj.receiveShadow = true;
        if (obj.isSkinnedMesh) obj.frustumCulled = false;
      }
    });

    // ---- Add decorative attachments at centimeter scale ----
    // Chest plate + pauldrons on Spine2.
    const chestAnchor = this.bones.spine2 || this.bones.spine1 || this.bones.spine;
    if (chestAnchor) {
      const rustMat = new THREE.MeshStandardMaterial({
        color: 0x5c3a1e, roughness: 0.55, metalness: 0.75,
        emissive: 0x150800, emissiveIntensity: 0.15,
      });
      const plate = new THREE.Mesh(new THREE.BoxGeometry(38, 42, 10), rustMat);
      plate.position.set(0, 8, 16);
      plate.castShadow = true;
      chestAnchor.add(plate);
      const paul = (side) => {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(12, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2),
          rustMat,
        );
        m.position.set(side * 18, 16, 0);
        m.rotation.z = side * 0.3;
        m.castShadow = true;
        return m;
      };
      chestAnchor.add(paul(1));
      chestAnchor.add(paul(-1));
      // Cloth strap
      const cloth = new THREE.MeshStandardMaterial({
        color: 0x3a2616, roughness: 1, metalness: 0,
        side: THREE.DoubleSide, transparent: true, alphaTest: 0.3,
      });
      const strap = new THREE.Mesh(new THREE.PlaneGeometry(12, 55), cloth);
      strap.position.set(6, -2, 18);
      strap.rotation.z = 0.3;
      chestAnchor.add(strap);

      // Quiver on back
      const qGroup = new THREE.Group();
      const qMat = new THREE.MeshStandardMaterial({ color: 0x3a2416, roughness: 0.9, metalness: 0.1 });
      const qBody = new THREE.Mesh(new THREE.CylinderGeometry(6, 5, 35, 10), qMat);
      qGroup.add(qBody);
      const arrowMat = new THREE.MeshStandardMaterial({ color: 0x6b5a3e, roughness: 0.9 });
      const fletchMat = new THREE.MeshStandardMaterial({ color: 0x6a1f1f, roughness: 1, side: THREE.DoubleSide });
      for (let i = 0; i < 5; i++) {
        const a = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 42, 5), arrowMat);
        a.position.set((i - 2) * 1.4, 20, (Math.random() - 0.5) * 2);
        qGroup.add(a);
        const fl = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 4), fletchMat);
        fl.position.copy(a.position);
        fl.position.y += 18;
        qGroup.add(fl);
      }
      qGroup.position.set(0, 15, -14);
      qGroup.rotation.x = -0.3;
      qGroup.rotation.z = 0.3;
      chestAnchor.add(qGroup);
    }

    // Glowing red eyes + eye-light on the Head bone.
    if (this.bones.head) {
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2a10 });
      for (const ex of [-2.5, 2.5]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 6), eyeMat);
        eye.position.set(ex, 0, 7);
        this.bones.head.add(eye);
      }
      const eyeLight = new THREE.PointLight(0xff3020, 0.9, 280, 2);
      eyeLight.position.set(0, 2, 6);
      this.bones.head.add(eyeLight);
      this._eyeLight = eyeLight;
      this._eyeMat = eyeMat;
    }

    // 3D bow attached to LeftHand bone.
    if (this.bones.leftHand) {
      const bow = this._buildBow();
      bow.position.set(0, 5, 0);
      this.bones.leftHand.add(bow);
      this._bow = bow;
    }

    // AnimationMixer for Idle/Walk/Run.
    if (gltf.animations && gltf.animations.length) {
      this.mixer = new THREE.AnimationMixer(rigRoot);
      this._actions = {};
      for (const clip of gltf.animations) {
        const action = this.mixer.clipAction(clip);
        action.enabled = true;
        action.setLoop(THREE.LoopRepeat);
        this._actions[clip.name.toLowerCase()] = action;
      }
      this._currentAction = null;
      this._playAction('idle');
      // De-sync 20 skeletons so they don't move in lockstep.
      for (const a of Object.values(this._actions)) {
        a.time = Math.random() * 2;
      }
    }
  }

  _buildBow() {
    const bow = new THREE.Group();
    const bowMat = new THREE.MeshStandardMaterial({ color: 0x2a1608, roughness: 0.85, metalness: 0.1 });
    const stringMat = new THREE.MeshStandardMaterial({ color: 0xd8cfb5, roughness: 0.4 });
    const grip = new THREE.Mesh(new THREE.BoxGeometry(3, 18, 3.5), bowMat);
    bow.add(grip);
    // Upper + lower limbs (curved via chained segments)
    const ul1 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 26, 3), bowMat);
    ul1.position.set(0, 20, 0); ul1.rotation.z = 0.26; bow.add(ul1);
    const ul2 = new THREE.Mesh(new THREE.BoxGeometry(2, 22, 2.6), bowMat);
    ul2.position.set(4, 38, 0); ul2.rotation.z = 0.5; bow.add(ul2);
    const ul3 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 10, 2.2), bowMat);
    ul3.position.set(8, 52, 0); ul3.rotation.z = 0.85; bow.add(ul3);
    const ll1 = ul1.clone(); ll1.position.y = -20; ll1.rotation.z = -0.26; bow.add(ll1);
    const ll2 = ul2.clone(); ll2.position.y = -38; ll2.rotation.z = -0.5; bow.add(ll2);
    const ll3 = ul3.clone(); ll3.position.y = -52; ll3.rotation.z = -0.85; bow.add(ll3);
    // Bowstring (position.x animated for the pull)
    const string = new THREE.Mesh(new THREE.BoxGeometry(0.6, 100, 0.6), stringMat);
    string.position.set(8, 0, 0);
    bow.add(string);
    this._bowString = string;
    // Arrow (hidden until drawing)
    const arrow = new THREE.Group();
    const aShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.8, 70, 6),
      new THREE.MeshStandardMaterial({ color: 0x6b5a3e, roughness: 0.9 }),
    );
    aShaft.rotation.z = Math.PI / 2;
    arrow.add(aShaft);
    const aTip = new THREE.Mesh(
      new THREE.ConeGeometry(1.4, 7, 6),
      new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.3, metalness: 0.9 }),
    );
    aTip.rotation.z = -Math.PI / 2; aTip.position.x = 37;
    arrow.add(aTip);
    for (let i = 0; i < 3; i++) {
      const fl = new THREE.Mesh(
        new THREE.PlaneGeometry(7, 3.5),
        new THREE.MeshStandardMaterial({ color: 0x4a4230, roughness: 1, side: THREE.DoubleSide }),
      );
      fl.position.set(-32, 0, 0);
      fl.rotation.x = (i * Math.PI * 2) / 3;
      fl.rotation.y = Math.PI / 2;
      arrow.add(fl);
    }
    arrow.position.set(8, 0, 0);
    arrow.visible = false;
    bow.add(arrow);
    this._arrowOnBow = arrow;
    bow.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
    return bow;
  }

  _buildFallback() {
    // Minimal humanoid if GLTF failed.
    const mat = new THREE.MeshStandardMaterial({ color: 0xc8baa0, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.35), mat);
    body.position.y = 0.9;
    body.castShadow = true;
    this.group.add(body);
    this._bow = null;
    this._arrowOnBow = null;
  }

  _playAction(name, fadeTime = 0.25) {
    if (!this._actions) return;
    const next = this._actions[name] || this._actions['idle'];
    if (!next || next === this._currentAction) return;
    if (this._currentAction) {
      next.reset().play();
      next.crossFadeFrom(this._currentAction, fadeTime, false);
    } else {
      next.reset().play();
    }
    this._currentAction = next;
  }

  takeDamage(amount, fromPos) {
    if (!this.alive) return;
    this.hp -= amount;
    this.lastKnownTarget = fromPos.clone();
    if (this.hp <= 0) this._die(fromPos);
  }

  _die(fromPos) {
    this.alive = false;
    this.state = STATES.DEAD;
    this.ragdollT = 0;
    const away = new THREE.Vector3().subVectors(this.position, fromPos).normalize();
    this.ragdollLean.copy(away).multiplyScalar(1.5);
    if (this._eyeLight) this._eyeLight.intensity = 0;
    if (this._eyeMat) this._eyeMat.color.setHex(0x1a0000);
    if (this._actions) {
      for (const a of Object.values(this._actions)) a.stop();
      this._currentAction = null;
    }
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
          t, zone: z.name,
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
    this._releasePulseT = Math.max(0, this._releasePulseT - dt * 3.5);

    const player = game.player;
    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const distToPlayer = Math.hypot(dx, dz);
    const canSee = this._hasLineOfSight(player.position, game.colliders);
    if (canSee) this.lastKnownTarget = player.position.clone();

    if (this.state === STATES.COMBAT) {
      if (Math.random() < 0.003) { this.state = STATES.FLANK; this.stateT = 0; }
    } else if (this.state === STATES.FLANK) {
      if (this.stateT > 2.0) { this.state = STATES.COMBAT; this.stateT = 0; }
    }

    const desiredYaw = Math.atan2(-dx, -dz);
    this.yaw = approachYaw(this.yaw, desiredYaw, dt * 7);

    let animState = 'idle';
    if (distToPlayer < 2.2) {
      this.velocity.x *= 0.5; this.velocity.z *= 0.5;
      this._trySwingMelee(dt, game, player, distToPlayer);
      this.drawT = Math.max(0, this.drawT - dt * 3);
      if (this._arrowOnBow) this._arrowOnBow.visible = false;
    } else if (this.state === STATES.FLANK) {
      const nd = distToPlayer || 1;
      const px = -dz / nd, pz = dx / nd;
      this.path = [{
        x: this.position.x + px * this.flankSide * 8,
        z: this.position.z + pz * this.flankSide * 8,
      }];
      this.pathIdx = 0;
      this._followPath(dt, 3.3);
      this.drawT = Math.max(0, this.drawT - dt * 0.6);
      animState = 'run';
    } else {
      const idealDist = 8;
      if (!canSee) {
        this.path = [{ x: player.position.x, z: player.position.z }];
        this.pathIdx = 0;
        this._followPath(dt, 3.6);
        this.drawT = Math.max(0, this.drawT - dt * 0.5);
        animState = 'run';
      } else if (distToPlayer > idealDist + 3) {
        this.path = [{
          x: player.position.x - dx / distToPlayer * idealDist,
          z: player.position.z - dz / distToPlayer * idealDist,
        }];
        this.pathIdx = 0;
        this._followPath(dt, 3.0);
        this.drawT = Math.max(0, this.drawT - dt * 0.5);
        animState = 'run';
      } else if (distToPlayer < idealDist - 3) {
        const ax = -dx / distToPlayer, az = -dz / distToPlayer;
        this.velocity.x = damp(this.velocity.x, ax * 2.0, 4, dt);
        this.velocity.z = damp(this.velocity.z, az * 2.0, 4, dt);
        animState = 'walk';
      } else {
        this.velocity.x *= 0.75; this.velocity.z *= 0.75;
        animState = 'idle';
      }

      if (canSee && this.cooldownShoot <= 0) {
        if (this.drawT < 0.01) game.audio.bowDraw(this.position);
        this.drawT = Math.min(1, this.drawT + dt * this.drawSpeed);
        if (this._arrowOnBow) this._arrowOnBow.visible = true;
        if (this.drawT >= 1.0) {
          this._releaseArrow(game, player);
          this.drawT = 0;
          if (this._arrowOnBow) this._arrowOnBow.visible = false;
          this._releasePulseT = 1.0;
          this.cooldownShoot = 0.6 + Math.random() * 0.4;
        }
      } else {
        this.drawT = Math.max(0, this.drawT - dt * 0.8);
        if (this.drawT < 0.05 && this._arrowOnBow) this._arrowOnBow.visible = false;
      }
    }

    this._moveAndCollide(dt, game);

    const planar = Math.hypot(this.velocity.x, this.velocity.z);
    if (planar > 2.4) animState = 'run';
    else if (planar > 0.4 && animState === 'idle') animState = 'walk';
    if (this.mixer) this._playAction(animState);

    // Update mixer FIRST, then overlay aim on upper body.
    if (this.mixer) this.mixer.update(dt);
    this._applyAimPose();
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
    let from;
    if (this._bow) {
      from = this._bow.getWorldPosition(new THREE.Vector3());
    } else {
      from = this.position.clone(); from.y += 1.6;
    }
    const target = player.position.clone(); target.y += 1.05;
    target.addScaledVector(player.velocity, 0.22);
    const dir = target.clone().sub(from);
    const dist = dir.length();
    dir.normalize();
    const spread = 0.015 + (dist / 60) * 0.02;
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();
    game.spawnArrow(from, dir.clone().multiplyScalar(48), this);
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

  // Overlay an aim/bow-draw pose AFTER the AnimationMixer has posed the rig.
  // Mixamo rest pose: both arms hang down the sides. Rotating LeftArm by
  // ~-pi/2 around Z lifts the arm forward. RightArm needs a similar lift
  // plus a strong forearm bend to bring the hand to the jaw.
  _applyAimPose() {
    if (!this._fromGLTF || !this.bones) return;
    const drawBase = Math.max(this.drawT, this._releasePulseT);
    if (drawBase < 0.02 && !this.meleeActive) return;

    const draw = this.drawT, release = this._releasePulseT;
    const b = this.bones;

    const setEuler = (bone, ex, ey, ez) => {
      if (!bone) return;
      bone.quaternion.setFromEuler(new THREE.Euler(ex, ey, ez, 'XYZ'));
    };
    const blendEuler = (bone, ex, ey, ez, w) => {
      if (!bone) return;
      const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(ex, ey, ez, 'XYZ'));
      const rest = bone.userData.restQuat || bone.quaternion.clone();
      const mixed = rest.clone().slerp(target, w);
      bone.quaternion.copy(mixed);
    };

    // Left arm: lift straight out in front to hold the bow.
    blendEuler(b.leftArm, 0, 0.12, -Math.PI * 0.5, drawBase);
    blendEuler(b.leftForeArm, 0, -0.2, 0, drawBase);

    // Right arm: lift + forearm bends sharply to pull the string.
    const shoulderLift = Math.PI * 0.48 - release * 0.25;
    const shoulderOut = -0.3 - 0.25 * draw + release * 0.3;
    blendEuler(b.rightArm, 0, shoulderOut, shoulderLift, drawBase);
    const elbowBend = -Math.PI * 0.6 - Math.PI * 0.45 * draw + Math.PI * 0.9 * release;
    blendEuler(b.rightForeArm, 0, elbowBend, 0, drawBase);

    // Bowstring pull visual.
    if (this._bowString) {
      const stringPull = draw * 12 + release * -2;
      this._bowString.position.x = 8 - stringPull;
      this._bowString.scale.y = 1 + release * 0.02 - draw * 0.10;
    }

    // Spine lean forward + head tilt toward aim.
    blendEuler(b.spine2, -0.14, 0, 0, drawBase);
    blendEuler(b.head, -0.08, 0.08, 0, drawBase);

    if (this.meleeActive) {
      const t = this.meleeSwingT / this.meleeSwingDur;
      const wind = clamp(t / 0.25, 0, 1);
      const slash = clamp((t - 0.25) / 0.4, 0, 1);
      const recover = clamp((t - 0.65) / 0.35, 0, 1);
      const swing = Math.PI * 0.4 + wind * Math.PI * 0.3 - slash * Math.PI * 0.7 + recover * Math.PI * 0.2;
      setEuler(b.rightArm, 0, 0, swing);
      setEuler(b.rightForeArm, 0, -Math.PI * 0.5 + slash * Math.PI * 0.4, 0);
    }
  }

  _updateRagdoll(dt) {
    if (this.ragdollFrozen) return;
    this.ragdollT += dt;
    const t = Math.min(1, this.ragdollT * 2.0);
    if (this._rigRoot) {
      this._rigRoot.rotation.x = Math.PI * 0.5 * t + this.ragdollLean.z * 0.8 * t;
      this._rigRoot.rotation.z = -this.ragdollLean.x * 0.5 * t;
      this._rigRoot.position.y = -0.05 * t;
    }
    if (t >= 1) this.ragdollFrozen = true;
  }
}
