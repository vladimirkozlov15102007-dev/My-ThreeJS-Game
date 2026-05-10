# Old Amber Factory

A first-person survival-horror / tactical shooter built with **Three.js**.
You wake up in an abandoned 1980s Soviet factory at dusk. Ten ancient
armored skeletons patrol the facility with bows and pickaxes. Find the
breaker, find the key, start the yellow truck — and escape.

## Playing

Open `index.html` through any static web server (not `file://`, because
ES modules are disallowed by browsers from local files):

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

Click **CLICK TO BEGIN**, allow pointer lock, and play in fullscreen for
the best experience. Chrome or Firefox desktop recommended.

## Controls

| Action | Key |
|-------|-----|
| Move  | `WASD` |
| Sprint| `Shift` (drains stamina) |
| Crouch| `Ctrl` |
| Jump  | `Space` |
| Interact / Pick up | `E` |
| Fire / Swing / Throw | `LMB` |
| Aim (pistol) | `RMB` |
| Reload | `R` |
| Switch weapon | `3` (also `1` for pistol, `2` for sword) |
| Drop held object | `Q` |

## Weapons

| Weapon | Ammo / Uses | Damage |
|--------|-------------|--------|
| Pistol | 12 rounds / magazine · 5 magazines total (60 rounds) | Head 30 · Torso 20 · Legs 10 |
| Sword  | Melee (realistic swing speed, ~0.55 s per swing) | 70 per hit |

When you run out of pistol ammo you must switch to the sword with `3`.

## Enemies

Ten skeletons, each with **100 HP** and:

* A bow with **30 arrows** (reloaded between every shot).
  * Head 30 · Torso 20 · Legs 10 damage to the player.
* A pickaxe (melee, 30 damage). Automatically used when arrows run out,
  when the player gets too close, or when the AI decides to switch.

### AI

* States: `patrol → investigate → combat / flank / retreat → search`.
* Group communication: nearby skeletons alert each other when one is in
  combat; they share the last known player position.
* Perception: line of sight + field of view + hearing (footsteps,
  gunshots, thrown objects).
* Adaptive: the AI tracks how often you crouch, sprint, and camp a
  single spot; more flanking and pressure if you play defensively,
  more spacing if you rush with the sword.

## Zones

1. **Admin corridor** – your starting area (guard room).
2. **Main production hall** – tall, with catwalks, press machines,
   columns, and conveyors.
3. **Warehouse** – tall racks with crates and barrels; hides the key.
4. **Tunnels** – tight low-ceiling metal corridor with pipes.
5. **Outdoor yard** – containers, grass, the floodlight pole, and the
   **yellow truck**.

### Objective

1. Eliminate all 10 skeletons.
2. Restore power at the breaker panel in the admin guard room.
3. Grab the ignition key hidden in the warehouse.
4. Reach the yellow truck in the south yard and start the engine.
5. Escape.

## Technical notes & honest caveats

This is **Three.js / WebGL**, not Unity HDRP. Several things in the
original design brief (ray-traced reflections, Nanite geometry,
volumetric GI, 4K-8K streamed textures, Parallax Occlusion Mapping,
hardware tessellation) are not available in a browser WebGL context
at runtime. The game approximates that feeling using:

* ACES Filmic tone mapping, PCF soft shadows, 2k shadow maps on the
  key light.
* Exponential fog + cinematic post-processing pass (vignette, chromatic
  aberration, film grain, subtle desaturation) + UnrealBloomPass for
  HDR bloom on emissive surfaces.
* Procedurally generated canvas textures (concrete, rusty metal, brick,
  floor tiles, dirt, bone) wrapped as `MeshStandardMaterial` maps.
* Procedural humanoid skeletons with per-limb groups for IK-style
  walking, aiming, and swinging animations, plus a ragdoll collapse on
  death.
* A particle system for muzzle flash, sparks, blood, dust motes, shell
  ejection, and impact puffs.
* Fully synthesized WebAudio spatial SFX (gunshots, bow twang, bone
  rattle, engine, footsteps by surface), adaptive music layers that
  rise with combat tension.
* Simple AABB/segment collision and hit-zone raycasting (head / torso /
  legs) for both bullets and arrows.

The project uses no build step; it loads Three.js from a CDN via an
import map.

## File layout

```
index.html
style.css
src/
  main.js          - game orchestration, render loop, HUD, post-FX
  level.js         - procedural factory generation + interactables
  materials.js     - procedural canvas textures + PBR-ish materials
  player.js        - FPS controller, stamina, damage, head-bob
  weapons.js       - pistol + sword, viewmodel, reload, hit-scan
  skeleton.js      - enemies: body, animation, state machine AI
  projectiles.js   - arrows + throwables with physics
  particles.js     - VFX pools + ambient dust motes
  audio.js         - WebAudio synthesis, spatial mixing, adaptive music
  input.js         - keyboard/mouse/pointer-lock state
  utils.js         - math + collision helpers
```
