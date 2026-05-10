import * as THREE from 'three';
import { raySegBoxHit } from './utils.js';

// Simple arrows. Gravity + linear drag + box collisions + player hit.
export class ArrowSystem {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.arrows = [];
    this.arrowMat = new THREE.MeshStandardMaterial({ color: 0x6d5a3e, roughness: 0.9 });
    this.tipMat = new THREE.MeshStandardMaterial({ color: 0x2c2a26, roughness: 0.4, metalness: 0.8 });
  }

  spawn(from, vel, owner) {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.75, 6), this.arrowMat);
    shaft.rotation.x = Math.PI / 2;
    g.add(shaft);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.07, 6), this.tipMat);
    tip.rotation.x = Math.PI / 2;
    tip.position.z = -0.4;
    g.add(tip);
    // fletchings
    const fletchMat = new THREE.MeshStandardMaterial({ color: 0x5a5247, roughness: 1 });
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.05), fletchMat);
      f.position.set(0, 0, 0.36);
      f.rotation.z = (i * Math.PI * 2) / 3;
      f.rotation.x = Math.PI / 2;
      g.add(f);
    }
    g.position.copy(from);
    this.scene.add(g);
    this.arrows.push({ group: g, vel: vel.clone(), life: 4.0, stuck: false, owner, ownerIsSkel: true });
  }

  update(dt) {
    const game = this.game;
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.life -= dt;
      if (a.stuck) {
        if (a.life <= 0) this._remove(i);
        continue;
      }
      // gravity
      a.vel.y -= 10 * dt;
      const step = a.vel.clone().multiplyScalar(dt);
      const from = a.group.position.clone();
      const dir = step.clone();
      const dist = dir.length();
      if (dist < 1e-5) continue;
      dir.normalize();

      // Hit player?
      let hitPlayer = false;
      if (game.player.hp > 0) {
        const pb = {
          min: new THREE.Vector3(game.player.position.x - 0.45, game.player.position.y - 1.7, game.player.position.z - 0.45),
          max: new THREE.Vector3(game.player.position.x + 0.45, game.player.position.y + 0.2, game.player.position.z + 0.45),
        };
        const t = raySegBoxHit(from.x, from.y, from.z, dir.x * dist, dir.y * dist, dir.z * dist, pb);
        if (t >= 0 && t <= 1) {
          // compute zone by absolute Y of hit
          const hy = from.y + dir.y * dist * t;
          const localY = hy - (game.player.position.y - 1.7);
          let zone = 'torso';
          if (localY > 1.55) zone = 'head';
          else if (localY < 0.55) zone = 'legs';
          const dmg = a.owner.arrowDamageByZone[zone];
          const fromDir = new THREE.Vector3().subVectors(game.player.position, from).normalize();
          game.player.takeDamage(dmg, fromDir);
          game.audio.arrowHit(game.player.position);
          game.onPlayerHitByArrow?.();
          hitPlayer = true;
          this._remove(i);
          continue;
        }
      }

      // Hit world?
      let tHit = 1.1;
      for (const b of game.colliders.boxes) {
        const t = raySegBoxHit(from.x, from.y, from.z, dir.x * dist, dir.y * dist, dir.z * dist, b);
        if (t >= 0 && t < tHit) tHit = t;
      }
      if (tHit <= 1) {
        const hp = new THREE.Vector3(from.x + dir.x * dist * tHit, from.y + dir.y * dist * tHit, from.z + dir.z * dist * tHit);
        a.group.position.copy(hp);
        a.stuck = true;
        a.life = 12;
        game.audio.arrowHit(hp);
        // Orient arrow in its flight direction
        const up = new THREE.Vector3(0, 1, 0);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir.clone());
        a.group.quaternion.copy(q);
        continue;
      }

      // advance
      a.group.position.add(step);
      // orient
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir.clone());
      a.group.quaternion.copy(q);

      if (a.life <= 0) this._remove(i);
    }
  }

  _remove(i) {
    const a = this.arrows[i];
    this.scene.remove(a.group);
    a.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    this.arrows.splice(i, 1);
  }
}

