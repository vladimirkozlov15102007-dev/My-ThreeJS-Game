// Procedural textures using canvas + reusable shared materials.
import * as THREE from 'three';
import { rand } from './utils.js';

const texCache = new Map();

function makeCanvasTexture(key, w, h, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  texCache.set(key, t);
  return t;
}

export function concreteTex(repeat = 4) {
  const t = makeCanvasTexture('concrete', 512, 512, (g, w, h) => {
    // Base
    g.fillStyle = '#2b2d2c'; g.fillRect(0, 0, w, h);
    // Mottling
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 36;
      img.data[i]   = Math.max(0, Math.min(255, img.data[i]   + n));
      img.data[i+1] = Math.max(0, Math.min(255, img.data[i+1] + n));
      img.data[i+2] = Math.max(0, Math.min(255, img.data[i+2] + n));
    }
    g.putImageData(img, 0, 0);
    // Cracks
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    for (let i = 0; i < 28; i++) {
      g.lineWidth = Math.random() * 1.2 + 0.3;
      g.beginPath();
      let x = Math.random() * w, y = Math.random() * h;
      g.moveTo(x, y);
      const steps = 4 + Math.floor(Math.random() * 5);
      for (let j = 0; j < steps; j++) {
        x += (Math.random() - 0.5) * 80;
        y += (Math.random() - 0.5) * 80;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // Stains
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(20,15,10,${Math.random() * 0.25})`;
      g.beginPath();
      g.arc(Math.random() * w, Math.random() * h, Math.random() * 40 + 5, 0, Math.PI * 2);
      g.fill();
    }
    // Rust
    for (let i = 0; i < 14; i++) {
      const gr = g.createRadialGradient(Math.random()*w, Math.random()*h, 0, Math.random()*w, Math.random()*h, 60);
      gr.addColorStop(0, 'rgba(120,60,20,0.25)');
      gr.addColorStop(1, 'rgba(120,60,20,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }
  });
  const tx = t.clone(); tx.needsUpdate = true;
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.repeat.set(repeat, repeat);
  return tx;
}

export function rustyMetalTex(repeat = 2) {
  const t = makeCanvasTexture('rustyMetal', 512, 512, (g, w, h) => {
    g.fillStyle = '#3a352e'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) {
      g.strokeStyle = `rgba(0,0,0,${0.1 + Math.random() * 0.1})`;
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + (Math.random()-0.5)*2); g.stroke();
    }
    // rust patches
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      const r = 10 + Math.random() * 60;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(140,60,20,${0.6 + Math.random() * 0.3})`);
      gr.addColorStop(0.6, 'rgba(110,40,15,0.35)');
      gr.addColorStop(1, 'rgba(110,40,15,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    // rivets
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      g.fillStyle = '#1a1612'; g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#544a3d'; g.beginPath(); g.arc(x-0.5, y-0.5, 1, 0, Math.PI * 2); g.fill();
    }
  });
  const tx = t.clone(); tx.needsUpdate = true;
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.repeat.set(repeat, repeat);
  return tx;
}

export function brickTex(repeat = 3) {
  const t = makeCanvasTexture('brick', 512, 512, (g, w, h) => {
    g.fillStyle = '#2a2421'; g.fillRect(0, 0, w, h);
    const bw = 64, bh = 22, mortar = 2;
    for (let y = 0; y < h; y += bh) {
      const off = (Math.floor(y / bh) % 2) * (bw / 2);
      for (let x = -bw; x < w + bw; x += bw) {
        const bx = x + off + rand(-2, 2), by = y + rand(-1, 1);
        const c = 40 + Math.floor(Math.random() * 40);
        g.fillStyle = `rgb(${c+20},${c-5},${c-10})`;
        g.fillRect(bx + mortar, by + mortar, bw - mortar * 2, bh - mortar * 2);
        // chips
        if (Math.random() < 0.15) {
          g.fillStyle = 'rgba(0,0,0,0.4)';
          g.fillRect(bx + Math.random() * bw, by + Math.random() * bh, 3, 3);
        }
      }
    }
    // grime
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.3})`;
      g.beginPath(); g.arc(Math.random()*w, Math.random()*h, Math.random()*40+5, 0, Math.PI*2); g.fill();
    }
  });
  const tx = t.clone(); tx.needsUpdate = true;
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.repeat.set(repeat, repeat);
  return tx;
}

export function grungeFloorTex(repeat = 6) {
  const t = makeCanvasTexture('grungeFloor', 512, 512, (g, w, h) => {
    g.fillStyle = '#1a1a19'; g.fillRect(0, 0, w, h);
    // tiles
    const ts = 64;
    for (let y = 0; y < h; y += ts) {
      for (let x = 0; x < w; x += ts) {
        const c = 20 + Math.floor(Math.random() * 30);
        g.fillStyle = `rgb(${c},${c},${c-3})`;
        g.fillRect(x + 1, y + 1, ts - 2, ts - 2);
      }
    }
    // dirt streaks
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.45})`;
      g.fillRect(Math.random() * w, Math.random() * h, Math.random() * 60 + 6, Math.random() * 12 + 2);
    }
    // puddles
    for (let i = 0; i < 8; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 18 + Math.random() * 32;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(30,35,45,0.6)');
      gr.addColorStop(1, 'rgba(30,35,45,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI*2); g.fill();
    }
  });
  const tx = t.clone(); tx.needsUpdate = true;
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.repeat.set(repeat, repeat);
  return tx;
}

