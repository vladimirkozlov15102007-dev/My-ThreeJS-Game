import * as THREE from 'three';
import { clamp, damp, lerp, raySegBoxHit } from './utils.js';

// Weapon slots:
//  0 - pistol
//  1 - sword
//  2 - held throwable (hands)
// Switch key: Digit3 cycles pistol <-> sword (as requested). We also allow 1 & 2.

const PISTOL = {
  name: 'PISTOL',
  magSize: 12,
  magsTotal: 5,    // 5 magazines total => 60 rounds total including first mag
  fireRate: 0.14,  // seconds between shots
  damagePerHit: { head: 30, torso: 20, legs: 10 },
  range: 80,
  reloadTime: 1.3,
  recoilPitch: 0.085,   // pitch kick (up), radians per shot
  recoilYaw: 0.025,     // max yaw kick (left/right), radians per shot
  recoilKick: 0.12,     // viewmodel push-back amount (meters-ish in local space)
  spreadHip: 0.028,
  spreadAim: 0.006,
};

const SWORD = {
  name: 'SWORD',
  damage: 70,        // per successful swing (as requested)
  swingTime: 0.55,   // total anim time
  activeStart: 0.14, // when blade becomes damaging (s)
  activeEnd: 0.38,   // when it stops
  cooldown: 0.22,    // minimum time AFTER finishing a swing before a new one
  range: 2.1,        // reach
  arc: 1.25,         // half-cone angle (radians) around forward where enemy must be
};

export class WeaponSystem {
  constructor(scene, camera, audio, particles) {
    this.scene = scene;
    this.camera = camera;
    this.audio = audio;
    this.particles = particles;

    this.current = 0; // 0 pistol, 1 sword (we fit the spec: "3" cycles between them)
    this.aim = 0;     // 0..1

    // Ammo
    this.pistolAmmoInMag = PISTOL.magSize;
    this.pistolMagsLeft = PISTOL.magsTotal - 1; // first mag is already loaded
    this.reloading = false;
    this.reloadT = 0;
    this.fireCooldown = 0;

    // Sword swing state machine
    this.swordSwinging = false;
    this.swordSwingT = 0;
    this.swordHitThisSwing = false;
    this.swordCooldown = 0;

    // Viewmodel recoil spring (separate from camera pitch kick)
    this.vmRecoil = 0;      // 0..1 spring position
    this.vmRecoilVel = 0;   // velocity

    // Build weapon meshes on a viewmodel group (attached to camera)
    this.viewModel = new THREE.Group();
    this.viewModel.renderOrder = 10; // on top-ish
    camera.add(this.viewModel);
    scene.add(camera); // ensure camera is in scene

    this._buildPistol();
    this._buildSword();

    // Base & goal positions for weapons (viewmodel space)
    this._pistolBase = new THREE.Vector3(0.28, -0.28, -0.55);
    this._pistolAim = new THREE.Vector3(0.0, -0.16, -0.38);
    this._swordBase = new THREE.Vector3(0.34, -0.32, -0.6);

    this.show(0);
  }

