// Arrow projectile system: gravity + line-segment hit vs player + AABB boxes.
import * as THREE from 'three';
import { raySegBoxHit } from './utils.js';

export class ArrowSystem {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.arrows = [];
    this.shaftMat = new THREE.MeshStandardMaterial({ color: 0x6d5a3e, roughness: 0.9 });
    this.tipMat = new THREE.MeshStandardMaterial({ color: 0x2a2a28, roughness: 0.35, metalness: 0.9 });
    this.fletchMat = new THREE.MeshStandardMaterial({ color: 0x5a2020, roughness: 1, side: THREE.DoubleSide });
  }

  spawn(from, vel, owner) {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.78, 6), this.shaftMat);
    shaft.rotation.x = Math.PI / 2;
    g.add(shaft);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.08, 6), this.tipMat);
    tip.rotation.x = Math.PI / 2;
    tip.position.z = -0.42;
    g.add(tip);
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.06), this.fletchMat);
      f.position.set(0, 0, 0.38);
      f.rotation.z = (i * Math.PI * 2) / 3;
      f.rotation.x = Math.PI / 2;
      g.add(f);
    }
    g.position.copy(from);
    g.castShadow = true;
    this.scene.add(g);
    this.arrows.push({ group: g, vel: vel.clone(), life: 4.0, stuck: false, owner });
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
      a.vel.y -= 10 * dt;
      const step = a.vel.clone().multiplyScalar(dt);
      const from = a.group.position.clone();
      const dir = step.clone();
      const dist = dir.length();
      if (dist < 1e-5) continue;
      dir.normalize();

      // Hit player
      if (game.player.hp > 0) {
        const pb = {
          min: new THREE.Vector3(
            game.player.position.x - 0.45,
            game.player.position.y - 1.75,
            game.player.position.z - 0.45,
          ),
          max: new THREE.Vector3(
            game.player.position.x + 0.45,
            game.player.position.y + 0.25,
            game.player.position.z + 0.45,
          ),
        };
        const t = raySegBoxHit(from.x, from.y, from.z, dir.x * dist, dir.y * dist, dir.z * dist, pb);
        if (t >= 0 && t <= 1) {
          const hy = from.y + dir.y * dist * t;
          const localY = hy - (game.player.position.y - 1.75);
          let zone = 'torso';
          if (localY > 1.55) zone = 'head';
          else if (localY < 0.55) zone = 'legs';
          const dmg = a.owner.arrowDamageByZone[zone] ?? 20;
          const fromDir = new THREE.Vector3().subVectors(game.player.position, from).normalize();
          game.player.takeDamage(dmg, fromDir);
          game.audio.arrowHit(game.player.position);
          this._remove(i);
          continue;
        }
      }

      // Hit world
      let tHit = 1.1;
      for (const b of game.colliders.boxes) {
        const t = raySegBoxHit(from.x, from.y, from.z, dir.x * dist, dir.y * dist, dir.z * dist, b);
        if (t >= 0 && t < tHit) tHit = t;
      }
      if (tHit <= 1) {
        const hp = new THREE.Vector3(
          from.x + dir.x * dist * tHit,
          from.y + dir.y * dist * tHit,
          from.z + dir.z * dist * tHit,
        );
        a.group.position.copy(hp);
        a.stuck = true;
        a.life = 12;
        game.audio.arrowHit(hp);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir.clone());
        a.group.quaternion.copy(q);
        continue;
      }
      a.group.position.add(step);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir.clone());
      a.group.quaternion.copy(q);
      if (a.life <= 0) this._remove(i);
    }
  }

  _remove(i) {
    const a = this.arrows[i];
    this.scene.remove(a.group);
    a.group.traverse(o => { if (o.geometry) o.geometry.dispose?.(); });
    this.arrows.splice(i, 1);
  }
}
