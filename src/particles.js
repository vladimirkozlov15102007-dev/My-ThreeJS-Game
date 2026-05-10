import * as THREE from 'three';
import { rand } from './utils.js';

// Lightweight particle system: pools of small meshes that fly and fade.
export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.active = [];
    this.shells = []; // reused pool
    this._sparkMat = new THREE.MeshBasicMaterial({ color: 0xffdc8a, transparent: true, opacity: 1 });
    this._bloodMat = new THREE.MeshBasicMaterial({ color: 0x7a0e0e, transparent: true, opacity: 1 });
    this._dustMat = new THREE.MeshBasicMaterial({ color: 0xbdb39a, transparent: true, opacity: 0.5 });
    this._shellMat = new THREE.MeshStandardMaterial({ color: 0xc19148, metalness: 0.8, roughness: 0.35 });

    this._sparkGeom = new THREE.SphereGeometry(0.03, 4, 4);
    this._bloodGeom = new THREE.SphereGeometry(0.04, 4, 4);
    this._dustGeom = new THREE.PlaneGeometry(0.2, 0.2);
    this._shellGeom = new THREE.CylinderGeometry(0.01, 0.01, 0.04, 6);

    // Persistent dust motes for atmosphere
    this._motes = this._createMotes();
    scene.add(this._motes);
  }

  _createMotes() {
    const count = 400;
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 120;
      positions[i * 3 + 1] = 0.5 + Math.random() * 10;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 120;
    }
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xdcd3b8, size: 0.05, sizeAttenuation: true, transparent: true, opacity: 0.45,
      depthWrite: false,
    });
    const pts = new THREE.Points(geom, mat);
    pts.userData.speeds = new Float32Array(count).map(() => 0.05 + Math.random() * 0.15);
    return pts;
  }

  _add(mesh, vel, life, fade = true, gravity = 9.0) {
    this.active.push({ mesh, vel, life, maxLife: life, fade, gravity });
    this.scene.add(mesh);
  }

  spawnImpact(point, normal) {
    // sparks
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(this._sparkGeom, this._sparkMat.clone());
      m.position.copy(point);
      const v = new THREE.Vector3(
        normal.x + (Math.random() - 0.5) * 0.9,
        normal.y + Math.random() * 0.8,
        normal.z + (Math.random() - 0.5) * 0.9,
      ).multiplyScalar(rand(2, 5));
      this._add(m, v, 0.25 + Math.random() * 0.2);
    }
    // dust puff
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(this._dustGeom, this._dustMat.clone());
      m.position.copy(point);
      m.rotation.z = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(
        normal.x * 0.8 + (Math.random() - 0.5) * 0.6,
        normal.y * 0.8 + Math.random() * 0.6,
        normal.z * 0.8 + (Math.random() - 0.5) * 0.6,
      ).multiplyScalar(0.8);
      this._add(m, v, 0.6 + Math.random() * 0.3, true, 0.4);
    }
  }

  spawnBlood(point) {
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(this._bloodGeom, this._bloodMat.clone());
      m.position.copy(point);
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 3,
        Math.random() * 3,
        (Math.random() - 0.5) * 3,
      );
      this._add(m, v, 0.5 + Math.random() * 0.4);
    }
  }

  spawnDust(point, amt = 10) {
    for (let i = 0; i < amt; i++) {
      const m = new THREE.Mesh(this._dustGeom, this._dustMat.clone());
      m.position.copy(point);
      m.rotation.z = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 1.2,
        Math.random() * 1.2,
        (Math.random() - 0.5) * 1.2,
      );
      this._add(m, v, 0.8 + Math.random() * 0.5, true, 0.5);
    }
  }

  spawnShell(camera, localOffset) {
    const m = new THREE.Mesh(this._shellGeom, this._shellMat);
    const worldPos = camera.localToWorld(localOffset.clone());
    m.position.copy(worldPos);
    // Eject sideways and up
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
      // integrate
      p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.pow(0.18, dt)); // strong drag
      if (p.fade) {
        p.mesh.material.opacity = Math.max(0, p.life / p.maxLife);
      }
    }

    // Dust motes drift slowly
    const pos = this._motes.geometry.attributes.position;
    const speeds = this._motes.userData.speeds;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setY(i, y + speeds[i] * dt * 0.25);
      if (pos.getY(i) > 12) pos.setY(i, 0.5);
      // Keep near player for density
      const x = pos.getX(i), z = pos.getZ(i);
      if (Math.abs(x - playerPos.x) > 60) pos.setX(i, playerPos.x + (Math.random() - 0.5) * 60);
      if (Math.abs(z - playerPos.z) > 60) pos.setZ(i, playerPos.z + (Math.random() - 0.5) * 60);
    }
    pos.needsUpdate = true;
  }
}
