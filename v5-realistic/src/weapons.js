// Pistol weapon system with STRONG recoil: pitch kick + yaw jitter + big
// viewmodel push-back, muzzle flash, shell ejection, FOV punch, camera shake.
import * as THREE from 'three';
import { damp } from './utils.js';

const PISTOL = {
  name: 'PISTOL',
  magSize: 12,
  magsTotal: 6,
  fireRate: 0.13,
  damage: { head: 30, torso: 20, legs: 10 },
  range: 100,
  reloadTime: 1.3,
  // Recoil tuning — noticeably strong, as user explicitly requested.
  recoilPitch: 0.14,      // pitch impulse (rad/s)
  recoilYaw: 0.055,       // yaw impulse (rad/s), random sign
  recoilKick: 0.22,       // viewmodel push-back impulse
  fovPunch: 6,            // degrees of FOV zoom-out on fire
  spreadHip: 0.025,
  spreadAim: 0.004,
};

export class WeaponSystem {
  constructor(scene, camera, audio, particles) {
    this.scene = scene;
    this.camera = camera;
    this.audio = audio;
    this.particles = particles;

    this.aim = 0;
    this.pistolAmmoInMag = PISTOL.magSize;
    this.pistolMagsLeft = PISTOL.magsTotal - 1;
    this.reloading = false;
    this.reloadT = 0;
    this.fireCooldown = 0;

    // Viewmodel recoil spring
    this.vmRecoil = 0;
    this.vmRecoilVel = 0;

    this.viewModel = new THREE.Group();
    camera.add(this.viewModel);
    scene.add(camera);

    this._buildPistol();
    this._pistolBase = new THREE.Vector3(0.32, -0.3, -0.58);
    this._pistolAim = new THREE.Vector3(0.0, -0.17, -0.42);
    this.pistolMesh.visible = true;
  }

