// Procedural humanoid skeleton with bow/arrow + pickaxe, AI state machine,
// group behavior, adaptive tactics, and hit-zone damage.
import * as THREE from 'three';
import { rand, randInt, clamp, damp, lerp, raySegBoxHit } from './utils.js';
import { matBone } from './materials.js';

const STATES = {
  PATROL: 'patrol',
  INVESTIGATE: 'investigate',
  ALERT: 'alert',
  COMBAT: 'combat',
  FLANK: 'flank',
  RETREAT: 'retreat',
  SEARCH: 'search',
  DEAD: 'dead',
};

const HEAD_H = 1.55; // from feet
const TORSO_H = 1.1;
const LEG_H = 0.55;

// Hit-zone boxes around the skeleton's origin (x,y,z relative), each is [minOffset, maxOffset]
const HIT_ZONES = [
  { name: 'head',  min: [-0.25, 1.35, -0.25], max: [0.25, 1.75, 0.25], dmgMul: 1.0 }, // 30 base
  { name: 'torso', min: [-0.35, 0.60, -0.3],  max: [0.35, 1.35, 0.3],  dmgMul: 1.0 }, // 20 base
  { name: 'legs',  min: [-0.35, 0.0,  -0.3],  max: [0.35, 0.60, 0.3],  dmgMul: 1.0 }, // 10 base
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
    this.usePickaxe = false; // if true, melee mode
    this.arrows = 30;
    this.meleeDamage = 30;
    this.arrowDamageByZone = { head: 30, torso: 20, legs: 10 };

    // AI
    this.state = STATES.PATROL;
    this.stateT = 0;
    this.target = null;
    this.lastKnownTarget = null;   // Vector3 or null
    this.awareness = 0;            // 0..1 builds with sight/noise
    this.aimT = 0;                 // 0..1 while nocking
    this.cooldownShoot = rand(0, 1.2);
    this.meleeCooldown = 0;
    this.meleeActive = false;
    this.meleeSwingT = 0;
    this.meleeSwingDur = 0.55;     // realistic speed
    this.meleeHitThisSwing = false;
    this.investigateUntil = 0;
    this.retreatUntil = 0;
    this.flankSide = Math.random() < 0.5 ? -1 : 1;
    this.nextPathT = 0;
    this.path = [];
    this.pathIdx = 0;
    this.pathStuckT = 0;

    // Adaptive: per-enemy preference (learned via game signal)
    this.preferFlank = 0;     // rises when player hides
    this.preferSuppress = 0;  // rises when player camps
    this.preferDistance = 0;  // rises when player aggressive (melee)

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

    // Walk phase for procedural anim
    this.walkT = 0;

    // Slight per-skeleton variation
    this.scale = 0.95 + Math.random() * 0.12;
    this.group.scale.setScalar(this.scale);
    this.speedMul = 0.95 + Math.random() * 0.15;

    // Aiming target height for bow
    this._aimAt = new THREE.Vector3();
  }

  _buildBody() {
    const mat = matBone();
    const dirtyMat = matBone(); dirtyMat.color.setHex(0x8b7d5d);
    const clothMat = new THREE.MeshStandardMaterial({ color: 0x2b2217, roughness: 1.0, metalness: 0 });
    const armorMat = new THREE.MeshStandardMaterial({ color: 0x3b2e1a, roughness: 0.85, metalness: 0.3 });

    // Skeleton origin = FEET, y=0.
    const G = this.group;

    // Pelvis
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.22), mat);
    pelvis.position.y = 0.75;
    G.add(pelvis);
    this._pelvis = pelvis;

    // Spine (segmented)
    this._spine = [];
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Mesh(new THREE.BoxGeometry(0.3 - i * 0.02, 0.11, 0.2 - i * 0.015), mat);
      seg.position.y = 0.92 + i * 0.1;
      G.add(seg);
      this._spine.push(seg);
    }

    // Ribcage (hint)
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.19 - i * 0.015, 0.018, 4, 10, Math.PI), mat);
      rib.position.set(0, 1.05 + i * 0.08, 0);
      rib.rotation.y = Math.PI / 2;
      rib.rotation.x = Math.PI / 2;
      G.add(rib);
    }

    // Shoulders
    const shoulderL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), mat);
    shoulderL.position.set(-0.19, 1.35, 0);
    const shoulderR = shoulderL.clone(); shoulderR.position.x = 0.19;
    G.add(shoulderL); G.add(shoulderR);

    // Arms - grouped so we can rotate at shoulder
    const makeArmGroup = (side /* -1 left, +1 right */) => {
      const g = new THREE.Group();
      g.position.set(side * 0.19, 1.35, 0);

      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.36, 0.09), mat);
      upper.position.set(0, -0.18, 0);
      g.add(upper);

      const elbow = new THREE.Group();
      elbow.position.set(0, -0.38, 0);
      g.add(elbow);

      const lower = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.34, 0.08), mat);
      lower.position.set(0, -0.17, 0);
      elbow.add(lower);

      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.1), mat);
      hand.position.set(0, -0.36, 0.03);
      elbow.add(hand);

      return { group: g, elbow, hand };
    };
    this._armL = makeArmGroup(-1); G.add(this._armL.group);
    this._armR = makeArmGroup(1); G.add(this._armR.group);

    // Legs
    const makeLegGroup = (side) => {
      const g = new THREE.Group();
      g.position.set(side * 0.1, 0.75, 0);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.38, 0.11), mat);
      upper.position.set(0, -0.2, 0);
      g.add(upper);
      const knee = new THREE.Group();
      knee.position.set(0, -0.4, 0);
      g.add(knee);
      const lower = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.35, 0.1), mat);
      lower.position.set(0, -0.18, 0);
      knee.add(lower);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.22), mat);
      foot.position.set(0, -0.36, 0.05);
      knee.add(foot);
      return { group: g, knee };
    };
    this._legL = makeLegGroup(-1); G.add(this._legL.group);
    this._legR = makeLegGroup(1); G.add(this._legR.group);

    // Head
    const head = new THREE.Group();
    head.position.set(0, 1.55, 0);
    G.add(head);
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.26), mat);
    head.add(skull);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.22), dirtyMat);
    jaw.position.set(0, -0.15, 0.01);
    head.add(jaw);
    // Eyes (glowing)
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.95 });
    for (const ex of [-0.06, 0.06]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), eyeMat);
      eye.position.set(ex, 0.02, 0.12);
      head.add(eye);
    }
    const eyeLight = new THREE.PointLight(0xffaa55, 0.5, 3, 2);
    eyeLight.position.set(0, 0.04, 0.12);
    head.add(eyeLight);
    this._head = head;
    this._eyeLight = eyeLight;

    // Cloth tatters
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(
        new THREE.PlaneGeometry(0.22 + Math.random() * 0.1, 0.5 + Math.random() * 0.4),
        clothMat,
      );
      t.position.set((Math.random() - 0.5) * 0.3, 0.8 + Math.random() * 0.3, 0.12);
      t.rotation.y = Math.random() * 0.4 - 0.2;
      G.add(t);
    }
    // Rusty chest plate
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.32, 0.06),
      armorMat,
    );
    plate.position.set(0, 1.2, 0.14);
    G.add(plate);

    // Build bow (in left hand) and pickaxe (slung, shown when melee)
    this._buildWeapons();

    G.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  _buildWeapons() {
    // BOW - held in left hand (at end of left forearm)
    const bowGroup = new THREE.Group();
    const bowMat = new THREE.MeshStandardMaterial({ color: 0x3a2616, roughness: 0.9 });
    const stringMat = new THREE.MeshStandardMaterial({ color: 0xd8cfb5, roughness: 0.5 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.38, 0.03), bowMat);
    top.position.set(0, 0.22, 0);
    top.rotation.z = 0.22;
    bowGroup.add(top);
    const bot = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.38, 0.03), bowMat);
    bot.position.set(0, -0.22, 0);
    bot.rotation.z = -0.22;
    bowGroup.add(bot);
    const string = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.9, 0.005), stringMat);
    string.position.set(0.08, 0, 0);
    bowGroup.add(string);
    this._bowString = string;
    bowGroup.rotation.y = Math.PI / 2;
    bowGroup.position.set(0, -0.38, 0.08);
    this._armL.elbow.add(bowGroup);
    this._bow = bowGroup;

    // PICKAXE (stays visible slung on back when using bow; active in right hand when melee)
    const pickGroup = new THREE.Group();
    const haftMat = new THREE.MeshStandardMaterial({ color: 0x2e1e10, roughness: 0.9 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x2b2723, roughness: 0.65, metalness: 0.6 });
    const haft = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.7, 0.04), haftMat);
    haft.position.set(0, -0.2, 0);
    pickGroup.add(haft);
    const pickHead = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.06), headMat);
    pickHead.position.set(0, 0.1, 0);
    pickGroup.add(pickHead);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.2, 6), headMat);
    spike.rotation.z = Math.PI / 2;
    spike.position.set(0.18, 0.1, 0);
    pickGroup.add(spike);

    // Two positions: slung on back vs in right hand
    this._pickSlungPos = { p: new THREE.Vector3(0, 1.2, -0.18), r: new THREE.Euler(0, 0, Math.PI / 2) };
    this._pickHandPos = { p: new THREE.Vector3(0, -0.38, 0.08), r: new THREE.Euler(0, 0, 0) };
    // Default: slung
    pickGroup.position.copy(this._pickSlungPos.p);
    pickGroup.rotation.copy(this._pickSlungPos.r);
    this.group.add(pickGroup);
    this._pickaxe = pickGroup;
  }

  setMeleeMode(on) {
    if (this.usePickaxe === on) return;
    this.usePickaxe = on;
    if (on) {
      // Move pickaxe to right hand
      this.group.remove(this._pickaxe);
      this._armR.elbow.add(this._pickaxe);
      this._pickaxe.position.copy(this._pickHandPos.p);
      this._pickaxe.rotation.copy(this._pickHandPos.r);
      this._bow.visible = false;
    } else {
      // Move back to back
      this._armR.elbow.remove(this._pickaxe);
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
    if (this.hp <= 0) this._die(fromPos);
  }

  _die(fromPos) {
    this.alive = false;
    this.state = STATES.DEAD;
    this.ragdollT = 0;
    const away = new THREE.Vector3().subVectors(this.position, fromPos).normalize();
    this.ragdollLean.copy(away).multiplyScalar(1.2);
    // Stop eye glow
    this._eyeLight.intensity = 0;
    // Shift head/eye materials to dim (can't easily edit shared emissive,
    // but eye is a BasicMaterial on each eye mesh — we dim by fading)
  }

  // Returns best-hit zone info for a segment from/to (bullet path).
  // { zone, hitPoint, t }
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
    const from = this.position.clone(); from.y += HEAD_H * 0.9;
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

  // Called by game each frame.
  update(dt, game) {
    if (!this.alive) {
      this._updateRagdoll(dt);
      return;
    }
    this.stateT += dt;
    this.cooldownShoot -= dt;
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);

    // Perception
    const player = game.player;
    const toPlayer = new THREE.Vector3().subVectors(player.position, this.position);
    const distToPlayer = toPlayer.length();
    const dirToPlayer = toPlayer.clone().multiplyScalar(1 / Math.max(0.001, distToPlayer));
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const dotForward = forward.dot(dirToPlayer);

    const viewCone = 0.25;           // cos angle ~75 deg half
    const sightMaxDist = 28 + (player.sprinting ? 4 : 0) - (player.crouching ? 6 : 0);

    const canSee = (distToPlayer < sightMaxDist) &&
                   (dotForward > viewCone || distToPlayer < 4) &&
                   this._hasLineOfSight(player.position, game.colliders);

    // Awareness decay
    if (canSee) {
      this.awareness = Math.min(1, this.awareness + dt * 2.5);
      this.lastKnownTarget = player.position.clone();
      this.target = player;
    } else {
      this.awareness = Math.max(0, this.awareness - dt * 0.25);
      if (this.awareness <= 0.02) this.target = null;
    }

    // --- Weapon preference logic ---
    // Out of arrows => always pickaxe.
    // Aggressive-playstyle learning: if close & player aggressive, may swap to pickaxe.
    const forceMelee = this.arrows <= 0 || distToPlayer < 2.5;
    const preferMelee = forceMelee || (this.preferDistance < 0 && distToPlayer < 5);
    this.setMeleeMode(preferMelee);

    // --- State transitions ---
    this._chooseState(dt, game, distToPlayer, canSee);

    // --- Execute current state ---
    switch (this.state) {
      case STATES.PATROL:      this._sPatrol(dt, game); break;
      case STATES.INVESTIGATE: this._sInvestigate(dt, game); break;
      case STATES.ALERT:       this._sAlert(dt, game); break;
      case STATES.COMBAT:      this._sCombat(dt, game, distToPlayer, canSee); break;
      case STATES.FLANK:       this._sFlank(dt, game, distToPlayer, canSee); break;
      case STATES.RETREAT:     this._sRetreat(dt, game); break;
      case STATES.SEARCH:      this._sSearch(dt, game); break;
    }

    // --- Physics + movement + collisions ---
    this._moveAndCollide(dt, game);

    // --- Procedural anim ---
    this._animate(dt);
  }

  _chooseState(dt, game, distToPlayer, canSee) {
    // Low HP => retreat briefly
    if (this.hp < 25 && this.state !== STATES.RETREAT && Math.random() < 0.02) {
      this.state = STATES.RETREAT; this.stateT = 0;
      this.retreatUntil = 2.5 + Math.random() * 2;
      return;
    }
    if (this.state === STATES.RETREAT) {
      if (this.stateT > this.retreatUntil) {
        this.state = this.target ? STATES.COMBAT : STATES.SEARCH;
        this.stateT = 0;
      }
      return;
    }

    // Combat transitions
    if (canSee && this.awareness > 0.5) {
      // Adaptive: if player-prefers-cover (from game feedback), sometimes flank
      if (this.state !== STATES.FLANK && Math.random() < 0.005 + this.preferFlank * 0.01) {
        this.state = STATES.FLANK; this.stateT = 0;
        this.flankSide = Math.random() < 0.5 ? -1 : 1;
      } else if (this.state !== STATES.COMBAT && this.state !== STATES.FLANK) {
        this.state = STATES.COMBAT; this.stateT = 0;
      }
      return;
    }

    if (this.awareness > 0.2 && this.lastKnownTarget) {
      if (this.state !== STATES.INVESTIGATE && this.state !== STATES.SEARCH) {
        this.state = STATES.INVESTIGATE; this.stateT = 0;
        this.investigateUntil = 6;
      }
      return;
    }

    // Back to patrol if nothing interesting
    if (this.state === STATES.INVESTIGATE && this.stateT > this.investigateUntil) {
      this.state = STATES.SEARCH; this.stateT = 0; this.investigateUntil = 5;
      return;
    }
    if (this.state === STATES.SEARCH && this.stateT > this.investigateUntil) {
      this.state = STATES.PATROL; this.stateT = 0;
      return;
    }
  }

  _sPatrol(dt, game) {
    if (this.nextPathT <= 0 || !this.path.length || this.pathIdx >= this.path.length) {
      // pick a random patrol point in the same or adjacent zone
      const pts = game.patrolPoints;
      const near = pts.filter(p =>
        Math.hypot(p.x - this.position.x, p.z - this.position.z) < 35,
      );
      const pick = (near.length ? near : pts)[randInt(0, (near.length ? near.length : pts.length))];
      this.path = [{ x: pick.x, z: pick.z }];
      this.pathIdx = 0;
      this.nextPathT = 6 + Math.random() * 6;
    }
    this.nextPathT -= dt;
    this._followPath(dt, 1.3 * this.speedMul);
  }

  _sInvestigate(dt, game) {
    if (!this.lastKnownTarget) { this.state = STATES.PATROL; return; }
    this.path = [{ x: this.lastKnownTarget.x, z: this.lastKnownTarget.z }];
    this.pathIdx = 0;
    this._followPath(dt, 2.1 * this.speedMul);
  }

  _sAlert(dt, game) {
    // stand ground, sweep view
    this.yaw += dt * 0.6 * Math.sin(this.stateT * 1.7);
  }

  _sCombat(dt, game, distToPlayer, canSee) {
    const player = this.target;
    if (!player) { this.state = STATES.SEARCH; this.stateT = 0; return; }

    // Face the target
    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const desiredYaw = Math.atan2(-dx, -dz);
    this.yaw = this._approachYaw(this.yaw, desiredYaw, dt * 4);

    if (this.usePickaxe) {
      // Melee approach
      if (distToPlayer > 1.8) {
        this.path = [{ x: player.position.x, z: player.position.z }];
        this.pathIdx = 0;
        this._followPath(dt, 2.8 * this.speedMul);
      } else {
        this.velocity.x *= 0.5; this.velocity.z *= 0.5;
        this._trySwingMelee(dt, game, player, distToPlayer);
      }
    } else {
      // Archer behavior: maintain distance, stop to aim, shoot
      const idealDist = 10 + this.preferDistance * 3;
      if (distToPlayer < idealDist - 3) {
        // back up
        const away = new THREE.Vector3(-dx, 0, -dz).normalize();
        this.velocity.x = damp(this.velocity.x, away.x * 2.0, 4, dt);
        this.velocity.z = damp(this.velocity.z, away.z * 2.0, 4, dt);
      } else if (distToPlayer > idealDist + 4) {
        // close a bit, with small offset to not crowd
        this.path = [{ x: player.position.x - dx / distToPlayer * idealDist, z: player.position.z - dz / distToPlayer * idealDist }];
        this.pathIdx = 0;
        this._followPath(dt, 1.8 * this.speedMul);
      } else {
        this.velocity.x *= 0.75; this.velocity.z *= 0.75;
      }

      // Aim + shoot (requires LOS, cooldown)
      if (canSee && this.cooldownShoot <= 0 && this.arrows > 0) {
        this.aimT = Math.min(1, this.aimT + dt * 1.2);
        if (this.aimT >= 1.0) {
          this._shootArrow(game, player);
          this.aimT = 0;
          this.cooldownShoot = 2.2 + Math.random() * 0.8;
          this.arrows -= 1;
        }
      } else {
        this.aimT = Math.max(0, this.aimT - dt * 0.8);
      }
    }
  }

  _sFlank(dt, game, distToPlayer, canSee) {
    const player = this.target;
    if (!player) { this.state = STATES.SEARCH; this.stateT = 0; return; }
    // Strafe perpendicular to player direction
    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const nd = Math.hypot(dx, dz) || 1;
    const px = -dz / nd, pz = dx / nd;
    const tx = this.position.x + px * this.flankSide * 6;
    const tz = this.position.z + pz * this.flankSide * 6;
    this.path = [{ x: tx, z: tz }];
    this.pathIdx = 0;
    this._followPath(dt, 2.6 * this.speedMul);
    if (this.stateT > 3) { this.state = STATES.COMBAT; this.stateT = 0; }
  }

  _sRetreat(dt, game) {
    // move away from target
    if (!this.target) { this.state = STATES.SEARCH; this.stateT = 0; return; }
    const dx = this.position.x - this.target.position.x;
    const dz = this.position.z - this.target.position.z;
    const d = Math.hypot(dx, dz) || 1;
    this.velocity.x = damp(this.velocity.x, (dx / d) * 3.5, 6, dt);
    this.velocity.z = damp(this.velocity.z, (dz / d) * 3.5, 6, dt);
    this.yaw = this._approachYaw(this.yaw, Math.atan2(-this.velocity.x, -this.velocity.z), dt * 5);
  }

  _sSearch(dt, game) {
    if (!this.lastKnownTarget) { this.state = STATES.PATROL; return; }
    // Random offsets around last known
    if (!this.path.length || this.pathIdx >= this.path.length) {
      this.path = [{
        x: this.lastKnownTarget.x + (Math.random() - 0.5) * 8,
        z: this.lastKnownTarget.z + (Math.random() - 0.5) * 8,
      }];
      this.pathIdx = 0;
    }
    this._followPath(dt, 1.6 * this.speedMul);
  }

  _trySwingMelee(dt, game, player, distToPlayer) {
    if (this.meleeActive) {
      this.meleeSwingT += dt;
      if (!this.meleeHitThisSwing &&
          this.meleeSwingT > this.meleeSwingDur * 0.35 &&
          this.meleeSwingT < this.meleeSwingDur * 0.65) {
        if (distToPlayer < 2.1) {
          // Face check
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
        this.meleeCooldown = 0.45;
      }
    } else if (this.meleeCooldown <= 0 && distToPlayer < 2.2) {
      this.meleeActive = true;
      this.meleeSwingT = 0;
      this.meleeHitThisSwing = false;
      game.audio.swoosh(this.position);
    }
  }

  _shootArrow(game, player) {
    // Spawn arrow from bow position
    const from = this._bow.getWorldPosition(new THREE.Vector3());
    const target = player.position.clone(); target.y += 1.1;
    // Lead slightly if player moving (predictive)
    const leadT = 0.25;
    target.addScaledVector(player.velocity, leadT * 0.5);

    const dir = target.clone().sub(from);
    const dist = dir.length();
    dir.normalize();
    // Add small inaccuracy based on distance & adaptive learning
    const spread = 0.04 + (dist / 40) * 0.04;
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();

    const speed = 34;
    game.spawnArrow(from, dir.clone().multiplyScalar(speed), this);
    game.audio.bow(this.position);
  }

  _moveAndCollide(dt, game) {
    // Integrate with collisions (reuse player method idea for XZ only)
    const tentative = this.position.clone();
    tentative.x += this.velocity.x * dt;
    tentative.z += this.velocity.z * dt;
    // Resolve vs boxes using same helper
    const vec = new THREE.Vector3(tentative.x, 1.0, tentative.z);
    game._resolveXZ(vec, 0.35);
    this.position.x = vec.x;
    this.position.z = vec.z;
    this.group.position.set(this.position.x, 0, this.position.z);
    this.group.rotation.y = this.yaw;

    // Stuck detection (if velocity nonzero but we're not moving)
    const planar = Math.hypot(this.velocity.x, this.velocity.z);
    if (planar > 0.5) {
      this.pathStuckT += dt;
      if (this.pathStuckT > 1.5) {
        // pick new random side step
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
    // Face movement
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

  _animate(dt) {
    this.walkT += dt * Math.hypot(this.velocity.x, this.velocity.z) * 1.8;
    const phase = this.walkT;
    const strike = Math.sin(phase);
    // Legs
    this._legL.group.rotation.x = Math.sin(phase) * 0.6;
    this._legR.group.rotation.x = -Math.sin(phase) * 0.6;
    this._legL.knee.rotation.x = Math.max(0, Math.sin(phase + Math.PI / 2)) * 0.8;
    this._legR.knee.rotation.x = Math.max(0, Math.sin(phase - Math.PI / 2)) * 0.8;
    // Arms (opposite to legs unless aiming/swinging)
    if (!this.usePickaxe && this.aimT > 0.05) {
      // Hold bow forward
      this._armL.group.rotation.x = -1.4;
      this._armL.group.rotation.y = 0.1;
      this._armL.elbow.rotation.x = 0.1;

      this._armR.group.rotation.x = -1.2 - this.aimT * 0.3;
      this._armR.group.rotation.y = -0.2;
      this._armR.elbow.rotation.x = -1.2 - this.aimT * 0.8;

      // Draw string
      this._bowString.position.x = 0.08 - this.aimT * 0.18;
    } else if (this.usePickaxe && this.meleeActive) {
      const t = this.meleeSwingT / this.meleeSwingDur;
      // windup -> strike -> recover
      const rx = -1.8 + Math.sin(t * Math.PI) * 2.4;
      this._armR.group.rotation.x = rx;
      this._armR.group.rotation.y = -0.4;
      this._armR.elbow.rotation.x = -0.6 - Math.sin(t * Math.PI) * 0.6;
      this._armL.group.rotation.x = -0.6;
      this._armL.elbow.rotation.x = -0.6;
    } else {
      const armSwing = -strike * 0.6;
      this._armL.group.rotation.x = -armSwing;
      this._armR.group.rotation.x = armSwing;
      this._armL.elbow.rotation.x = -0.25;
      this._armR.elbow.rotation.x = -0.25;
      this._bowString.position.x = 0.08;
    }

    // Idle breathing / spine sway
    const breath = Math.sin(performance.now() * 0.002 + this.id) * 0.02;
    this._pelvis.rotation.z = breath * 0.5;
    for (let i = 0; i < this._spine.length; i++) {
      this._spine[i].rotation.z = breath * (0.3 + i * 0.1);
    }
    this._head.rotation.y = Math.sin(performance.now() * 0.001 + this.id) * 0.15;

    // Eye flicker
    this._eyeLight.intensity = 0.45 + Math.sin(performance.now() * 0.012 + this.id) * 0.15;
  }

  _updateRagdoll(dt) {
    this.ragdollT += dt;
    // Collapse the whole body: rotate group around X by up to 90 deg + lean offset
    const t = clamp(this.ragdollT / 1.2, 0, 1);
    const ease = t * t * (3 - 2 * t);
    this.ragdollAngle = ease * (Math.PI / 2);
    // Keep feet near ground: as body rotates, shift origin slightly
    this.group.rotation.set(-this.ragdollAngle * 0.9, this.yaw, 0);
    this.group.position.set(
      this.position.x + this.ragdollLean.x * ease * 0.3,
      0,
      this.position.z + this.ragdollLean.z * ease * 0.3,
    );
    // Dim eyes
    this._eyeLight.intensity = Math.max(0, this._eyeLight.intensity - dt * 2);
    // Limbs flop
    const flop = ease * 0.6;
    this._armL.group.rotation.x = -1.2 * flop;
    this._armR.group.rotation.x = -1.0 * flop;
    this._legL.group.rotation.x = 0.4 * flop;
    this._legR.group.rotation.x = -0.4 * flop;
  }

  // Noise heard at `pos` with intensity (0..1)
  hearNoise(pos, intensity, game) {
    const d = this.position.distanceTo(pos);
    const maxRange = 22 * intensity + 6;
    if (d > maxRange) return;
    // Raise awareness; set last known
    this.awareness = Math.min(1, this.awareness + intensity * 0.7);
    this.lastKnownTarget = pos.clone();
    if (this.state === STATES.PATROL) {
      this.state = STATES.INVESTIGATE;
      this.stateT = 0;
      this.investigateUntil = 6;
    }
  }

  // Receive info from another skeleton via "radio"
  receiveAlert(pos) {
    if (!this.alive) return;
    this.awareness = Math.max(this.awareness, 0.6);
    this.lastKnownTarget = pos.clone();
    if (this.state === STATES.PATROL || this.state === STATES.ALERT) {
      this.state = STATES.INVESTIGATE; this.stateT = 0; this.investigateUntil = 6;
    }
  }
}
