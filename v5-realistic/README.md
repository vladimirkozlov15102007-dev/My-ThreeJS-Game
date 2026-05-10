# Old Amber Factory — GLTF Edition (v3)

A substantially-improved third iteration of the game. Still pure vanilla
Three.js, but now bootstrapped through **GLTFLoader + RGBELoader** so the
scene gets real PBR lighting from a 1K equirectangular HDR sky, and loads
an example glTF rig from the three.js CDN for future re-skinning.

No build step — open `index.html` in a modern browser (local web server
recommended so ES-module imports work, e.g. `python3 -m http.server`).

## What's new vs. v2-elite

**Lighting / rendering**

- Bright sunny midday lighting. Strong warm directional sun (intensity 4.2),
  sky-to-ground hemisphere fill (2.2), ambient fill (1.0). No more night.
- Real PBR lighting: HDRI loaded via `RGBELoader`, pushed through
  `PMREMGenerator` and applied as `scene.environment` so metallic surfaces
  get plausible reflections.
- Procedural blue-sky gradient as visible background (HDRI is used only for
  indirect lighting; the sky remains a clear sunny blue regardless).
- Reduced fog density so the yard reads crisp to the fence line.
- Cinematic post-FX retained (bloom, chromatic aberration, vignette, grain,
  damage tint) plus a new full-frame muzzle-flash brighten when firing.

**Skeleton archers — all 20 of them**

- Fully-articulated procedural humanoid rig: pelvis, 5-segment spine, ribcage
  with curved rib torii, sternum, shoulder blades, rust chest plate, cloth
  strap, neck, cracked skull with jaw, visible teeth, dark eye-sockets with
  glowing red eyes + point light, separate shoulder/elbow/wrist groups per
  arm, and hip/knee/ankle groups per leg with actual femur/tibia/foot bones.
- Quiver of six arrows slung on the back.
- **Real bow-draw IK**. The left arm lifts the bow to shoulder height; the
  right arm bends strongly at the elbow pulling the hand back toward the jaw
  over ~0.5s; the bowstring deforms proportionally; on release the right arm
  snaps forward and an arrow projectile spawns from the bow's world position.
- **Hyper-aggressive AI**. Per your request, every skeleton:
  - Spawns already in the COMBAT state with full awareness from frame 1.
  - Fires the first arrow within ~0.6s of spawning.
  - Chases relentlessly when LOS is broken (never retreats, never patrols).
  - Flanks occasionally to approach from multiple directions.
  - Switches to a quick melee swing within 2.2m.
- 20 spawn points spread across all 5 zones (admin, production, warehouse,
  tunnels, outdoor yard).

**Pistol recoil**

- Strong pitch kick (~0.14 rad) that drives a spring-damped camera impulse
  *separate* from your mouse look, so the crosshair visibly climbs.
- Random yaw jitter (~0.055 rad) for horizontal snap.
- 22 cm viewmodel push-back on a critically-damped spring.
- 6° FOV punch (zooms out briefly then settles).
- Brighter muzzle flash + world-space flash quad + spark particles + camera
  shake + full-frame post-FX flash.

**Map**

- Same 5-zone "Old Amber Factory" layout (admin corridor, production hall
  with catwalk, warehouse with racks, ventilation tunnels, outdoor yard).
- Ground is now uneven with patch decals, grass billboards, rocks, asphalt.
- 24 industrial barrels, 30 wooden crates, 12 colored shipping containers,
  hanging chains that sway, concrete rubble scattered throughout.
- Interior roofs don't cast shadows, so sunlight floods inside.
- Yellow truck at `(85, 0, 0)` with chrome grille, wheel rims, exhaust stack.
  It is the single win condition: kill all 20 skeletons, walk to the truck,
  press `E`, escape cinematic plays.

**Audio**

- Added birdsong scheduling in the ambient layer for sunny-day atmosphere.
- New dedicated bow-draw creak sound plus full bow-release twang.

## Controls

```
WASD   Move           LMB  Fire
Shift  Sprint         RMB  Aim
Ctrl   Crouch         R    Reload
Space  Jump           E    Interact (truck)
```

## Remote assets

The loader pulls from the jsDelivr mirror of the three.js r160 examples
repository, which serves assets with proper CORS headers:

- `cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures/equirectangular/venice_sunset_1k.hdr`
- `cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf/Soldier.glb`

If the network blocks those, `AssetLoader.loadAll` times out per-asset (18s)
and the game silently falls back to its procedural sky and skeletons so the
rest of the experience still plays.
