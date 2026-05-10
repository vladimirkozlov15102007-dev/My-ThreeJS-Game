// Procedural PBR-ish canvas textures used as fallback detail when
// a prop is drawn with primitive geometry (roofs, ground, fence etc).
import * as THREE from 'three';
import { rand } from './utils.js';

const texCache = new Map();

function mkTex(key, w, h, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

export function concreteTex(repeat = 4) {
  const t = mkTex('concrete', 512, 512, (g, w, h) => {
    g.fillStyle = '#9a968b'; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 32;
      img.data[i]   = Math.max(0, Math.min(255, img.data[i]   + n));
      img.data[i+1] = Math.max(0, Math.min(255, img.data[i+1] + n));
      img.data[i+2] = Math.max(0, Math.min(255, img.data[i+2] + n));
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(0,0,0,0.38)';
    for (let i = 0; i < 28; i++) {
      g.lineWidth = Math.random() * 1.2 + 0.3;
      g.beginPath();
      let x = Math.random() * w, y = Math.random() * h;
      g.moveTo(x, y);
      for (let j = 0; j < 5; j++) {
        x += (Math.random() - 0.5) * 80;
        y += (Math.random() - 0.5) * 80;
        g.lineTo(x, y);
      }
      g.stroke();
    }
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
  const t = mkTex('rustyMetal', 512, 512, (g, w, h) => {
    g.fillStyle = '#4a4339'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) {
      g.strokeStyle = `rgba(0,0,0,${0.08 + Math.random() * 0.08})`;
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + (Math.random()-0.5)*2); g.stroke();
    }
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      const r = 10 + Math.random() * 60;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(150,70,24,${0.6 + Math.random() * 0.3})`);
      gr.addColorStop(0.6, 'rgba(120,46,16,0.35)');
      gr.addColorStop(1, 'rgba(120,46,16,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      g.fillStyle = '#1f1a15'; g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#5f5547'; g.beginPath(); g.arc(x-0.5, y-0.5, 1, 0, Math.PI * 2); g.fill();
    }
  });
  const tx = t.clone(); tx.needsUpdate = true;
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.repeat.set(repeat, repeat);
  return tx;
}

export function brickTex(repeat = 3) {
  const t = mkTex('brick', 512, 512, (g, w, h) => {
    g.fillStyle = '#3a322d'; g.fillRect(0, 0, w, h);
    const bw = 64, bh = 22, mortar = 2;
    for (let y = 0; y < h; y += bh) {
      const off = (Math.floor(y / bh) % 2) * (bw / 2);
      for (let x = -bw; x < w + bw; x += bw) {
        const bx = x + off + rand(-2, 2), by = y + rand(-1, 1);
        const c = 70 + Math.floor(Math.random() * 55);
        g.fillStyle = `rgb(${c+25},${c-5},${c-10})`;
        g.fillRect(bx + mortar, by + mortar, bw - mortar * 2, bh - mortar * 2);
        if (Math.random() < 0.2) {
          g.fillStyle = 'rgba(0,0,0,0.4)';
          g.fillRect(bx + Math.random() * bw, by + Math.random() * bh, 3, 3);
        }
      }
    }
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

export function floorTex(repeat = 6) {
  const t = mkTex('floor', 512, 512, (g, w, h) => {
    g.fillStyle = '#3a3833'; g.fillRect(0, 0, w, h);
    const ts = 64;
    for (let y = 0; y < h; y += ts) {
      for (let x = 0; x < w; x += ts) {
        const c = 60 + Math.floor(Math.random() * 40);
        g.fillStyle = `rgb(${c},${c},${c-3})`;
        g.fillRect(x + 1, y + 1, ts - 2, ts - 2);
      }
    }
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.4})`;
      g.fillRect(Math.random() * w, Math.random() * h, Math.random() * 60 + 6, Math.random() * 12 + 2);
    }
  });
  const tx = t.clone(); tx.needsUpdate = true;
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.repeat.set(repeat, repeat);
  return tx;
}

export function dirtTex(repeat = 12) {
  const t = mkTex('dirt', 512, 512, (g, w, h) => {
    g.fillStyle = '#46372a'; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 36;
      img.data[i]   = Math.max(0, Math.min(255, img.data[i]   + n));
      img.data[i+1] = Math.max(0, Math.min(255, img.data[i+1] + n * 0.8));
      img.data[i+2] = Math.max(0, Math.min(255, img.data[i+2] + n * 0.5));
    }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 150; i++) {
      g.strokeStyle = `rgba(${60 + Math.random()*40},${90 + Math.random()*50},${35 + Math.random()*25},0.8)`;
      g.lineWidth = 0.8;
      const x = Math.random() * w, y = Math.random() * h;
      for (let j = 0; j < 4; j++) {
        g.beginPath(); g.moveTo(x + j, y); g.lineTo(x + j + (Math.random()-0.5)*4, y - 3 - Math.random()*5); g.stroke();
      }
    }
    for (let i = 0; i < 70; i++) {
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
  const t = mkTex('bone', 256, 256, (g, w, h) => {
    g.fillStyle = '#d8ccb2'; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 28;
      img.data[i]   = Math.max(0, Math.min(255, img.data[i]   + n));
      img.data[i+1] = Math.max(0, Math.min(255, img.data[i+1] + n));
      img.data[i+2] = Math.max(0, Math.min(255, img.data[i+2] + n * 0.6));
    }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 50; i++) {
      g.fillStyle = `rgba(70,55,30,${Math.random() * 0.55})`;
      g.fillRect(Math.random() * w, Math.random() * h, Math.random() * 30 + 4, Math.random() * 6 + 1);
    }
    g.strokeStyle = 'rgba(30,20,10,0.75)'; g.lineWidth = 0.5;
    for (let i = 0; i < 50; i++) {
      g.beginPath();
      let x = Math.random() * w, y = Math.random() * h;
      g.moveTo(x, y);
      g.lineTo(x + (Math.random()-0.5)*22, y + (Math.random()-0.5)*22);
      g.stroke();
    }
  });
  const tx = t.clone(); tx.needsUpdate = true;
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  return tx;
}

// Material factories.
export function matConcrete(r = 4) {
  return new THREE.MeshStandardMaterial({ map: concreteTex(r), roughness: 0.92, metalness: 0.04, color: 0xffffff });
}
export function matMetal(r = 2) {
  return new THREE.MeshStandardMaterial({ map: rustyMetalTex(r), roughness: 0.62, metalness: 0.55, color: 0xffffff });
}
export function matBrick(r = 3) {
  return new THREE.MeshStandardMaterial({ map: brickTex(r), roughness: 0.95, metalness: 0.0, color: 0xffffff });
}
export function matFloor(r = 6) {
  return new THREE.MeshStandardMaterial({ map: floorTex(r), roughness: 0.82, metalness: 0.15, color: 0xffffff });
}
export function matDirt(r = 12) {
  return new THREE.MeshStandardMaterial({ map: dirtTex(r), roughness: 1.0, metalness: 0.0, color: 0xffffff });
}
export function matBone() {
  return new THREE.MeshStandardMaterial({ map: boneTex(), roughness: 0.85, metalness: 0.02, color: 0xcfc2a4 });
}
