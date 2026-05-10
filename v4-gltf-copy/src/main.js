// Old Amber Factory — GLTF Edition.
// Vanilla Three.js + GLTFLoader + RGBELoader for HDRI environment.
// 20 hyper-aggressive skeleton archers, bright sunny daylight, pistol with
// strong recoil, 5-zone factory map, yellow-truck escape.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

import { clamp, damp, resolveCircleVsBoxes, raySegBoxHit } from './utils.js';
import { buildLevel, zoneAt } from './level.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { WeaponSystem } from './weapons.js';
import { Particles } from './particles.js';
import { Skeleton } from './skeleton.js';
import { ArrowSystem } from './projectiles.js';
import { AudioEngine } from './audio.js';
import { AssetLoader } from './assetLoader.js';

// ----- DOM -----
const el = (id) => document.getElementById(id);
const canvas = el('c');
const loadingEl = el('loading');
const loadingBar = el('loading-bar');
const loadingText = el('loading-text');
const loadingDetail = el('loading-detail');
const startEl = el('start');
const pauseEl = el('pause');
const winEl = el('win');
const loseEl = el('lose');
const hudEl = el('hud');

const hpBar = el('hp-bar');
const hpText = el('hp-text');
const stBar = el('st-bar');
const weaponName = el('weapon-name');
const ammoCur = el('ammo-cur');
const ammoTot = el('ammo-tot');
const hint = el('hint');
const enemiesLeftEl = el('enemies-left');
const objectiveText = el('objective-text');
const compass = el('compass');
const interactPrompt = el('interact-prompt');
const subtitleEl = el('subtitle');
const damageVignette = el('damage-vignette');
const damageDirs = {
  N: document.querySelector('#damage-dirs .dir[data-dir="N"]'),
  S: document.querySelector('#damage-dirs .dir[data-dir="S"]'),
  E: document.querySelector('#damage-dirs .dir[data-dir="E"]'),
  W: document.querySelector('#damage-dirs .dir[data-dir="W"]'),
};

// ----- Renderer -----
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

// ----- Scene -----
const scene = new THREE.Scene();
// Procedural bright-sky gradient background (in case HDR doesn't load).
scene.background = makeSkyTexture();
scene.fog = new THREE.FogExp2(0xcde4ff, 0.0035);

function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, '#5fa3e6');
  grad.addColorStop(0.5, '#9fd0f2');
  grad.addColorStop(1.0, '#e1ebd8');
  g.fillStyle = grad; g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ----- Camera -----
const BASE_FOV = 75;
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.05, 500);
let fovPunchAmt = 0; // degrees currently punched out by recoil

// ----- Lighting: bright sunny day -----
const sun = new THREE.DirectionalLight(0xfff4d6, 4.2);
sun.position.set(-50, 120, 80);
sun.castShadow = true;
sun.shadow.mapSize.width = 2048;
sun.shadow.mapSize.height = 2048;
sun.shadow.camera.left = -120;
sun.shadow.camera.right = 120;
sun.shadow.camera.top = 120;
sun.shadow.camera.bottom = -120;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 350;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun);
scene.add(sun.target);

// Sky hemi light — warm overhead, earthy under. Strong so interiors aren't dark.
const hemi = new THREE.HemisphereLight(0xb8d8f5, 0xbda075, 2.2);
scene.add(hemi);
// Ambient fill so shadows under indoor roofs still read.
scene.add(new THREE.AmbientLight(0xfaf3dc, 1.0));

// ----- Postprocessing -----
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.95, 0.9);
composer.addPass(bloom);

const cinematicShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uDamage: { value: 0 },
    uFlash: { value: 0 },
  },
  vertexShader: /*glsl*/`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /*glsl*/`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uDamage;
    uniform float uFlash;
    varying vec2 vUv;
    float rand(vec2 co){ return fract(sin(dot(co.xy,vec2(12.9898,78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec2 ctr = uv - 0.5;
      float ca = 0.0006 * (0.5 + uDamage * 1.6);
      vec4 col;
      col.r = texture2D(tDiffuse, uv + ctr * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - ctr * ca).b;
      col.a = 1.0;
      float d = length(ctr);
      float v = smoothstep(1.2, 0.18, d);
      col.rgb *= mix(0.92, 1.0, v);
      float n = rand(uv * vec2(1024.0, 768.0) + uTime) - 0.5;
      col.rgb += n * 0.015;
      col.rgb = mix(col.rgb, col.rgb * vec3(1.1, 0.65, 0.65), uDamage * 0.45);
      // muzzle-flash full-frame brighten
      col.rgb += vec3(1.0, 0.85, 0.55) * uFlash * 0.35;
      gl_FragColor = col;
    }
  `,
};
const cinematicPass = new ShaderPass(cinematicShader);
composer.addPass(cinematicPass);

const fxaaPass = new ShaderPass(FXAAShader);
fxaaPass.material.uniforms['resolution'].value.set(
  1 / (window.innerWidth * renderer.getPixelRatio()),
  1 / (window.innerHeight * renderer.getPixelRatio()),
);
composer.addPass(fxaaPass);

// ----- Input & Audio -----
const input = new Input(canvas);
const audio = new AudioEngine();

// ----- Loading screen orchestrator -----
const loader = new AssetLoader();
async function loadAssets() {
  loadingBar.style.width = '15%';
  loadingText.textContent = 'Fetching PBR sky + models...';
  try {
    const assets = await loader.loadAll((label, pct) => {
      loadingBar.style.width = `${15 + pct * 70}%`;
      loadingText.textContent = 'Loading ' + label + '...';
    });

    // Apply HDRI environment (used only for PBR reflections; background stays
    // the procedural sunny sky).
    if (assets.hdri) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envMap = pmrem.fromEquirectangular(assets.hdri).texture;
      scene.environment = envMap;
      assets.hdri.dispose?.();
      pmrem.dispose();
      loadingDetail.textContent = 'HDRI environment applied for PBR lighting.';
    } else {
      loadingDetail.textContent = 'Sky: procedural fallback (HDRI unavailable).';
    }
    return assets;
  } catch (err) {
    console.warn('Asset loading failed:', err);
    loadingDetail.textContent = 'Offline: using procedural assets.';
    return {};
  }
}

// ----- Level -----
loadingBar.style.width = '10%';
loadingText.textContent = 'Constructing factory geometry...';
const lvl = buildLevel(scene);

// ----- Player -----
const player = new Player(camera);
player.position.set(-35, 1.7, 15);
player.yaw = 0;

// ----- Weapons / Particles -----
const particles = new Particles(scene);
const weapons = new WeaponSystem(scene, camera, audio, particles);

// ----- Arrows -----
const arrowSystem = new ArrowSystem(scene, null);

// ----- Enemies: 20 hyper-aggressive skeleton archers -----
const enemies = [];
for (const sp of lvl.spawnPoints) {
  enemies.push(new Skeleton(scene, sp));
}

// ----- Game state object -----
const game = {
  scene, camera, renderer, composer, audio, particles,
  player, weapons, enemies,
  colliders: lvl.colliders,
  zones: lvl.zones,
  interactables: lvl.interactables,
  truck: lvl.truck,
  arrowSystem,
  tension: 0,
  state: 'loading',   // loading | playing | escaping | won | lost
  escape: { t: 0, active: false, startPos: new THREE.Vector3(), endPos: new THREE.Vector3() },

  spawnArrow(from, vel, owner) { this.arrowSystem.spawn(from, vel, owner); },

  _resolveXZ(vec, radius) {
    resolveCircleVsBoxes(vec, radius, this.colliders.boxes);
  },

  // FOV-punch callback (called by weapons on fire).
  fovPunch(deg) {
    fovPunchAmt = Math.max(fovPunchAmt, deg);
  },

  raycast(origin, dir, maxDist, { hitEnemies = false } = {}) {
    let bestT = 1.0;
    let bestHit = null;
    for (const b of this.colliders.boxes) {
      const t = raySegBoxHit(origin.x, origin.y, origin.z, dir.x * maxDist, dir.y * maxDist, dir.z * maxDist, b);
      if (t >= 0 && t < bestT) {
        bestT = t;
        const pt = origin.clone().addScaledVector(dir, maxDist * t);
        bestHit = { point: pt, normal: new THREE.Vector3(-dir.x, -dir.y, -dir.z), enemy: null, zone: null };
      }
    }
    if (hitEnemies) {
      for (const e of this.enemies) {
        const h = e.raycast(origin, dir, maxDist);
        if (h && h.t < bestT) {
          bestT = h.t;
          bestHit = { point: h.hitPoint, normal: new THREE.Vector3(-dir.x, -dir.y, -dir.z), enemy: e, zone: h.zone };
        }
      }
    }
    return bestHit;
  },
};
arrowSystem.game = game;

// ----- HUD helpers -----
function setSubtitle(text, ms = 3500) {
  subtitleEl.textContent = text;
  clearTimeout(setSubtitle._t);
  if (text) setSubtitle._t = setTimeout(() => { subtitleEl.textContent = ''; }, ms);
}

function updateHUD() {
  hpBar.style.width = `${(player.hp / player.maxHp) * 100}%`;
  hpText.textContent = Math.ceil(player.hp);
  stBar.style.width = `${(player.stamina / player.maxStamina) * 100}%`;

  const info = weapons.getHudInfo();
  weaponName.textContent = info.name;
  ammoCur.textContent = info.cur;
  ammoTot.textContent = info.tot;
  hint.textContent = info.hint;

  const aliveLeft = enemies.filter(e => e.alive).length;
  enemiesLeftEl.textContent = aliveLeft;
  if (aliveLeft === 0) {
    objectiveText.innerHTML = 'All hostiles down. Reach the yellow truck (south yard).';
  } else {
    objectiveText.innerHTML = `Kill all hostiles. Remaining: <b>${aliveLeft}</b>`;
  }

  const deg = ((player.yaw * 180 / Math.PI) % 360 + 360) % 360;
  const card = ['S', 'W', 'N', 'E'];
  const idx = Math.round(deg / 90) % 4;
  compass.textContent = `${card[idx]}  ${Math.round(deg).toString().padStart(3, '0')}°`;

  const dmgFrac = 1 - player.hp / player.maxHp;
  damageVignette.style.boxShadow = `inset 0 0 180px 60px rgba(188,29,29,${dmgFrac * 0.55})`;

  for (const k of ['N','S','E','W']) damageDirs[k].style.opacity = 0;
  for (const d of player.damageIndicators) {
    const fwd = player.getForward(new THREE.Vector3());
    const right = player.getRight(new THREE.Vector3());
    const dirNorm = d.dir.clone().normalize();
    const f = fwd.dot(dirNorm);
    const r = right.dot(dirNorm);
    const alpha = clamp(d.t / 0.9, 0, 1);
    let key;
    if (Math.abs(f) > Math.abs(r)) key = f < 0 ? 'N' : 'S';
    else key = r > 0 ? 'E' : 'W';
    damageDirs[key].style.opacity = Math.max(parseFloat(damageDirs[key].style.opacity || '0'), alpha);
  }
}

function nearestInteractable() {
  let nearest = null, nd = Infinity;
  for (const it of game.interactables) {
    const d = player.position.distanceTo(it.position);
    if (d < it.radius && d < nd) { nd = d; nearest = it; }
  }
  return nearest;
}

function runInteraction(it) {
  if (it.kind === 'truck') {
    const t = it.truck;
    const aliveLeft = enemies.filter(e => e.alive).length;
    if (aliveLeft > 0) {
      setSubtitle(`Not yet. ${aliveLeft} hostiles still stalk the factory.`, 3000);
      return;
    }
    if (!t.running) {
      t.running = true;
      audio.engine(t.position);
      setSubtitle('Engine fires up! The yard shrinks behind you...', 4000);
      setTimeout(() => {
        game.state = 'escaping';
        game.escape.active = true;
        game.escape.t = 0;
        game.escape.startPos.copy(player.position);
        game.escape.endPos.set(player.position.x + 180, player.position.y, player.position.z);
      }, 1500);
    }
  }
}

// ----- Game loop -----
const clock = new THREE.Clock();
let elapsed = 0;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const pr = renderer.getPixelRatio();
  fxaaPass.material.uniforms['resolution'].value.set(1 / (w * pr), 1 / (h * pr));
}
window.addEventListener('resize', resize);

function loop() {
  const dt = Math.min(0.05, clock.getDelta());
  elapsed += dt;

  if (game.state === 'playing' || game.state === 'escaping') {
    const stepEvent = player.update(dt, input, game.colliders);

    if (stepEvent.step) {
      const zone = zoneAt(game.zones, player.position.x, player.position.z);
      const type = zone === 'tunnels' || zone === 'production' ? 'metal'
                 : zone === 'outdoor' ? 'dirt' : 'concrete';
      audio.step(player.position, type);
    }

    if (game.state === 'playing') {
      weapons.update(dt, input, player, enemies, game);

      // Interactions
      let interactLabel = '';
      const near = nearestInteractable();
      if (near) interactLabel = typeof near.label === 'function' ? near.label() : near.label;
      if (interactLabel) {
        interactPrompt.classList.remove('hidden');
        interactPrompt.textContent = interactLabel;
      } else {
        interactPrompt.classList.add('hidden');
      }
      if (input.wasPressed('KeyE') && near) runInteraction(near);

      // Enemies
      let combatEnemies = 0;
      let nearestDist = Infinity;
      for (const e of enemies) {
        e.update(dt, game);
        if (e.alive) {
          const d = e.position.distanceTo(player.position);
          if (d < nearestDist) nearestDist = d;
          combatEnemies++;
        }
      }

      // Tension + music.
      const targetTension = clamp(
        (nearestDist < 25 ? 1 - nearestDist / 25 : 0) * 0.7 +
        (combatEnemies > 0 ? Math.min(0.5, combatEnemies * 0.04) : 0) +
        (1 - player.hp / player.maxHp) * 0.3,
        0, 1,
      );
      game.tension = damp(game.tension, targetTension, 1.2, dt);
      audio.setTension(game.tension);

      // Arrows
      arrowSystem.update(dt);
    }

    // Particles
    particles.update(dt, player.position);

    // FOV-punch decay
    fovPunchAmt = Math.max(0, fovPunchAmt - dt * 18);
    const aimFov = player.aimT * 15;  // ADS zooms in ~15 degrees
    camera.fov = BASE_FOV - aimFov + fovPunchAmt;
    camera.updateProjectionMatrix();

    // Cinematic shader updates
    cinematicPass.uniforms.uTime.value = elapsed;
    cinematicPass.uniforms.uDamage.value = damp(cinematicPass.uniforms.uDamage.value, 1 - player.hp / player.maxHp, 4, dt);
    cinematicPass.uniforms.uFlash.value = damp(cinematicPass.uniforms.uFlash.value, fovPunchAmt > 1 ? 0.9 : 0, 30, dt);

    // Chains sway
    scene.traverse(o => {
      if (o.userData.sway) {
        o.userData.sway.a += dt * 2;
        o.rotation.z = Math.sin(o.userData.sway.a) * o.userData.sway.amp;
      }
    });

    // Audio listener
    const vfwd = player.getViewForward(new THREE.Vector3());
    audio.setListener(player.position, vfwd);

    // Death
    if (player.hp <= 0 && game.state === 'playing') {
      game.state = 'lost';
      setTimeout(() => {
        loseEl.classList.remove('hidden');
        document.exitPointerLock?.();
      }, 600);
    }

    // Escape sequence: "drive" the player-truck out of the yard.
    if (game.state === 'escaping') {
      game.escape.t += dt;
      const T = 7;
      const k = clamp(game.escape.t / T, 0, 1);
      const start = game.escape.startPos;
      const end = game.escape.endPos;
      const ease = k * k;
      player.position.x = start.x + (end.x - start.x) * ease;
      player.position.z = start.z + (end.z - start.z) * ease;
      player.position.y = 2.3;
      game.truck.group.position.x = player.position.x - 1.1;
      game.truck.group.position.z = player.position.z - 1.7;
      player.shakeT = Math.min(0.5, player.shakeT + dt * 0.6);
      scene.fog.density = 0.0035 + k * 0.02;
      if (k >= 1) {
        game.state = 'won';
        winEl.classList.remove('hidden');
        document.exitPointerLock?.();
      }
    }
  }

  input.endFrame();
  updateHUD();
  composer.render(dt);
  requestAnimationFrame(loop);
}

// ----- Boot -----
(async function boot() {
  await loadAssets();
  loadingBar.style.width = '100%';
  loadingText.textContent = 'Ready.';
  setTimeout(() => {
    loadingEl.classList.add('hidden');
    startEl.classList.remove('hidden');
  }, 250);
})();

el('btn-start').addEventListener('click', () => {
  audio.init();
  audio.resume();
  startEl.classList.add('hidden');
  hudEl.classList.remove('hidden');
  input.requestLock();
  game.state = 'playing';
  setSubtitle('The dead are already drawing. Kill every last one.', 5000);
});

document.addEventListener('pointerlockchange', () => {
  if (!input.pointerLocked && game.state === 'playing') {
    pauseEl.classList.remove('hidden');
  } else {
    pauseEl.classList.add('hidden');
  }
});
canvas.addEventListener('click', () => {
  if (!input.pointerLocked && game.state === 'playing') input.requestLock();
});
pauseEl.addEventListener('click', () => {
  if (!input.pointerLocked && game.state === 'playing') input.requestLock();
});

resize();
requestAnimationFrame(loop);
