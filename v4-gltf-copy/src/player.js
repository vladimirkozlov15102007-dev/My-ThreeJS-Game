// First-person player controller with recoil-friendly camera handling.
import * as THREE from 'three';
import { clamp, damp, resolveCircleVsBoxes } from './utils.js';

export class Player {
  constructor(camera) {
    this.camera = camera;
    this.position = new THREE.Vector3(-35, 1.7, 15);
    this.velocity = new THREE.Vector3();
    this.radius = 0.45;
    this.height = 1.75;
    this.crouchHeight = 1.1;
    this.currentHeight = this.height;

    this.yaw = Math.PI * 0.25;
    this.pitch = 0.0;

    this.hp = 100;
    this.maxHp = 100;
    this.stamina = 100;
    this.maxStamina = 100;

    this.onGround = true;
    this.crouching = false;
    this.sprinting = false;
    this.moveSpeed = 0;

    this.bobT = 0;
    this.breathT = 0;
    this.aimT = 0;
    this.shakeT = 0;

    // Recoil is separated into two springs: pitchKick (view pushed up) and
    // yawKick (random left/right jitter) so weapon-fire feels weighty.
    this.recoilPitch = 0;    // target pitch offset
    this.recoilYaw = 0;      // target yaw offset
    this.recoilPitchVel = 0;
    this.recoilYawVel = 0;

    this._shake = new THREE.Vector3();
    this.damageIndicators = [];
    this.stepDist = 0;
  }

