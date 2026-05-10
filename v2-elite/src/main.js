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
import { ArrowSystem, ThrowSystem } from './projectiles.js';
import { AudioEngine } from './audio.js';

// --- DOM refs ---
const el = (id) => document.getElementById(id);
const canvas = el('c');
const loadingEl = el('loading');
const loadingBar = el('loading-bar');
const loadingText = el('loading-text');
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

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;

// --- Scene ---
const scene = new THREE.Scene();
// Bright clear daytime sky
scene.background = new THREE.Color(0x8ec5ff);
// Very thin atmospheric haze so objects stay crisp
scene.fog = new THREE.FogExp2(0xbfd6ef, 0.0045);

// --- Camera ---
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 400);

// --- Lighting ---
// Strong warm sun -- lights the whole yard brilliantly,
// while interiors still read moodier because walls/roofs block direct light.
const sun = new THREE.DirectionalLight(0xfff1cf, 3.8);
sun.position.set(-60, 110, 70);
sun.castShadow = true;
sun.shadow.mapSize.width = 2048;
sun.shadow.mapSize.height = 2048;
sun.shadow.camera.left = -110;
sun.shadow.camera.right = 110;
sun.shadow.camera.top = 110;
sun.shadow.camera.bottom = -110;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 300;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun);
scene.add(sun.target);
// Keep a handle for the escape sequence (renamed from `moon` semantically)
const moon = sun;

// Sky hemi (warm sky above / earthy ground) — strong so interiors read bright
const hemi = new THREE.HemisphereLight(0xcfe2f5, 0xa28b62, 2.0);
scene.add(hemi);

// Ambient fill: big and warm so indoors is never dark
scene.add(new THREE.AmbientLight(0xe7dcc4, 1.2));

// Flickering interior fluorescents (placed later after level created)

// --- Postprocessing ---
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.9, 0.92);
composer.addPass(bloom);