  _buildPistol() {
    const g = new THREE.Group();
    const matBody = new THREE.MeshStandardMaterial({ color: 0x22221f, roughness: 0.45, metalness: 0.8 });
    const matGrip = new THREE.MeshStandardMaterial({ color: 0x2a1f16, roughness: 0.9 });
    const matAccent = new THREE.MeshStandardMaterial({ color: 0xc5ad7f, roughness: 0.35, metalness: 0.95 });

    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.09, 0.29), matBody);
    slide.position.set(0, 0, 0);
    g.add(slide);
    // Slide serrations
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(
        new THREE.BoxGeometry(0.097, 0.02, 0.01),
        new THREE.MeshStandardMaterial({ color: 0x0f0f0e, roughness: 0.6, metalness: 0.9 }),
      );
      s.position.set(0, 0.02, 0.06 + i * 0.02);
      g.add(s);
    }
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.12, 12), matAccent);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0, -0.2);
    g.add(barrel);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.17, 0.095), matGrip);
    grip.position.set(0, -0.125, 0.05);
    g.add(grip);
    // Checker detail
    for (let i = 0; i < 5; i++) {
      const k = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.012, 0.004),
        new THREE.MeshStandardMaterial({ color: 0x14100a, roughness: 1 }),
      );
      k.position.set(0, -0.07 - i * 0.025, 0.1);
      g.add(k);
    }
    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.04), matBody);
    trigger.position.set(0, -0.032, -0.002);
    g.add(trigger);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.018, 0.02), matBody);
    sight.position.set(0, 0.058, 0.1);
    g.add(sight);
    const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.018, 0.018), matAccent);
    frontSight.position.set(0, 0.058, -0.12);
    g.add(frontSight);

    // Hand hint
    const hand = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.2, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xb89878, roughness: 0.9 }),
    );
    hand.position.set(0, -0.25, 0.07);
    g.add(hand);

    // Muzzle flash
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0 });
    const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), flashMat);
    flash.position.set(0, 0, -0.29);
    g.add(flash);
    this._muzzleFlash = flash;

    const flashLight = new THREE.PointLight(0xffe6a0, 0, 7, 2);
    flash.add(flashLight);
    this._muzzleLight = flashLight;

    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    this.pistolMesh = g;
    this.viewModel.add(g);
  }

  startReload() {
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

  update(dt, input, player, enemies, game) {
    const wantAim = input.isMouseDown(2);
    this.aim = damp(this.aim, wantAim ? 1 : 0, 10, dt);
    player.aimT = this.aim;

    if (this.reloading) {
      this.reloadT += dt;
      if (this.reloadT >= PISTOL.reloadTime) this.finishReload();
    }
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);

    if (input.wasMousePressed(0)) {
      if (!this.reloading && this.pistolAmmoInMag > 0 && this.fireCooldown === 0) {
        this.fireCooldown = PISTOL.fireRate;
        this.pistolAmmoInMag -= 1;
        this._fire(player, enemies, game);
      } else if (this.pistolAmmoInMag === 0) {
        this.audio.emptyClick(this.camera.position);
        if (this.pistolMagsLeft > 0) this.startReload();
      }
    }
    if (input.wasPressed('KeyR')) this.startReload();

    this._updateViewmodel(dt, player);
  }

  _fire(player, enemies, game) {
    const cam = this.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const spread = this.aim > 0.85 ? PISTOL.spreadAim : PISTOL.spreadHip;
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.normalize();

    // STRONG recoil.
    const aimReduce = 1 - this.aim * 0.35;
    const pKick = PISTOL.recoilPitch * aimReduce * (0.9 + Math.random() * 0.3);
    const yKick = (Math.random() - 0.5) * 2 * PISTOL.recoilYaw * aimReduce;
    player.addRecoil(pKick, yKick);
    // Viewmodel slam.
    this.vmRecoilVel += PISTOL.recoilKick * aimReduce * (0.9 + Math.random() * 0.3);
    // FOV punch (animated in main via camera.fov adjust — main passes fn via game).
    if (game.fovPunch) game.fovPunch(PISTOL.fovPunch * aimReduce);

    // Muzzle flash visuals.
    this._muzzleFlash.material.opacity = 1.0;
    this._muzzleFlash.scale.setScalar(0.9 + Math.random() * 0.5);
    this._muzzleFlash.rotation.z = Math.random() * Math.PI * 2;
    this._muzzleLight.intensity = 5;
    // World-space muzzle flash particle at the barrel tip.
    const muzzleWorld = this._muzzleFlash.getWorldPosition(new THREE.Vector3());
    this.particles.spawnMuzzleFlash(muzzleWorld, dir.clone());

    this.audio.gunshot(origin);
    this.particles.spawnShell(this.camera, new THREE.Vector3(0.15, -0.05, -0.3));

    const hit = game.raycast(origin, dir, PISTOL.range, { hitEnemies: true });
    if (hit) {
      if (hit.enemy) {
        const dmg = PISTOL.damage[hit.zone] ?? 20;
        hit.enemy.takeDamage(dmg, origin, hit.point, hit.zone);
        this.particles.spawnBlood(hit.point);
      } else {
        this.particles.spawnImpact(hit.point, hit.normal);
      }
    }
  }

  _updateViewmodel(dt, player) {
    // Spring integration for viewmodel recoil.
    const K = 60, D = 11;
    this.vmRecoilVel += (-K * this.vmRecoil - D * this.vmRecoilVel) * dt;
    this.vmRecoil += this.vmRecoilVel * dt;

    const p = new THREE.Vector3().copy(this._pistolBase).lerp(this._pistolAim, this.aim);
    const bob = Math.sin(player.bobT * 2) * 0.01 * (1 - this.aim);
    const bobX = Math.cos(player.bobT) * 0.01 * (1 - this.aim);
    p.y += bob;
    p.x += bobX;
    p.z += this.vmRecoil * 0.28;    // push back strongly on fire
    p.y += this.vmRecoil * 0.07;    // tilt up a bit

    if (this.reloading) {
      const t = this.reloadT / PISTOL.reloadTime;
      const k = Math.sin(Math.PI * t) * 0.25;
      p.y -= k;
      this.pistolMesh.rotation.x = -k * 1.2;
      this.pistolMesh.rotation.z = Math.sin(t * Math.PI * 2) * 0.1;
    } else {
      const targetPitch = -player.recoilPitch * 0.75 - this.vmRecoil * 0.7;
      this.pistolMesh.rotation.x = damp(this.pistolMesh.rotation.x, targetPitch, 14, dt);
      this.pistolMesh.rotation.z = damp(this.pistolMesh.rotation.z, 0, 12, dt);
      this.pistolMesh.rotation.y = damp(this.pistolMesh.rotation.y, -player.recoilYaw * 0.45, 14, dt);
    }
    this.pistolMesh.position.copy(p);

    this._muzzleFlash.material.opacity *= Math.pow(0.00005, dt);
    if (this._muzzleFlash.material.opacity < 0.02) this._muzzleFlash.material.opacity = 0;
    this._muzzleLight.intensity *= Math.pow(0.00005, dt);
  }

  getHudInfo() {
    const total = this.pistolMagsLeft * PISTOL.magSize;
    return {
      name: this.reloading ? 'RELOADING...' : 'PISTOL',
      cur: this.pistolAmmoInMag,
      tot: total,
      hint: this.reloading ? '' : (this.pistolAmmoInMag === 0 ? 'R TO RELOAD' : ''),
    };
  }
}

export const WEAPON_CONSTS = { PISTOL };