  get eyeHeight() { return this.crouching ? this.crouchHeight : this.height; }

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
    const cp = Math.cos(this.pitch + this.recoilPitch), sp = Math.sin(this.pitch + this.recoilPitch);
    const cy = Math.cos(this.yaw + this.recoilYaw), sy = Math.sin(this.yaw + this.recoilYaw);
    out.set(-sy * cp, sp, -cy * cp);
    return out;
  }

  // Add a recoil impulse on firing. pitchAmt pushes view up, yawAmt is
  // signed random horizontal kick.
  addRecoil(pitchAmt, yawAmt) {
    // Stack as positional impulses on a spring (actual integration in update).
    this.recoilPitchVel += pitchAmt;
    this.recoilYawVel += yawAmt;
    this.shakeT = Math.min(1.3, this.shakeT + 0.3);
  }

  takeDamage(amount, fromDir) {
    this.hp = Math.max(0, this.hp - amount);
    this.shakeT = Math.min(1.4, this.shakeT + amount * 0.02);
    const d = fromDir.clone(); d.y = 0; d.normalize();
    this.damageIndicators.push({ dir: d, t: 0.9 });
  }

  update(dt, input, colliders) {
    // Look
    if (input.pointerLocked) {
      const sens = 0.0022;
      this.yaw -= input.mouseDX * sens;
      this.pitch -= input.mouseDY * sens;
      this.pitch = clamp(this.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
    }

    // Movement intent
    const fwd = this.getForward(new THREE.Vector3());
    const right = this.getRight(new THREE.Vector3());
    let mx = 0, mz = 0;
    if (input.isDown('KeyW')) mz += 1;
    if (input.isDown('KeyS')) mz -= 1;
    if (input.isDown('KeyD')) mx += 1;
    if (input.isDown('KeyA')) mx -= 1;
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }

    this.crouching = input.isDown('ControlLeft') || input.isDown('ControlRight');
    const wantSprint = (input.isDown('ShiftLeft') || input.isDown('ShiftRight')) && mz > 0.2 && this.stamina > 5 && !this.crouching;
    this.sprinting = wantSprint;

    const baseSpeed = this.crouching ? 1.8 : this.sprinting ? 5.8 : 3.4;
    this.moveSpeed = baseSpeed;

    const desired = new THREE.Vector3()
      .addScaledVector(fwd, mz * baseSpeed)
      .addScaledVector(right, mx * baseSpeed);
    const accel = this.onGround ? 20 : 3;
    this.velocity.x = damp(this.velocity.x, desired.x, accel, dt);
    this.velocity.z = damp(this.velocity.z, desired.z, accel, dt);

    if (this.sprinting) this.stamina = Math.max(0, this.stamina - dt * 22);
    else this.stamina = Math.min(this.maxStamina, this.stamina + dt * (this.crouching ? 14 : 10));

    if (this.onGround && input.wasPressed('Space') && !this.crouching && this.stamina > 8) {
      this.velocity.y = 5.3;
      this.onGround = false;
      this.stamina -= 8;
    }

    this.velocity.y -= 16 * dt;
    if (this.velocity.y < -40) this.velocity.y = -40;

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.position.y += this.velocity.y * dt;
    if (this.position.y <= this.eyeHeight) {
      this.position.y = this.eyeHeight;
      this.velocity.y = 0;
      this.onGround = true;
    }
    if (this.position.x < -95) this.position.x = -95;
    if (this.position.x > 95) this.position.x = 95;
    if (this.position.z < -95) this.position.z = -95;
    if (this.position.z > 95) this.position.z = 95;
    resolveCircleVsBoxes(this.position, this.radius, colliders.boxes);

    // Footsteps
    const planar = Math.hypot(this.velocity.x, this.velocity.z);
    const stepEvent = { step: false };
    if (this.onGround && planar > 0.8) {
      this.stepDist += planar * dt;
      const stride = this.crouching ? 2.1 : this.sprinting ? 1.0 : 1.45;
      if (this.stepDist >= stride) { this.stepDist = 0; stepEvent.step = true; }
    } else {
      this.stepDist *= 0.9;
    }

    if (this.onGround && planar > 0.3) {
      this.bobT += dt * (this.sprinting ? 12 : 7);
    }
    this.breathT += dt * 1.2;

    for (const d of this.damageIndicators) d.t -= dt;
    this.damageIndicators = this.damageIndicators.filter(d => d.t > 0);

    this.currentHeight = damp(this.currentHeight, this.eyeHeight, 14, dt);

    // --- Recoil spring integration ---
    // Under-damped spring: feels like a weapon kick that drifts back to 0.
    const kickStiffness = 55;
    const kickDamping = 8;
    this.recoilPitchVel += (-kickStiffness * this.recoilPitch - kickDamping * this.recoilPitchVel) * dt;
    this.recoilPitch += this.recoilPitchVel * dt;
    this.recoilYawVel += (-kickStiffness * this.recoilYaw - kickDamping * this.recoilYawVel) * dt;
    this.recoilYaw += this.recoilYawVel * dt;

    // Camera shake
    this.shakeT = Math.max(0, this.shakeT - dt * 1.6);
    const sI = this.shakeT * 0.1;
    this._shake.set(
      (Math.random() - 0.5) * sI,
      (Math.random() - 0.5) * sI,
      (Math.random() - 0.5) * sI * 0.5,
    );

    // Head bob
    const bobY = Math.sin(this.bobT * 2) * (this.sprinting ? 0.05 : 0.032) * (1 - this.aimT * 0.6);
    const bobX = Math.cos(this.bobT) * (this.sprinting ? 0.038 : 0.022) * (1 - this.aimT * 0.7);
    const breath = Math.sin(this.breathT) * 0.012 * (1 - this.aimT * 0.6);

    this.camera.position.set(this.position.x, this.position.y + bobY * 0.6 + breath, this.position.z);
    this.camera.position.x += bobX * 0.6;
    this.camera.position.add(this._shake);

    const totalPitch = this.pitch + this.recoilPitch + bobY * 0.08;
    const totalYaw = this.yaw + this.recoilYaw + bobX * 0.04;
    const q = new THREE.Quaternion();
    q.setFromEuler(new THREE.Euler(totalPitch, totalYaw, 0, 'YXZ'));
    this.camera.quaternion.copy(q);

    return stepEvent;
  }
}