export function dirtGroundTex(repeat = 12) {
  const t = makeCanvasTexture('dirt', 512, 512, (g, w, h) => {
    g.fillStyle = '#262017'; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 40;
      img.data[i]   = Math.max(0, Math.min(255, img.data[i]   + n));
      img.data[i+1] = Math.max(0, Math.min(255, img.data[i+1] + n * 0.8));
      img.data[i+2] = Math.max(0, Math.min(255, img.data[i+2] + n * 0.5));
    }
    g.putImageData(img, 0, 0);
    // grass tufts
    for (let i = 0; i < 150; i++) {
      g.strokeStyle = `rgba(${40 + Math.random()*30},${60 + Math.random()*40},${25 + Math.random()*20},0.8)`;
      g.lineWidth = 0.8;
      const x = Math.random() * w, y = Math.random() * h;
      for (let j = 0; j < 4; j++) {
        g.beginPath(); g.moveTo(x + j, y); g.lineTo(x + j + (Math.random()-0.5)*4, y - 3 - Math.random()*5); g.stroke();
      }
    }
    // pebbles
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(20,18,14,${0.6 + Math.random()*0.3})`;
      g.beginPath(); g.arc(Math.random()*w, Math.random()*h, 1 + Math.random()*2, 0, Math.PI*2); g.fill();
    }
  });
  const tx = t.clone(); tx.needsUpdate = true;
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.repeat.set(repeat, repeat);
  return tx;
}

export function boneTex() {
  const t = makeCanvasTexture('bone', 256, 256, (g, w, h) => {
    g.fillStyle = '#cfc4a8'; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 28;
      img.data[i]   = Math.max(0, Math.min(255, img.data[i]   + n));
      img.data[i+1] = Math.max(0, Math.min(255, img.data[i+1] + n));
      img.data[i+2] = Math.max(0, Math.min(255, img.data[i+2] + n * 0.6));
    }
    g.putImageData(img, 0, 0);
    // dirt streaks
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(60,45,25,${Math.random() * 0.5})`;
      g.fillRect(Math.random() * w, Math.random() * h, Math.random() * 30 + 4, Math.random() * 6 + 1);
    }
    // microcracks
    g.strokeStyle = 'rgba(30,20,10,0.7)'; g.lineWidth = 0.5;
    for (let i = 0; i < 40; i++) {
      g.beginPath();
      let x = Math.random() * w, y = Math.random() * h;
      g.moveTo(x, y);
      g.lineTo(x + (Math.random()-0.5)*20, y + (Math.random()-0.5)*20);
      g.stroke();
    }
  });
  const tx = t.clone(); tx.needsUpdate = true;
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  return tx;
}

// Reusable material factory with PBR-ish params
export function matConcrete(repeat = 4) {
  const map = concreteTex(repeat);
  return new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0.03, color: 0xbbbbbb });
}
export function matMetal(repeat = 2) {
  const map = rustyMetalTex(repeat);
  return new THREE.MeshStandardMaterial({ map, roughness: 0.7, metalness: 0.55, color: 0x9a9186 });
}
export function matBrick(repeat = 3) {
  const map = brickTex(repeat);
  return new THREE.MeshStandardMaterial({ map, roughness: 1.0, metalness: 0.0, color: 0x8b857a });
}
export function matFloor(repeat = 6) {
  const map = grungeFloorTex(repeat);
  return new THREE.MeshStandardMaterial({ map, roughness: 0.82, metalness: 0.15, color: 0x9a948a });
}
export function matDirt(repeat = 12) {
  const map = dirtGroundTex(repeat);
  return new THREE.MeshStandardMaterial({ map, roughness: 1.0, metalness: 0.0, color: 0x8a8275 });
}
export function matBone() {
  const map = boneTex();
  return new THREE.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0.02, color: 0xd6cdb4 });
}