// Throwables lying around + held object.
export class ThrowSystem {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.world = []; // { mesh, type, pos, pickable:true }
    this.inAir = []; // flying throwables
    this.held = null; // currently held { mesh, type }
    this.chargeT = 0;
  }

  populate(list) {
    for (const t of list) {
      const m = this._createMesh(t.type);
      m.position.set(t.x, t.y, t.z);
      m.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(m);
      this.world.push({ mesh: m, type: t.type, pickable: true });
    }
  }

  _createMesh(type) {
    let mesh;
    if (type === 'bottle') {
      const mat = new THREE.MeshStandardMaterial({ color: 0x224433, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.8 });
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.28, 10), mat);
    } else if (type === 'can') {
      const mat = new THREE.MeshStandardMaterial({ color: 0x8f7a4b, roughness: 0.4, metalness: 0.7 });
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 10), mat);
    } else if (type === 'pipe') {
      const mat = new THREE.MeshStandardMaterial({ color: 0x6a645b, roughness: 0.5, metalness: 0.7 });
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 10), mat);
      mesh.rotation.z = Math.PI / 2;
    } else { // brick
      const mat = new THREE.MeshStandardMaterial({ color: 0x7a3a2a, roughness: 1 });
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.14), mat);
    }
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
  }

  // Find nearby pickable throwable in front of player (within ~2m)
  findPickable(player) {
    const origin = player.camera.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(player.camera.quaternion);
    let best = null, bestScore = Infinity;
    for (const it of this.world) {
      if (!it.pickable) continue;
      const to = new THREE.Vector3().subVectors(it.mesh.position, origin);
      const d = to.length();
      if (d > 2.2) continue;
      const dot = to.clone().normalize().dot(fwd);
      if (dot < 0.5) continue;
      const score = d - dot;
      if (score < bestScore) { bestScore = score; best = it; }
    }
    return best;
  }

  pickup(item, player) {
    // Detach from world, attach to camera as held
    this.scene.remove(item.mesh);
    const mesh = item.mesh;
    player.camera.add(mesh);
    mesh.position.set(0.3, -0.3, -0.55);
    mesh.rotation.set(0, 0, 0);
    this.held = { mesh, type: item.type };
    this.world.splice(this.world.indexOf(item), 1);
  }

  dropHeld(player) {
    if (!this.held) return;
    const mesh = this.held.mesh;
    const pos = mesh.getWorldPosition(new THREE.Vector3());
    player.camera.remove(mesh);
    this.scene.add(mesh);
    mesh.position.copy(pos);
    this.inAir.push({ mesh, type: this.held.type, vel: new THREE.Vector3(0, 0, 0), life: 6, sound: true });
    this.held = null;
  }

  // Throw with a velocity based on charge time
  throwHeld(player, charge /*0..1*/) {
    if (!this.held) return;
    const mesh = this.held.mesh;
    const pos = mesh.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(player.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0);
    const speed = 5 + 12 * charge;
    const vel = fwd.multiplyScalar(speed).add(up.multiplyScalar(2.0 + 2 * charge));
    player.camera.remove(mesh);
    this.scene.add(mesh);
    mesh.position.copy(pos);
    this.inAir.push({ mesh, type: this.held.type, vel, life: 6, sound: true });
    this.held = null;
  }

  update(dt) {
    // Integrate airborne with simple collision (ground + boxes)
    const game = this.game;
    for (let i = this.inAir.length - 1; i >= 0; i--) {
      const it = this.inAir[i];
      it.life -= dt;
      it.vel.y -= 10 * dt;
      const step = it.vel.clone().multiplyScalar(dt);
      const from = it.mesh.position.clone();
      const dist = step.length();
      if (dist < 1e-5) { if (it.life <= 0) this._removeAir(i); continue; }
      const dir = step.clone().normalize();
      // Check boxes
      let tHit = 1.1, nHit = null;
      for (const b of game.colliders.boxes) {
        const t = raySegBoxHit(from.x, from.y, from.z, dir.x * dist, dir.y * dist, dir.z * dist, b);
        if (t >= 0 && t < tHit) {
          tHit = t;
          // crude normal: axis of smallest penetration would be ideal. We'll pick from direction.
          nHit = new THREE.Vector3(-dir.x, -dir.y, -dir.z);
        }
      }
      if (tHit <= 1) {
        it.mesh.position.set(from.x + dir.x * dist * tHit, from.y + dir.y * dist * tHit, from.z + dir.z * dist * tHit);
        if (it.sound) {
          game.audio.drop(it.mesh.position);
          game.onWorldNoise?.(it.mesh.position, 0.9);
          it.sound = false;
        }
        // bounce & absorb
        it.vel.multiplyScalar(0.35);
        it.vel.y *= -0.4;
        if (Math.abs(it.vel.y) < 0.5 && it.mesh.position.y < 0.2) {
          it.mesh.position.y = 0.1;
          it.vel.set(0, 0, 0);
        }
      } else {
        it.mesh.position.add(step);
      }
      it.mesh.rotation.x += dt * 6;
      it.mesh.rotation.z += dt * 4;

      if (it.mesh.position.y < 0.05 && it.vel.lengthSq() < 0.1) {
        // Settled on ground: convert back to pickable world item
        it.mesh.position.y = 0.1;
        this.world.push({ mesh: it.mesh, type: it.type, pickable: true });
        this.inAir.splice(i, 1);
        continue;
      }

      if (it.life <= 0) {
        // Leave it as pickable
        this.world.push({ mesh: it.mesh, type: it.type, pickable: true });
        this.inAir.splice(i, 1);
      }
    }
  }

  _removeAir(i) {
    const it = this.inAir[i];
    this.scene.remove(it.mesh);
    this.inAir.splice(i, 1);
  }
}
