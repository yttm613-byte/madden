# Gridiron Blitz 3D

A self-contained, buildless 3D American-football game. The simulation engine
runs all game logic on a 2D plane; a Three.js layer renders it in 3D.

This is the "real project" evolution of the original single-file
`gridiron-blitz-3d.html` (kept in the repo for reference). Key changes:

- **No CDN.** Three.js r128 and the example loaders are vendored under `vendor/`,
  so the game runs offline.
- **Rigged GLTF players.** The primitive "pawns" were replaced with a skinned,
  skeletally-animated football player (`assets/player.glb`) cloned per entity,
  with per-team colors and per-player variation (skin tone, build). Animation
  clips: `idle`, `run`, `tackle`, `celebrate`.

## Run it

The game is just static files. Serve the folder and open `index.html`:

```bash
npm install        # only needed to (re)build the model or use the bundled server
npm run serve      # http-server on http://localhost:8088
# then open http://localhost:8088/index.html
```

Any static file server works; `index.html` only needs `vendor/` and `assets/`
next to it.

## Rebuild the player model

`assets/player.glb` is generated, not hand-authored. To change the rig,
geometry, or animations, edit `tools/build-player.cjs` and run:

```bash
npm run build:player
```

This builds a 17-bone skinned humanoid (rigid per-segment binding, 5 material
slots: jersey / helmet / skin / pants / dark) and authored animation clips,
exporting via Three's `GLTFExporter`. The game loads it back with `GLTFLoader`
and drives each clone's `AnimationMixer` from the engine's per-entity speed and
play state.

`tools/viewer.html` is a tiny standalone model viewer for inspecting the rig.

## Layout

```
index.html              the game (engine + 3D renderer)
gridiron-blitz-3d.html  original single-file version (reference)
vendor/                 three.min.js, GLTFLoader, SkeletonUtils, BufferGeometryUtils, GLTFExporter
assets/player.glb       generated rigged player model
tools/build-player.cjs  model + animation generator
tools/viewer.html       standalone rig viewer
```
