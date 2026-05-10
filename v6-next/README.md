# Old Amber Factory — v6-next (REAL glTF Edition)

This is the version where glTF-through-GLTFLoader actually does something
visible — not just an HDR-skybox. The previous v3/v4/v5 editions loaded
`Soldier.glb` but never instantiated it.

## What is actually loaded from the CDN

Remote assets served from the jsDelivr mirror of the three.js r160 example
repo (CORS-enabled):

1. `venice_sunset_1k.hdr` — PBR environment map (reflections on metal + glass).
2. `Soldier.glb` — Mixamo-rigged humanoid (**65 bones**, 4 animation clips:
   `Idle`, `Walk`, `Run`, `TPose`).

Each of the 20 skeletons is built like this:

- `SkeletonUtils.clone(gltf.scene)` to get an independently-posable copy.
- `AnimationMixer` bound to the clone with all 4 clips loaded, start time
  randomized so the swarm doesn't move in lockstep.
- Materials swapped: body → pale bone PBR material (slight hue/value jitter
  per skeleton), visor → matte black.
- Attached to the rig's `Spine2` bone: rust chest-plate, pauldrons, cloth
  strap, quiver with 5 visible arrow shafts and red fletchings.
- Attached to `LeftHand` bone: a 3D bow with 6 curved limb segments, a
  deformable string (mesh `position.x` is animated to simulate the pull)
  and a knocked arrow that appears only while drawing.
- Attached to `Head` bone: glowing red eye spheres + a `PointLight` with
  intensity ~0.9 and range 280 cm.
- Every frame, AFTER `mixer.update(dt)` has posed the rig, the upper body
  bones (`LeftArm`, `LeftForeArm`, `RightArm`, `RightForeArm`, `Spine2`,
  `Head`) are overwritten with a bow-draw pose blended by `drawT`/`releaseT`:
  left arm lifts the bow forward, right shoulder swings up, right elbow
  bends sharply to pull the string toward the jaw, release snaps the arm
  forward and spawns the arrow projectile from the bow's world position.
  Legs continue to animate naturally via the `Idle`/`Walk`/`Run` clips.

## High-poly environment (no more Minecraft rocks)

All the v3 primitive props are replaced:

- **Rocks** → `IcosahedronGeometry(size, 2)` (~162 verts) with per-vertex
  two-octave fBm displacement, flat-shaded for faceted but detailed look.
  140 outdoor + 80 indoor.
- **Barrels** → capped cylinder body + 3 torus ring bands + top rim disc
  + bung plug, rust-tinted PBR material. 26 scattered.
- **Crates** → bevelled wood box + 6 plank strips + 8 corner frames + 8
  steel rivets. 46 scattered.
- **Shipping containers** → corrugated steel shell with 23 vertical ribs
  per side, double doors with handles, 8 ISO corner castings. 12 lined up.
- **Trees** → tapered cylinder trunk + 3 stacked displaced-icosahedron
  canopy blobs. 20 outside.
- **Truck** → cab + angled hood, windshield (tilted glass) + side windows,
  cargo bed with 4 stake posts, 6-slat chrome grille, emissive headlights,
  chrome exhaust stack + cap, chrome bumper, 4 wheels with rims + chrome
  hubs, mud-flaps behind the rear axle.
- **Ground** → 160×160 subdivided plane, two-octave sinusoid + jitter
  displacement, plus 20 dark asphalt patches.

## Preserved from v3-gltf

- Bright sunny daylight (directional 4.2, hemisphere 2.2, ambient 1.0).
- 5-zone map layout (Admin / Production / Warehouse / Tunnels / Outdoor).
- 20 hyper-aggressive archers spawning directly in COMBAT state.
- Pistol with strong recoil: spring-damped pitch kick (~0.14 rad), yaw
  jitter (~0.055 rad), 22 cm viewmodel pushback, 6° FOV punch, muzzle
  flash, shell ejection, camera shake.
- Full AABB collision — neither player nor skeletons can walk through any
  wall, container, crate, barrel, column, fence, or the truck.
- Yellow truck escape win condition.

## Files that changed vs v3-gltf

- `src/assetLoader.js` — tries 3 CDN mirrors per asset, higher timeout.
- `src/skeleton.js` — completely rewritten to use `SkeletonUtils.clone` +
  `AnimationMixer` + bone-overlay bow-draw on the Mixamo rig.
- `src/level.js` — all primitives replaced with high-poly procedural props.
- `src/main.js` — passes `assets.soldier` into each `new Skeleton(...)`.

## Running

```bash
cd v6-next
python3 -m http.server 8000
# open http://localhost:8000
```

## Controls

```
WASD   Move           LMB  Fire
Shift  Sprint         RMB  Aim
Ctrl   Crouch         R    Reload
Space  Jump           E    Interact (truck)
```
