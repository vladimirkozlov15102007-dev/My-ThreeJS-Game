# Old Amber Factory — ELITE Edition

Standalone copy of the base game with **10 additional elite red skeletons** on
top of the original 10. Total 20 hostiles.

## What's new vs base game

The base project is preserved unchanged. This v2 folder is a full copy with
only the differences described below. Everything else (level, weapons, UI,
audio, adaptive AI, sunlit daytime lighting, strong recoil) is identical.

### Elite red skeletons (`{ elite: true }`)

Ten extra commanders spawn in addition to the normal 10, at fixed locations
across all zones (admin, production, warehouse, tunnels, outdoor yard).

| Stat | Normal | Elite |
|------|--------|-------|
| HP | 100 | 160 |
| Arrows | 30 | 60 |
| Melee damage | 30 | 45 |
| Arrow damage (head/torso/legs) | 30/20/10 | 45/30/15 |
| Bow nock time | ~0.83 s | ~0.33 s |
| Shot cooldown | 2.2–3.0 s | 0.5–0.9 s |
| Melee swing time | 0.55 s | 0.35 s |
| Sight distance | 28 m | 50 m |
| View cone | 150° | ~220° (almost full circle) |
| Engage awareness threshold | 0.5 | 0.15 |
| Awareness decay | 0.25/s | 0.08/s (stays angry) |
| Move speed multiplier | 1.0× | 1.5× |
| Combat tracking turn rate | 4 rad/s | 8 rad/s |
| Ideal bow range | 10 m | 7 m (pressures player) |
| Retreats at low HP | yes (random) | **never** |
| Arrow speed | 34 m/s | 48 m/s |
| Bow accuracy spread (near) | 0.04 | 0.015 |
| Aggression multiplier | 1.0 | **5.0** |

### Visual changes on elites

* Blood-red bone material with emissive highlight.
* Red cloth tatters, dark metal chest plate with emissive glow.
* Larger, brighter red eyes + bright red point light at the skull
  (visible through fog and dim corners).
* Slightly bigger body scale.

### New visible attack animations

* **Bow release pulse** — on every shot the right arm snaps forward, the left
  arm kicks back, the torso leans into the shot, the bowstring snaps past
  rest, and for elites the string briefly flashes wider.
* **Melee torso twist** — when swinging the pickaxe, the pelvis now rotates
  into the chop so the strike reads clearly from any angle.

These animations also apply to normal skeletons, since the changes live in
shared `_animate`, just fire-pulsed by the new `_fireRecoilT` timer set
inside `_shootArrow`.

## File layout

Identical to the base game, so see the root `README.md` of
`My-ThreeJS-Game/` for controls, weapons, and the full system description.

The only modified files are:

* `index.html` — title, subtitle, enemy count.
* `src/main.js` — spawns the 10 elites in addition to the 10 normals.
* `src/skeleton.js` — elite stats, red materials, red eyes, faster
  perception / combat, visible release animation.
