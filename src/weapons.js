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
    this._pistolBase = new THREE.Vector3(0.22, -0.22, -0.45);
    this._pistolAim = new THREE.Vector3(0.0, -0.12, -0.32);
    this._swordBase = new THREE.Vector3(0.34, -0.32, -0.6);

    this.show(0);
  }

  // --- Build viewmodel meshes (detailed, realistic pistol) ---
  _buildPistol() {
    // Coordinates: +X = right, +Y = up, -Z = forward (out the muzzle).
    // We build the pistol so the grip sits near origin and the muzzle points to -Z.
    const g = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.45, metalness: 0.85 });
    const darkSteel = new THREE.MeshStandardMaterial({ color: 0x0e0f10, roughness: 0.55, metalness: 0.9 });
    const polymer = new THREE.MeshStandardMaterial({ color: 0x171715, roughness: 0.88, metalness: 0.05 });
    const gripTexture = new THREE.MeshStandardMaterial({ color: 0x0f0f0e, roughness: 1.0, metalness: 0.0 });
    const brassAccent = new THREE.MeshStandardMaterial({ color: 0x8a6a30, roughness: 0.4, metalness: 0.9 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9a78a, roughness: 0.88, metalness: 0.04 });

    // ===== Frame (lower receiver, polymer) =====
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.26), polymer);
    frame.position.set(0, -0.04, 0.0);
    g.add(frame);

    // Dust cover / rail under barrel (polymer, with a short Picatinny-like rail)
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.025, 0.09), polymer);
    rail.position.set(0, -0.05, -0.13);
    g.add(rail);
    // Rail slots
    for (let i = 0; i < 3; i++) {
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.004, 0.012), darkSteel);
      slot.position.set(0, -0.062, -0.10 - i * 0.028);
      g.add(slot);
    }

    // ===== Slide (upper, steel) =====
    // Main slide body
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.075, 0.30), steel);
    slide.position.set(0, 0.01, 0.0);
    g.add(slide);
    // Rounded front of slide (bevel)
    const slideFront = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.058, 0.025), darkSteel);
    slideFront.position.set(0, 0.005, -0.155);
    g.add(slideFront);
    // Rear slide serrations (vertical grooves for racking)
    const serrMat = darkSteel;
    for (let i = 0; i < 6; i++) {
      const serr = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.072, 0.003), serrMat);
      serr.position.set(0, 0.01, 0.10 + i * 0.012);
      g.add(serr);
    }
    // Front slide serrations
    for (let i = 0; i < 4; i++) {
      const serr = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.072, 0.003), serrMat);
      serr.position.set(0, 0.01, -0.08 - i * 0.012);
      g.add(serr);
    }

    // Ejection port (recessed cavity on the right side)
    const ejection = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.045, 0.065), darkSteel);
    ejection.position.set(0.044, 0.022, 0.02);
    g.add(ejection);
    // A brass case peeking through the port (flavour detail)
    const caseIn = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.025, 8), brassAccent);
    caseIn.rotation.x = Math.PI / 2;
    caseIn.position.set(0.04, 0.015, 0.01);
    g.add(caseIn);

    // ===== Barrel =====
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.16, 14), steel);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.005, -0.12);
    g.add(barrel);
    // Muzzle crown
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.012, 16), darkSteel);
    crown.rotation.x = Math.PI / 2;
    crown.position.set(0, 0.005, -0.195);
    g.add(crown);
    // Bore hole
    const bore = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 12),
      new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1 }));
    bore.rotation.x = Math.PI / 2;
    bore.position.set(0, 0.005, -0.202);
    g.add(bore);

    // ===== Sights =====
    // Rear sight (notched block)
    const rearL = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.014, 0.016), darkSteel);
    rearL.position.set(-0.022, 0.055, 0.125);
    g.add(rearL);
    const rearR = rearL.clone(); rearR.position.x = 0.022; g.add(rearR);
    // Front sight post
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.016, 0.01), darkSteel);
    front.position.set(0, 0.056, -0.14);
    g.add(front);
    // White dots (flavour)
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xcfcfcf });
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.003, 6, 6), dotMat);
    dot.position.set(0, 0.058, -0.135); g.add(dot);

    // ===== Trigger assembly =====
    // Trigger guard (built from two thin bars forming a ring)
    const guardBot = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.08), polymer);
    guardBot.position.set(0, -0.075, -0.005);
    g.add(guardBot);
    const guardFront = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.012), polymer);
    guardFront.position.set(0, -0.05, -0.038);
    g.add(guardFront);
    const guardRear = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.012), polymer);
    guardRear.position.set(0, -0.055, 0.028);
    g.add(guardRear);
    // Trigger (curved — approximated by tilted thin block)
    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.036, 0.012), darkSteel);
    trigger.position.set(0, -0.052, -0.008);
    trigger.rotation.x = -0.15;
    g.add(trigger);

    // ===== Grip (polymer with checkering) =====
    // Main grip panel, tilted slightly backward
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.17, 0.10), polymer);
    grip.position.set(0, -0.15, 0.055);
    grip.rotation.x = 0.12;
    g.add(grip);
    // Grip texture panels (darker inserts)
    const gripPanelL = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.14, 0.07), gripTexture);
    gripPanelL.position.set(-0.044, -0.15, 0.058);
    gripPanelL.rotation.x = 0.12;
    g.add(gripPanelL);
    const gripPanelR = gripPanelL.clone(); gripPanelR.position.x = 0.044; g.add(gripPanelR);
    // Checkering hint: horizontal ridges on front strap
    for (let i = 0; i < 8; i++) {
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.086, 0.004, 0.006), gripTexture);
      ridge.position.set(0, -0.085 - i * 0.016, 0.015 - i * 0.003);
      ridge.rotation.x = 0.12;
      g.add(ridge);
    }
    // Magazine baseplate protruding at the bottom
    const magBase = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.018, 0.10), darkSteel);
    magBase.position.set(0, -0.235, 0.055);
    magBase.rotation.x = 0.12;
    g.add(magBase);
    // Mag release button (small nub on left side)
    const magRelease = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.015, 0.012), darkSteel);
    magRelease.position.set(-0.045, -0.09, 0.022);
    g.add(magRelease);

    // ===== Hammer / back of slide (beavertail) =====
    const beaver = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.04, 0.03), polymer);
    beaver.position.set(0, -0.04, 0.135);
    g.add(beaver);

    // ===== Slide lock / safety lever (left side only) =====
    const slideLock = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.012, 0.04), darkSteel);
    slideLock.position.set(-0.045, -0.01, 0.04);
    g.add(slideLock);

    // ===== Hands =====
    // Right hand gripping the gun
    const handR = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.14, 0.09), skinMat);
    palm.position.set(0, 0, 0); handR.add(palm);
    // Fingers wrapping the grip (four small blocks at front)
    for (let i = 0; i < 4; i++) {
      const finger = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.022, 0.07), skinMat);
      finger.position.set(0.0, 0.04 - i * 0.028, -0.045);
      handR.add(finger);
    }
    // Thumb on the left side
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.06, 0.05), skinMat);
    thumb.position.set(-0.055, 0.025, 0.015);
    handR.add(thumb);
    // Wrist
    const wristR = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.12, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.9 }));
    wristR.position.set(0, -0.10, 0.08);
    handR.add(wristR);
    handR.position.set(0.0, -0.15, 0.075);
    handR.rotation.x = 0.12;
    g.add(handR);

    // Left hand supporting, cupped under the right
    const handL = new THREE.Group();
    const palmL = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.07, 0.09), skinMat);
    palmL.position.set(0, 0, 0); handL.add(palmL);
    for (let i = 0; i < 4; i++) {
      const finger = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.02, 0.06), skinMat);
      finger.position.set(0.055, -0.005 - i * 0.024, -0.02 + i * 0.01);
      handL.add(finger);
    }
    const thumbL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.022, 0.04), skinMat);
    thumbL.position.set(-0.02, 0.03, -0.01);
    handL.add(thumbL);
    const wristL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.10),
      new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.9 }));
    wristL.position.set(-0.05, -0.08, 0.055);
    handL.add(wristL);
    handL.position.set(-0.08, -0.18, 0.02);
    handL.rotation.y = 0.5;
    handL.rotation.x = 0.15;
    g.add(handL);

    // ===== Muzzle flash (lit when firing) =====
    // A 3D flash: central bright disc + cross blades for a real "star" flash
    const flashGroup = new THREE.Group();
    flashGroup.position.set(0, 0.005, -0.22);

    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd380, transparent: true, opacity: 0 });
    const flashDisc = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMat);
    flashDisc.rotation.z = Math.random() * Math.PI * 2;
    flashGroup.add(flashDisc);

    const bladeMat = new THREE.MeshBasicMaterial({ color: 0xffebaa, transparent: true, opacity: 0 });
    const blade1 = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.06), bladeMat);
    flashGroup.add(blade1);
    const blade2 = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.34), bladeMat);
    flashGroup.add(blade2);
    const blade3 = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.04), bladeMat);
    blade3.rotation.z = Math.PI / 4;
    flashGroup.add(blade3);
    const blade4 = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.04), bladeMat);
    blade4.rotation.z = -Math.PI / 4;
    flashGroup.add(blade4);

    g.add(flashGroup);
    this._muzzleFlash = flashGroup;
    this._muzzleFlashMats = [flashMat, bladeMat];

    // Point light attached to flash for scene illumination
    const flashLight = new THREE.PointLight(0xffd380, 0, 8, 2);
    flashGroup.add(flashLight);
    this._muzzleLight = flashLight;

    // ===== Smoke puff (animated when firing) =====
    const smokeMat = new THREE.MeshBasicMaterial({ color: 0xd8d0c4, transparent: true, opacity: 0 });
    const smoke = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), smokeMat);
    smoke.position.set(0, 0.01, -0.24);
    g.add(smoke);
    this._muzzleSmoke = smoke;
    this._muzzleSmokeMat = smokeMat;

    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });

    // Slide reference so we can animate the cycling on fire (slide moves back then forward)
    this._slideGroup = new THREE.Group();
    // Move the slide parts into a sub-group for cycling animation.
    // Simpler: mark slide + serrations + sight + ejection + casings for collective translation.
    // (We just animate a small z offset applied to the whole pistolMesh — that reads fine at FPS distance.)
    this._slideOffset = 0;

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

    // Muzzle flash + smoke
    for (const m of this._muzzleFlashMats) m.opacity = 1.0;
    this._muzzleFlash.scale.setScalar(0.9 + Math.random() * 0.4);
    this._muzzleFlash.rotation.z = Math.random() * Math.PI * 2;
    this._muzzleLight.intensity = 6;
    this._muzzleSmokeMat.opacity = 0.6;
    this._muzzleSmoke.scale.setScalar(0.8 + Math.random() * 0.3);
    // Trigger slide cycling animation (start at -1 so we push slide back)
    this._slideOffset = 0.018;

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
    // Apply slide offset (the whole pistol recoils back briefly; reads as slide-cycling at FPS distance)
    p.z += this._slideOffset;
    this.pistolMesh.position.copy(p);

    // Muzzle flash fade (multiple materials) + smoke expand/fade + slide cycle
    for (const m of this._muzzleFlashMats) {
      m.opacity *= Math.pow(0.00001, dt);
      if (m.opacity < 0.02) m.opacity = 0;
    }
    this._muzzleLight.intensity *= Math.pow(0.00005, dt);
    this._muzzleSmokeMat.opacity *= Math.pow(0.01, dt);
    this._muzzleSmoke.scale.multiplyScalar(1 + dt * 4);
    // Slide spring returns forward (over ~0.12s)
    this._slideOffset = damp(this._slideOffset, 0, 22, dt);

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
