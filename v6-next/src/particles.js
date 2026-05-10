// Lightweight particle system: small pooled meshes that arc + fade.
import * as THREE from 'three';
import { rand } from './utils.js';

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.active = [];

    this._sparkMat = new THREE.MeshBasicMaterial({ color: 0xffdc8a, transparent: true, opacity: 1 });
    this._bloodMat = new THREE.MeshBasicMaterial({ color: 0x990f0f, transparent: true, opacity: 1 });
    this._dustMat = new THREE.MeshBasicMaterial({ color: 0xc9bfa3, transparent: true, opacity: 0.5 });
    this._shellMat = new THREE.MeshStandardMaterial({ color: 0xc19148, metalness: 0.8, roughness: 0.35 });
    this._flashMat = new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 1 });

    this._sparkGeom = new THREE.SphereGeometry(0.03, 4, 4);
    this._bloodGeom = new THREE.SphereGeometry(0.04, 4, 4);
    this._dustGeom = new THREE.PlaneGeometry(0.22, 0.22);
    this._shellGeom = new THREE.CylinderGeometry(0.01, 0.01, 0.04, 6);

    this._motes = this._createMotes();
    scene.add(this._motes);
  }

  _createMotes() {
    const count = 500;
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 140;
      positions[i * 3 + 1] = 0.5 + Math.random() * 14;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 140;
    }
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xfff3c6, size: 0.055, sizeAttenuation: true, transparent: true, opacity: 0.6,
      depthWrite: false,
    });
    const pts = new THREE.Points(geom, mat);
    pts.userData.speeds = new Float32Array(count).map(() => 0.05 + Math.random() * 0.18);
    return pts;
  }

  _add(mesh, vel, life, fade = true, gravity = 9.0) {
    this.active.push({ mesh, vel, life, maxLife: life, fade, gravity });
    this.scene.add(mesh);
  }

  spawnImpact(point, normal) {
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(this._sparkGeom, this._sparkMat.clone());
      m.position.copy(point);
      const v = new THREE.Vector3(
        normal.x + (Math.random() - 0.5) * 0.9,
        normal.y + Math.random() * 0.8,
        normal.z + (Math.random() - 0.5) * 0.9,
      ).multiplyScalar(rand(2, 5));
      this._add(m, v, 0.3 + Math.random() * 0.2);
    }
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(this._dustGeom, this._dustMat.clone());
      m.position.copy(point);
      m.rotation.z = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(
        normal.x * 0.8 + (Math.random() - 0.5) * 0.6,
        normal.y * 0.8 + Math.random() * 0.6,
        normal.z * 0.8 + (Math.random() - 0.5) * 0.6,
      ).multiplyScalar(0.9);
      this._add(m, v, 0.7 + Math.random() * 0.3, true, 0.4);
    }
  }

  spawnBlood(point) {
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(this._bloodGeom, this._bloodMat.clone());
      m.position.copy(point);
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 3,
        Math.random() * 3,
        (Math.random() - 0.5) * 3,
      );
      this._add(m, v, 0.55 + Math.random() * 0.4);
    }
  }

  spawnDust(point, amt = 8) {
    for (let i = 0; i < amt; i++) {
      const m = new THREE.Mesh(this._dustGeom, this._dustMat.clone());
      m.position.copy(point);
      m.rotation.z = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 1.2,
        Math.random() * 1.2,
        (Math.random() - 0.5) * 1.2,
      );
      this._add(m, v, 0.8 + Math.random() * 0.5, true, 0.4);
    }
  }

  spawnMuzzleFlash(point, dir) {
    // Bright expanding quad flash + directional sparks.
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), this._flashMat.clone());
    m.position.copy(point).addScaledVector(dir, 0.15);
    m.lookAt(point.clone().addScaledVector(dir, -1));
    m.material.opacity = 1;
    this._add(m, new THREE.Vector3(), 0.06, true, 0);
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(this._sparkGeom, this._sparkMat.clone());
      s.position.copy(point);
      const v = dir.clone().multiplyScalar(6 + Math.random() * 4);
      v.x += (Math.random() - 0.5) * 2;
      v.y += (Math.random() - 0.5) * 1.5;
      v.z += (Math.random() - 0.5) * 2;
      this._add(s, v, 0.1 + Math.random() * 0.08, true, 4);
    }
  }

  spawnShell(camera, localOffset) {
    const m = new THREE.Mesh(this._shellGeom, this._shellMat);
    const worldPos = camera.localToWorld(localOffset.clone());
    m.position.copy(worldPos);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const v = right.clone().multiplyScalar(2 + Math.random()).add(up.clone().multiplyScalar(1.5));
    this._add(m, v, 0.9, false, 9);
  }

  update(dt, playerPos) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry?.dispose?.();
        if (p.mesh.material && p.mesh.material !== this._shellMat) p.mesh.material.dispose();
        this.active.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.pow(0.18, dt));
      if (p.fade) p.mesh.material.opacity = Math.max(0, p.life / p.maxLife);
    }
    // Dust motes drift.
    const pos = this._motes.geometry.attributes.position;
    const speeds = this._motes.userData.speeds;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setY(i, y + speeds[i] * dt * 0.25);
      if (pos.getY(i) > 15) pos.setY(i, 0.5);
      const x = pos.getX(i), z = pos.getZ(i);
      if (Math.abs(x - playerPos.x) > 70) pos.setX(i, playerPos.x + (Math.random() - 0.5) * 70);
      if (Math.abs(z - playerPos.z) > 70) pos.setZ(i, playerPos.z + (Math.random() - 0.5) * 70);
    }
    pos.needsUpdate = true;
  }
}