  // --- Build viewmodel meshes (stylized but real-feeling) ---
  _buildPistol() {
    const g = new THREE.Group();
    const matBody = new THREE.MeshStandardMaterial({ color: 0x20201e, roughness: 0.55, metalness: 0.7 });
    const matGrip = new THREE.MeshStandardMaterial({ color: 0x2e221b, roughness: 0.9 });
    const matAccent = new THREE.MeshStandardMaterial({ color: 0x867053, roughness: 0.4, metalness: 0.9 });

    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.085, 0.28), matBody);
    slide.position.set(0, 0, 0);
    g.add(slide);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.1, 10), matAccent);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0, -0.19);
    g.add(barrel);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.09), matGrip);
    grip.position.set(0, -0.12, 0.05);
    g.add(grip);

    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.04), matBody);
    trigger.position.set(0, -0.03, 0.0);
    g.add(trigger);

    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, 0.02), matBody);
    sight.position.set(0, 0.055, 0.1);
    g.add(sight);

    // Hand (abstract)
    const hand = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.2, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xc2a58a, roughness: 0.9 }),
    );
    hand.position.set(0, -0.22, 0.07);
    g.add(hand);

    // Muzzle flash (disabled until firing)
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffc04a, transparent: true, opacity: 0 });
    const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMat);
    flash.position.set(0, 0, -0.27);
    flash.rotation.z = Math.random() * Math.PI * 2;
    g.add(flash);
    this._muzzleFlash = flash;

    // Light attached to flash
    const flashLight = new THREE.PointLight(0xffc04a, 0, 6, 2);
    flash.add(flashLight);
    this._muzzleLight = flashLight;

    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    this.pistolMesh = g;
    this.viewModel.add(g);
  }

  _buildSword() {
    const g = new THREE.Group();
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xcbccd0, roughness: 0.25, metalness: 0.95 });
    const guardMat = new THREE.MeshStandardMaterial({ color: 0x6a5434, roughness: 0.6, metalness: 0.4 });
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x2a1b10, roughness: 0.85 });

    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.85), bladeMat);
    blade.position.set(0, 0, -0.38);
    g.add(blade);

    // Tip taper
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.035, 0.12, 4),
      bladeMat,
    );
    tip.rotation.x = -Math.PI / 2;
    tip.position.set(0, 0, -0.86);
    g.add(tip);

    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.05), guardMat);
    guard.position.set(0, 0, 0.02);
    g.add(guard);

    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.18, 10), gripMat);
    grip.rotation.x = Math.PI / 2;
    grip.position.set(0, 0, 0.14);
    g.add(grip);

    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), guardMat);
    pommel.position.set(0, 0, 0.25);
    g.add(pommel);

    // Hand
    const hand = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.12),
      new THREE.MeshStandardMaterial({ color: 0xc2a58a, roughness: 0.9 }),
    );
    hand.position.set(0, -0.01, 0.15);
    g.add(hand);

    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    this.swordMesh = g;
    this.viewModel.add(g);
  }

  show(idx) {
    this.current = idx;
    this.pistolMesh.visible = (idx === 0);
    this.swordMesh.visible = (idx === 1);
    // cancel reload if switching
    if (this.reloading) { this.reloading = false; this.reloadT = 0; }
  }

  cycle() {
    this.show(this.current === 0 ? 1 : 0);
  }

  startReload() {
    if (this.current !== 0) return;
    if (this.reloading) return;
    if (this.pistolAmmoInMag === PISTOL.magSize) return;
    if (this.pistolMagsLeft <= 0) return;
    this.reloading = true;
    this.reloadT = 0;
    this.audio.reload(this.camera.position);
  }

  finishReload() {
    this.reloading = false;
    this.pistolAmmoInMag = PISTOL.magSize;
    this.pistolMagsLeft -= 1;
  }

  // --- Main update called by game loop. ---
  update(dt, input, player, enemies, game) {
    // Weapon switch: 3 cycles, also allow 1 and 2 explicitly.
    if (input.wasPressed('Digit3')) this.cycle();
    if (input.wasPressed('Digit1')) this.show(0);
    if (input.wasPressed('Digit2')) this.show(1);

    // Aim (RMB) only for pistol
    const wantAim = this.current === 0 && input.isMouseDown(2);
    this.aim = damp(this.aim, wantAim ? 1 : 0, 9, dt);
    player.aimT = this.aim;

    // Reload
    if (this.reloading) {
      this.reloadT += dt;
      if (this.reloadT >= PISTOL.reloadTime) this.finishReload();
    }

    // Fire cooldowns
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.swordCooldown = Math.max(0, this.swordCooldown - dt);

    // --- Pistol ---
    if (this.current === 0) {
      if (input.wasMousePressed(0)) {
        if (this.reloading) {
          // can't fire while reloading
        } else if (this.pistolAmmoInMag > 0 && this.fireCooldown === 0) {
          this.fireCooldown = PISTOL.fireRate;
          this.pistolAmmoInMag -= 1;
          this._firePistol(player, enemies, game);
        } else if (this.pistolAmmoInMag === 0) {
          this.audio.emptyClick(this.camera.position);
          // auto-start reload if possible
          if (this.pistolMagsLeft > 0) this.startReload();
        }
      }
      if (input.wasPressed('KeyR')) this.startReload();
    }

    // --- Sword ---
    if (this.current === 1) {
      if (input.wasMousePressed(0) && !this.swordSwinging && this.swordCooldown === 0) {
        this.swordSwinging = true;
        this.swordSwingT = 0;
        this.swordHitThisSwing = false;
        this.audio.swoosh(this.camera.position);
      }
      if (this.swordSwinging) {
        this.swordSwingT += dt;
        // Damage window
        if (!this.swordHitThisSwing &&
            this.swordSwingT >= SWORD.activeStart &&
            this.swordSwingT <= SWORD.activeEnd) {
          this._trySwordHit(player, enemies, game);
        }
        if (this.swordSwingT >= SWORD.swingTime) {
          this.swordSwinging = false;
          this.swordCooldown = SWORD.cooldown;
        }
      }
    }

    // --- Viewmodel positioning / animation ---
    this._updateViewmodel(dt, player);
  }

  _firePistol(player, enemies, game) {
    // Aim ray from camera
    const cam = this.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const spread = (this.aim > 0.85 ? PISTOL.spreadAim : PISTOL.spreadHip);
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.normalize();

    // Recoil kick — camera pitch up, camera yaw random, and a big viewmodel spring.
    // Aiming reduces recoil a bit but still very noticeable.
    const aimReduce = (1 - this.aim * 0.35);
    const pitchKick = PISTOL.recoilPitch * aimReduce * (0.9 + Math.random() * 0.25);
    const yawKick = (Math.random() - 0.5) * 2 * PISTOL.recoilYaw * aimReduce;
    player.recoilKick += pitchKick;
    player.recoilYawKick += yawKick;
    player.shakeT = Math.min(1.2, player.shakeT + 0.28);
    // Viewmodel spring: shove it backward and up
    this.vmRecoilVel += PISTOL.recoilKick * aimReduce * (0.85 + Math.random() * 0.3);

    // Muzzle flash
    this._muzzleFlash.material.opacity = 1.0;
    this._muzzleFlash.scale.setScalar(0.8 + Math.random() * 0.4);
    this._muzzleLight.intensity = 4;

    // Sound
    this.audio.gunshot(origin);

    // Shell eject particle (side-right of gun)
    this.particles.spawnShell(this.camera, new THREE.Vector3(0.15, -0.05, -0.3));

    // Compute hit vs enemies + world
    const hit = game.raycast(origin, dir, PISTOL.range, { hitEnemies: true });
    if (hit) {
      if (hit.enemy) {
        const dmg = PISTOL.damagePerHit[hit.zone] ?? 20;
        hit.enemy.takeDamage(dmg, origin, hit.point, hit.zone);
        this.particles.spawnBlood(hit.point);
      } else {
        this.particles.spawnImpact(hit.point, hit.normal);
      }
    }
  }

  _trySwordHit(player, enemies, game) {
    const cam = this.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);

    // Find nearest enemy within range & arc
    let best = null; let bestD = SWORD.range + 0.01;
    for (const e of enemies) {
      if (!e.alive) continue;
      const to = new THREE.Vector3().subVectors(e.position, origin);
      const d = to.length();
      if (d > SWORD.range) continue;
      to.normalize();
      const dot = to.dot(fwd);
      const ang = Math.acos(clamp(dot, -1, 1));
      if (ang > SWORD.arc) continue;
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) {
      this.swordHitThisSwing = true;
      // Choose hit zone based on vertical diff to enemy's eye center
      const dy = (best.position.y + 1.4) - origin.y;
      let zone = 'torso';
      if (dy > 0.15) zone = 'head';
      else if (dy < -0.4) zone = 'legs';
      best.takeDamage(SWORD.damage, origin, best.position.clone().setY(origin.y), zone);
      this.particles.spawnBlood(best.position.clone().setY(origin.y));
      this.audio.hitFlesh(best.position);
      player.shakeT = Math.min(0.8, player.shakeT + 0.2);
    }
  }

  _updateViewmodel(dt, player) {
    // Integrate viewmodel recoil spring (critically-damped-ish)
    const springK = 60;   // stiffness
    const damping = 11;   // damping
    const springAcc = -springK * this.vmRecoil - damping * this.vmRecoilVel;
    this.vmRecoilVel += springAcc * dt;
    this.vmRecoil += this.vmRecoilVel * dt;

    // Pistol pose: lerp between hip and aim
    const p = new THREE.Vector3().copy(this._pistolBase).lerp(this._pistolAim, this.aim);
    // Bob
    const bob = Math.sin(player.bobT * 2) * 0.01 * (1 - this.aim);
    const bobX = Math.cos(player.bobT) * 0.01 * (1 - this.aim);
    p.y += bob;
    p.x += bobX;
    // Apply recoil spring: push pistol back (+Z in local camera space), up a bit,
    // tilt up by recoil amount
    p.z += this.vmRecoil * 0.22;
    p.y += this.vmRecoil * 0.05;
    // Reload kick down
    if (this.reloading) {
      const t = this.reloadT / PISTOL.reloadTime;
      const k = Math.sin(Math.PI * t) * 0.22;
      p.y -= k;
      this.pistolMesh.rotation.x = -k * 1.2;
      this.pistolMesh.rotation.z = Math.sin(t * Math.PI * 2) * 0.08;
    } else {
      const targetPitch = -player.recoilKick * 0.8 - this.vmRecoil * 0.6;
      this.pistolMesh.rotation.x = damp(this.pistolMesh.rotation.x, targetPitch, 14, dt);
      this.pistolMesh.rotation.z = damp(this.pistolMesh.rotation.z, 0, 12, dt);
      this.pistolMesh.rotation.y = damp(this.pistolMesh.rotation.y, -player.recoilYawKick * 0.4, 14, dt);
    }
    this.pistolMesh.position.copy(p);

    // Muzzle flash fade
    this._muzzleFlash.material.opacity *= Math.pow(0.0001, dt);
    if (this._muzzleFlash.material.opacity < 0.02) this._muzzleFlash.material.opacity = 0;
    this._muzzleLight.intensity *= Math.pow(0.00005, dt);

    // Sword pose + swing
    const base = this._swordBase;
    let rx = -0.2, ry = 0.2, rz = -0.1;
    if (this.swordSwinging) {
      const t = this.swordSwingT / SWORD.swingTime;
      // Windup -> slash -> recover (ease curve)
      const windup = clamp(t / 0.2, 0, 1);
      const slash = clamp((t - 0.2) / 0.4, 0, 1);
      const recover = clamp((t - 0.6) / 0.4, 0, 1);
      rx = -0.2 - windup * 1.2 + slash * 2.2 - recover * 0.8;
      ry = 0.2 + windup * 0.4 - slash * 1.0 + recover * 0.4;
      rz = -0.1 - slash * 0.5;
    }
    this.swordMesh.rotation.set(
      damp(this.swordMesh.rotation.x, rx, 18, dt),
      damp(this.swordMesh.rotation.y, ry, 18, dt),
      damp(this.swordMesh.rotation.z, rz, 18, dt),
    );
    const sp = new THREE.Vector3().copy(base);
    sp.y += Math.sin(player.bobT * 2) * 0.012;
    sp.x += Math.cos(player.bobT) * 0.012;
    this.swordMesh.position.copy(sp);
  }

  // HUD info
  getHudInfo() {
    if (this.current === 0) {
      const total = this.pistolMagsLeft * PISTOL.magSize;
      return {
        name: this.reloading ? 'RELOADING...' : 'PISTOL',
        cur: this.pistolAmmoInMag,
        tot: total,
        hint: this.reloading ? '' : (this.pistolAmmoInMag === 0 ? 'R TO RELOAD' : ''),
      };
    } else {
      return {
        name: 'SWORD',
        cur: '',
        tot: '',
        hint: this.swordCooldown > 0 ? '' : 'LMB TO SWING',
      };
    }
  }
}

// Export for external damage model tests
export const WEAPON_CONSTS = { PISTOL, SWORD };