// Custom cinematic pass: vignette + grain + chromatic aberration
const cinematicShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.6 },
    uGrain: { value: 0.02 },
    uCA: { value: 0.0008 },
    uDamage: { value: 0.0 },
  },
  vertexShader: /*glsl*/`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /*glsl*/`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uCA;
    uniform float uDamage;
    varying vec2 vUv;
    float rand(vec2 co){ return fract(sin(dot(co.xy,vec2(12.9898,78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec2 ctr = uv - 0.5;
      float ca = uCA * (0.6 + uDamage * 1.5);
      vec4 col;
      col.r = texture2D(tDiffuse, uv + ctr * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - ctr * ca).b;
      col.a = 1.0;

      // Very gentle vignette so daytime stays bright edge-to-edge
      float d = length(ctr);
      float v = smoothstep(1.15, 0.15, d * uVignette);
      col.rgb *= mix(0.9, 1.0, v);

      // Grain
      float n = rand(uv * vec2(1024.0, 768.0) + uTime) - 0.5;
      col.rgb += n * uGrain;

      // Damage: slight red tint + higher grain when damaged
      col.rgb = mix(col.rgb, col.rgb * vec3(1.1, 0.7, 0.7), uDamage * 0.4);

      gl_FragColor = col;
    }
  `,
};
const cinematicPass = new ShaderPass(cinematicShader);
composer.addPass(cinematicPass);

const fxaaPass = new ShaderPass(FXAAShader);
fxaaPass.material.uniforms['resolution'].value.set(1 / (window.innerWidth * renderer.getPixelRatio()), 1 / (window.innerHeight * renderer.getPixelRatio()));
composer.addPass(fxaaPass);

// --- Input / Audio ---
const input = new Input(canvas);
const audio = new AudioEngine();

// --- Particles ---
const particles = new Particles(scene);

// --- Build level ---
loadingText.textContent = 'Constructing factory geometry...';
loadingBar.style.width = '25%';

const lvl = buildLevel(scene);

// Add point lights in each zone for cinematic interior feel
const flickeringLights = [];
function addFlickerLight(x, y, z, color = 0xffd796, intensity = 1.2, dist = 14) {
  const light = new THREE.PointLight(color, intensity, dist, 2);
  light.position.set(x, y, z);
  scene.add(light);
  // Visual bulb
  const bulbMat = new THREE.MeshBasicMaterial({ color: color });
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), bulbMat);
  bulb.position.set(x, y, z);
  scene.add(bulb);
  flickeringLights.push({ light, bulb, baseIntensity: intensity, flicker: Math.random() });
}
// Admin corridor lights
for (let x = -38; x <= -12; x += 8) addFlickerLight(x, 3.5, 0, 0xfff1c4, 1.1, 12);
// Production: big shafts
addFlickerLight(-5, 11, 0, 0xffd796, 1.8, 32);
addFlickerLight(20, 11, 0, 0xb6d7ff, 1.5, 28);
addFlickerLight(35, 11, 10, 0xffd796, 1.3, 24);
addFlickerLight(5, 11, -18, 0xffa060, 1.1, 18);
// Warehouse
addFlickerLight(45, 7, -10, 0xffc779, 1.2, 16);
addFlickerLight(60, 7, 8, 0xffa550, 1.0, 14);
addFlickerLight(66, 7, -4, 0xcfddff, 0.7, 12);
// Tunnels (dim red emergency)
addFlickerLight(50, 2.5, 24, 0xff3322, 0.8, 11);
addFlickerLight(62, 2.5, 27, 0xff3322, 0.6, 11);

// Outdoor floodlight on pole (off during daytime)
const flood = new THREE.SpotLight(0xf4e2b8, 0.0, 80, Math.PI / 5, 0.5, 1);
flood.position.set(-8, 10, -60);
flood.target.position.set(20, 0, 0);
scene.add(flood);
scene.add(flood.target);

// --- Populate throwables ---
const throwSystem = new ThrowSystem(scene, null); // game ref set below

// --- Player ---
const player = new Player(camera);
player.position.set(-35, 1.7, 15); // in guard room
player.yaw = 0; // look south-east toward factory entrance

// --- Weapons ---
const weapons = new WeaponSystem(scene, camera, audio, particles);

// --- Arrows ---
const arrowSystem = new ArrowSystem(scene, null); // game ref set below

// --- Enemies ---
const enemies = [];
loadingText.textContent = 'Raising the dead...';
loadingBar.style.width = '55%';
// Normal skeletons — 10, at the zone-provided spawn points.
for (const sp of lvl.spawnPoints.slice(0, 10)) {
  enemies.push(new Skeleton(scene, sp));
}
// ELITE commanders — 10 extra red skeletons, spawned spread across the
// factory and yard. These patrol aggressively and engage on sight.
const eliteSpawns = [
  { x: -30, y: 0, z: 0 },    // admin corridor
  { x: -15, y: 0, z: 16 },   // admin east
  { x: 2,   y: 0, z: -6 },   // production west
  { x: 18,  y: 0, z: -12 },  // production center
  { x: 30,  y: 0, z: 18 },   // production south-east
  { x: 55,  y: 0, z: -14 },  // warehouse north
  { x: 65,  y: 0, z: 0 },    // warehouse center
  { x: 55,  y: 0, z: 24 },   // tunnels
  { x: 80,  y: 0, z: -12 },  // yard north
  { x: 88,  y: 0, z: 12 },   // yard south (near truck)
];
for (const sp of eliteSpawns) {
  enemies.push(new Skeleton(scene, sp, { elite: true }));
}

// --- Adaptive AI tracking ---
const adaptive = {
  sprintTicks: 0,
  crouchTicks: 0,
  hidingTicks: 0,
  shootsFromSamePosTicks: 0,
  lastShootPos: null,
  lastShootPosTime: 0,
  meleeKills: 0,
  rangedKills: 0,
  totalTicks: 0,
  update(dt, p) {
    this.totalTicks += 1;
    if (p.sprinting) this.sprintTicks += 1;
    if (p.crouching) this.crouchTicks += 1;
  },
  registerShotAt(pos) {
    if (this.lastShootPos && this.lastShootPos.distanceTo(pos) < 3) {
      this.shootsFromSamePosTicks += 1;
    }
    this.lastShootPos = pos.clone();
    this.lastShootPosTime = performance.now();
  },
  pushToEnemies(enemies) {
    // Normalize behaviors 0..1
    const t = Math.max(1, this.totalTicks);
    const crouchFrac = this.crouchTicks / t;
    const sprintFrac = this.sprintTicks / t;
    const campFrac = Math.min(1, this.shootsFromSamePosTicks / 40);
    for (const e of enemies) {
      e.preferFlank = Math.min(1, crouchFrac * 2 + campFrac * 1.2);
      e.preferSuppress = Math.min(1, campFrac * 1.4);
      e.preferDistance = sprintFrac > 0.2 ? 0.3 : 0; // if rushy, keep distance; if meleey, close in (we flip sign on close condition)
    }
  },
};

// --- Game state object passed to subsystems ---
const game = {
  scene, camera, renderer, composer, audio, particles,
  player, weapons, enemies,
  colliders: lvl.colliders,
  patrolPoints: lvl.patrolPoints,
  zones: lvl.zones,
  interactables: lvl.interactables,
  truck: lvl.truck,
  arrowSystem,
  throwSystem,
  adaptive,
  tension: 0,
  state: 'playing',   // playing | won | lost | escaping
  escape: { t: 0, active: false, startPos: new THREE.Vector3(), endPos: new THREE.Vector3() },

  spawnArrow(from, vel, owner) { this.arrowSystem.spawn(from, vel, owner); },

  // For skeleton-level XZ collision
  _resolveXZ(vec, radius) {
    resolveCircleVsBoxes(vec, radius, this.colliders.boxes);
  },

  // Generic raycast vs world + (optionally) enemies.
  // dir should be normalized.
  raycast(origin, dir, maxDist, { hitEnemies = false } = {}) {
    let bestT = 1.0;
    let bestHit = null;
    // World boxes
    for (const b of this.colliders.boxes) {
      const t = raySegBoxHit(origin.x, origin.y, origin.z, dir.x * maxDist, dir.y * maxDist, dir.z * maxDist, b);
      if (t >= 0 && t < bestT) {
        bestT = t;
        const pt = origin.clone().addScaledVector(dir, maxDist * t);
        bestHit = { point: pt, normal: new THREE.Vector3(-dir.x, -dir.y, -dir.z), enemy: null, zone: null, box: b };
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

  // Broadcast to all skeletons: player made noise at pos with intensity 0..1
  onWorldNoise(pos, intensity) {
    for (const e of this.enemies) e.hearNoise(pos, intensity, this);
  },
  onPlayerHitByArrow() {
    // mild shake handled already
  },
  playerShotFrom(pos) {
    // Skeletons react to gunshots acoustically
    this.adaptive.registerShotAt(pos);
    for (const e of this.enemies) e.hearNoise(pos, 1.0, this);
  },
};

// Wire cross-refs
arrowSystem.game = game;
throwSystem.game = game;

// Populate throwables now that game exists
throwSystem.populate(lvl.throwables);

// --- UI helpers ---
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

  // Objective switch
  if (aliveLeft === 0) {
    if (!game.truck.hasPower) objectiveText.innerHTML = 'All threats down. Restore factory power (admin guard room).';
    else if (!game.truck.hasKey) objectiveText.innerHTML = 'Find the key in the warehouse.';
    else if (!game.truck.running) objectiveText.innerHTML = 'Start the yellow truck (south yard).';
    else objectiveText.innerHTML = 'Escape!';
  } else {
    objectiveText.innerHTML = `Eliminate hostiles. Threats remaining: <b>${aliveLeft}</b>`;
  }

  // Compass — simple N/S/E/W heading
  const deg = ((player.yaw * 180 / Math.PI) % 360 + 360) % 360;
  const card = ['S', 'W', 'N', 'E'];
  const idx = Math.round(deg / 90) % 4;
  compass.textContent = `${card[idx]}  ${Math.round(deg).toString().padStart(3, '0')}°`;

  // Damage vignette intensity
  const dmgFrac = 1 - player.hp / player.maxHp;
  damageVignette.style.boxShadow = `inset 0 0 180px 60px rgba(161,20,20,${dmgFrac * 0.55})`;

  // Damage direction indicators
  for (const k of ['N','S','E','W']) damageDirs[k].style.opacity = 0;
  for (const d of player.damageIndicators) {
    const fwd = player.getForward(new THREE.Vector3());
    const right = player.getRight(new THREE.Vector3());
    const dirNorm = d.dir.clone().normalize();
    const f = fwd.dot(dirNorm); // - = in front, + = behind
    const r = right.dot(dirNorm);
    const alpha = clamp(d.t / 0.9, 0, 1);
    let key;
    if (Math.abs(f) > Math.abs(r)) key = f < 0 ? 'N' : 'S';
    else key = r > 0 ? 'E' : 'W';
    damageDirs[key].style.opacity = Math.max(parseFloat(damageDirs[key].style.opacity || '0'), alpha);
  }
}

// --- Interaction ---
function nearestInteractable() {
  let nearest = null, nd = Infinity;
  for (const it of game.interactables) {
    const d = player.position.distanceTo(it.position);
    if (d < it.radius && d < nd) {
      nd = d;
      nearest = it;
    }
  }
  return nearest;
}

function runInteraction(it) {
  if (it.kind === 'power') {
    if (!it.activated) {
      if (enemies.some(e => e.alive)) {
        setSubtitle("Something's watching... clear threats first.");
        return;
      }
      it.activated = true;
      it.lever.rotation.x = 0.5;
      game.truck.hasPower = true;
      game.truck.headlights.forEach(h => h.material.emissiveIntensity = 1.6);
      setSubtitle('Power restored. The factory hums back to life.', 4000);
      audio.bones(it.position);
    }
  } else if (it.kind === 'key') {
    if (!it.picked) {
      it.picked = true;
      scene.remove(it.keyGroup);
      game.truck.hasKey = true;
      setSubtitle('Key acquired.', 3000);
      audio.drop(it.position);
    }
  } else if (it.kind === 'truck') {
    const t = it.truck;
    if (!t.hasPower) { setSubtitle('No power. Find the factory breaker.'); return; }
    if (!t.hasKey) { setSubtitle('You need the ignition key.'); return; }
    if (!t.running) {
      t.running = true;
      audio.engine(t.position);
      setSubtitle('Engine turns over... it starts!', 4000);
      // Trigger escape after short delay
      setTimeout(() => {
        game.state = 'escaping';
        game.escape.active = true;
        game.escape.t = 0;
        game.escape.startPos.copy(player.position);
        game.escape.endPos.set(player.position.x + 150, player.position.y, player.position.z);
      }, 1800);
    }
  }
}

// --- Game loop ---
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

// Throwable charge state (LMB held while holding a throwable)
let throwChargeT = 0;

function loop() {
  const dt = Math.min(0.05, clock.getDelta());
  elapsed += dt;

  if (game.state === 'playing' || game.state === 'escaping') {
    // --- Player update ---
    const stepEvent = player.update(dt, input, game.colliders);

    // --- Footstep sound / enemy hearing ---
    if (stepEvent.step) {
      const zone = zoneAt(game.zones, player.position.x, player.position.z);
      const type = zone === 'tunnels' || zone === 'production' ? 'metal'
                 : zone === 'outdoor' ? 'dirt' : 'concrete';
      audio.step(player.position, type);
      // Running is louder -> enemies hear further
      const intensity = player.sprinting ? 0.7 : player.crouching ? 0.1 : 0.4;
      game.onWorldNoise(player.position, intensity);
    }

    // --- Weapons (only when not escaping) ---
    if (game.state === 'playing') {
      // If holding a throwable, LMB charges; release throws.
      if (throwSystem.held) {
        // Hide viewmodel weapon while holding
        weapons.pistolMesh.visible = false;
        weapons.swordMesh.visible = false;
        if (input.isMouseDown(0)) {
          throwChargeT = Math.min(1, throwChargeT + dt * 1.6);
          // Visual: push held slightly
          throwSystem.held.mesh.position.x = 0.3 + throwChargeT * 0.05;
          throwSystem.held.mesh.position.y = -0.3 + throwChargeT * 0.15;
        } else if (input.wasMouseReleased(0) && throwChargeT > 0.05) {
          throwSystem.throwHeld(player, throwChargeT);
          throwChargeT = 0;
          weapons.show(weapons.current); // re-show current weapon
        } else if (input.wasPressed('KeyQ')) {
          throwSystem.dropHeld(player);
          throwChargeT = 0;
          weapons.show(weapons.current);
        } else if (!input.isMouseDown(0) && throwChargeT > 0) {
          throwChargeT = Math.max(0, throwChargeT - dt * 2);
          throwSystem.held.mesh.position.x = 0.3;
          throwSystem.held.mesh.position.y = -0.3;
        }
      } else {
        // Normal weapons
        const beforePistolAmmo = weapons.pistolAmmoInMag;
        weapons.update(dt, input, player, enemies, game);
        if (weapons.current === 0 && weapons.pistolAmmoInMag < beforePistolAmmo) {
          // just fired => AI hears gunshot
          game.playerShotFrom(player.position);
        }
      }
    }

    // --- Interactables ---
    let interactLabel = '';
    const near = nearestInteractable();
    // Also consider throwables
    const pickable = !throwSystem.held ? throwSystem.findPickable(player) : null;
    if (near) {
      interactLabel = typeof near.label === 'function' ? near.label() : near.label;
    } else if (pickable) {
      interactLabel = `E: Pick up ${pickable.type}`;
    }
    if (interactLabel) {
      interactPrompt.classList.remove('hidden');
      interactPrompt.textContent = interactLabel;
    } else {
      interactPrompt.classList.add('hidden');
    }
    if (input.wasPressed('KeyE')) {
      if (near) runInteraction(near);
      else if (pickable) throwSystem.pickup(pickable, player);
    }

    // --- Enemies ---
    let combatEnemies = 0;
    let nearestDist = Infinity;
    for (const e of enemies) {
      e.update(dt, game);
      if (e.alive) {
        const d = e.position.distanceTo(player.position);
        if (d < nearestDist) nearestDist = d;
        if (e.state === 'combat' || e.state === 'flank') combatEnemies++;
      }
    }

    // Groups: dead skeletons auto-alert others
    // (done passively through lastKnownTarget propagation in awareness logic)
    // Proactive: if one is in combat, nudge awareness for nearby others
    for (const e of enemies) {
      if (!e.alive) continue;
      if (e.state === 'combat' || e.state === 'flank') {
        for (const o of enemies) {
          if (o === e || !o.alive) continue;
          if (o.position.distanceTo(e.position) < 20 && o.awareness < 0.4) {
            o.receiveAlert(e.lastKnownTarget || player.position);
          }
        }
      }
    }

    // Adaptive AI tick
    adaptive.update(dt, player);
    if (Math.random() < 0.02) adaptive.pushToEnemies(enemies);

    // --- Projectiles ---
    arrowSystem.update(dt);
    throwSystem.update(dt);

    // --- Particles ---
    particles.update(dt, player.position);

    // --- Tension + adaptive music ---
    const aliveCount = enemies.filter(e => e.alive).length;
    const targetTension = clamp(
      (nearestDist < 25 ? 1 - nearestDist / 25 : 0) * 0.7 +
      (combatEnemies > 0 ? 0.3 + Math.min(0.5, combatEnemies * 0.1) : 0) +
      (1 - player.hp / player.maxHp) * 0.3,
      0, 1,
    );
    game.tension = damp(game.tension, targetTension, 1.2, dt);
    audio.setTension(game.tension);

    // Cinematic shader updates
    cinematicPass.uniforms.uTime.value = elapsed;
    cinematicPass.uniforms.uDamage.value = damp(cinematicPass.uniforms.uDamage.value, 1 - player.hp / player.maxHp, 4, dt);

    // Flickering lights
    for (const f of flickeringLights) {
      f.flicker += dt * (6 + Math.sin(elapsed + f.flicker) * 2);
      const n = Math.sin(f.flicker * 4.31) * Math.sin(f.flicker * 7.11);
      const amp = (n > 0.7) ? 0.2 : (n > 0.4 ? 0.6 : 1.0);
      f.light.intensity = f.baseIntensity * amp;
      f.bulb.material.color.setHSL(0.1, 0.5, 0.4 + amp * 0.4);
    }

    // Audio listener update
    const fwd = player.getViewForward(new THREE.Vector3());
    audio.setListener(player.position, fwd);

    // --- Death check ---
    if (player.hp <= 0 && game.state === 'playing') {
      game.state = 'lost';
      setTimeout(() => { loseEl.classList.remove('hidden'); document.exitPointerLock?.(); }, 500);
    }

    // --- Escape sequence ---
    if (game.state === 'escaping') {
      game.escape.t += dt;
      const T = 7;
      const k = clamp(game.escape.t / T, 0, 1);
      // Move "player" with truck: teleport player onto truck seat & accelerate
      const start = game.escape.startPos;
      const end = game.escape.endPos;
      const ease = k * k;
      player.position.x = lerpNum(start.x, end.x, ease);
      player.position.z = lerpNum(start.z, end.z, ease);
      player.position.y = 2.2;
      // Drag truck along
      game.truck.group.position.x = player.position.x - 1.1;
      game.truck.group.position.z = player.position.z - 1.7;
      // Camera shake from engine
      player.shakeT = Math.min(0.5, player.shakeT + dt * 0.4);
      // Thicken fog
      scene.fog.density = 0.018 + k * 0.04;
      if (k >= 1) {
        game.state = 'won';
        winEl.classList.remove('hidden');
        document.exitPointerLock?.();
      }
    }

    // --- Chain sway ambient (small) ---
    lvl.root.traverse(o => {
      if (o.userData.sway) {
        o.userData.sway.a += dt * 2;
        o.rotation.z = Math.sin(o.userData.sway.a) * o.userData.sway.amp;
      }
    });
  }

  input.endFrame();
  updateHUD();
  composer.render(dt);
  requestAnimationFrame(loop);
}

function lerpNum(a, b, t) { return a + (b - a) * t; }

// --- Boot sequence ---
function finishLoading() {
  loadingBar.style.width = '100%';
  loadingText.textContent = 'Ready.';
  setTimeout(() => {
    loadingEl.classList.add('hidden');
    startEl.classList.remove('hidden');
  }, 300);
}
// Simulate progressive load for the user (everything is synchronous)
loadingBar.style.width = '80%';
setTimeout(() => { loadingBar.style.width = '95%'; loadingText.textContent = 'Priming audio...'; }, 150);
setTimeout(finishLoading, 450);

// Start button -> audio init + pointer lock
el('btn-start').addEventListener('click', () => {
  audio.init();
  audio.resume();
  startEl.classList.add('hidden');
  hudEl.classList.remove('hidden');
  input.requestLock();
  setSubtitle('The factory breathes. Kill them all. Then find the truck.', 5500);
});

// Pause when pointer lock lost (but not on win/lose)
document.addEventListener('pointerlockchange', () => {
  if (!input.pointerLocked && game.state === 'playing') {
    pauseEl.classList.remove('hidden');
  } else {
    pauseEl.classList.add('hidden');
  }
});
canvas.addEventListener('click', () => {
  if (!input.pointerLocked && game.state === 'playing') {
    input.requestLock();
  }
});
pauseEl.addEventListener('click', () => {
  if (!input.pointerLocked && game.state === 'playing') {
    input.requestLock();
  }
});

resize();
requestAnimationFrame(loop);
