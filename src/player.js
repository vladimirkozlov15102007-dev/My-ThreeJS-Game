import * as THREE from 'three';
import { clamp, damp, resolveCircleVsBoxes } from './utils.js';

export class Player {
  constructor(camera) {
    this.camera = camera;
    this.position = new THREE.Vector3(-35, 1.7, -15); // start in admin / guard room
    this.velocity = new THREE.Vector3();
    this.radius = 0.45;
    this.height = 1.75;
    this.crouchHeight = 1.1;
    this.currentHeight = this.height;

    this.yaw = Math.PI * 0.25;   // face roughly into the facility
    this.pitch = 0.0;

    this.hp = 100;
    this.maxHp = 100;
    this.stamina = 100;
    this.maxStamina = 100;

    this.onGround = true;
    this.crouching = false;
    this.sprinting = false;
    this.moveSpeed = 0;

    // Weapon sway / bob state
    this.bobT = 0;
    this.breathT = 0;
    this.aimT = 0;       // 0..1
    this.shakeT = 0;
    this.recoilKick = 0;    // pitch up from firing
    this.recoilYawKick = 0; // yaw jitter from firing

    // Camera shake impulses
    this._shake = new THREE.Vector3();

    // damage indicator queue (direction vectors in world space with timer)
    this.damageIndicators = [];

    // footstep accumulator
    this.stepDist = 0;
  }

  get eyeHeight() {
    return this.crouching ? this.crouchHeight : this.height;
  }

  getForward(out = new THREE.Vector3()) {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    out.set(-sy, 0, -cy);
    return out;
  }
  getRight(out = new THREE.Vector3()) {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    out.set(cy, 0, -sy);
    return out;
  }
  getViewForward(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    out.set(-sy * cp, sp, -cy * cp);
    return out;
  }

  takeDamage(amount, fromDir /* world-space direction from which damage came */) {
    this.hp = Math.max(0, this.hp - amount);
    this.shakeT = Math.min(1.2, this.shakeT + amount * 0.015);
    // store directional indicator: dir is direction FROM threat TO player normalized
    const d = fromDir.clone(); d.y = 0; d.normalize();
    this.damageIndicators.push({ dir: d, t: 0.9 });
  }

  update(dt, input, colliders) {
    // --- Look ---
    if (input.pointerLocked) {
      const sens = 0.0022;
      this.yaw -= input.mouseDX * sens;
      this.pitch -= input.mouseDY * sens;
      this.pitch = clamp(this.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
    }

    // --- Movement intent ---
    const fwd = this.getForward(new THREE.Vector3());
    const right = this.getRight(new THREE.Vector3());
    let mx = 0, mz = 0;
    if (input.isDown('KeyW')) mz += 1;
    if (input.isDown('KeyS')) mz -= 1;
    if (input.isDown('KeyD')) mx += 1;
    if (input.isDown('KeyA')) mx -= 1;
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }

    // crouch toggle on hold
    this.crouching = input.isDown('ControlLeft') || input.isDown('ControlRight');
    // sprint on shift when moving forward and have stamina
    const wantSprint = (input.isDown('ShiftLeft') || input.isDown('ShiftRight')) && mz > 0.2 && this.stamina > 5 && !this.crouching;
    this.sprinting = wantSprint;

    // --- Base speeds ---
    const baseSpeed = this.crouching ? 1.8 : this.sprinting ? 5.6 : 3.3;
    this.moveSpeed = baseSpeed;

    const desired = new THREE.Vector3()
      .addScaledVector(fwd, mz * baseSpeed)
      .addScaledVector(right, mx * baseSpeed);

    // smooth toward desired (ground accel)
    const accel = this.onGround ? 20 : 3;
    this.velocity.x = damp(this.velocity.x, desired.x, accel, dt);
    this.velocity.z = damp(this.velocity.z, desired.z, accel, dt);

    // stamina drain/regen
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - dt * 22);
    else this.stamina = Math.min(this.maxStamina, this.stamina + dt * (this.crouching ? 14 : 10));

    // jump
    if (this.onGround && input.wasPressed('Space') && !this.crouching && this.stamina > 8) {
      this.velocity.y = 5.2;
      this.onGround = false;
      this.stamina -= 8;
    }

    // gravity
    this.velocity.y -= 16 * dt;
    if (this.velocity.y < -40) this.velocity.y = -40;

    // integrate
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    // ground = y=0 (+eyeHeight)
    this.position.y += this.velocity.y * dt;
    if (this.position.y <= this.eyeHeight) {
      this.position.y = this.eyeHeight;
      this.velocity.y = 0;
      this.onGround = true;
    }

    // Keep within level bounds
    if (this.position.x < -95) this.position.x = -95;
    if (this.position.x > 95) this.position.x = 95;
    if (this.position.z < -95) this.position.z = -95;
    if (this.position.z > 95) this.position.z = 95;

    // Collision resolve
    resolveCircleVsBoxes(this.position, this.radius, colliders.boxes);

    // Footsteps trigger event via return (main.js plays sounds)
    const planar = Math.hypot(this.velocity.x, this.velocity.z);
    const stepEvent = { step: false };
    if (this.onGround && planar > 0.8) {
      this.stepDist += planar * dt;
      const stride = this.crouching ? 2.1 : this.sprinting ? 1.0 : 1.45;
      if (this.stepDist >= stride) {
        this.stepDist = 0;
        stepEvent.step = true;
      }
    } else {
      this.stepDist *= 0.9;
    }

    // Head bob + breath
    if (this.onGround && planar > 0.3) {
      this.bobT += dt * (this.sprinting ? 12 : 7);
    }
    this.breathT += dt * 1.2;

    // Damage indicator decay
    for (const d of this.damageIndicators) d.t -= dt;
    this.damageIndicators = this.damageIndicators.filter(d => d.t > 0);

    // Smooth height (for crouch)
    const targetH = this.eyeHeight;
    this.currentHeight = damp(this.currentHeight, targetH, 14, dt);

    // Aim state: maintained by weapon system via .aimT (main.js sets)

    // Camera pose
    const bobY = Math.sin(this.bobT * 2) * (this.sprinting ? 0.045 : 0.03) * (1 - this.aimT * 0.6);
    const bobX = Math.cos(this.bobT) * (this.sprinting ? 0.035 : 0.02) * (1 - this.aimT * 0.7);
    const breath = Math.sin(this.breathT) * 0.012 * (1 - this.aimT * 0.6);

    this.shakeT = Math.max(0, this.shakeT - dt * 1.6);
    const sIntensity = this.shakeT * 0.08;
    this._shake.set(
      (Math.random() - 0.5) * sIntensity,
      (Math.random() - 0.5) * sIntensity,
      (Math.random() - 0.5) * sIntensity * 0.5,
    );

    this.recoilKick = damp(this.recoilKick, 0, 8, dt);
    this.recoilYawKick = damp(this.recoilYawKick, 0, 10, dt);

    this.camera.position.set(this.position.x, this.position.y + bobY * 0.6 + breath, this.position.z);
    this.camera.position.x += bobX * 0.6;
    this.camera.position.add(this._shake);

    const totalPitch = this.pitch + bobY * 0.1 + this.recoilKick;
    const totalYaw = this.yaw + bobX * 0.05 + this.recoilYawKick;

    // Build rotation from yaw/pitch
    const q = new THREE.Quaternion();
    q.setFromEuler(new THREE.Euler(totalPitch, totalYaw, 0, 'YXZ'));
    this.camera.quaternion.copy(q);

    return stepEvent;
  }
}
