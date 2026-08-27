# Gridiron Blitz 3D

A self-contained, buildless 3D American-football game. The simulation engine runs all
game logic on a 2D plane; a Three.js layer renders it in 3D. `index.html` is the whole
game — engine, renderer, HUD and audio in one file, no build step.

## Run it

The game is just static files. Serve the folder and open `index.html`:

```bash
npm install        # only needed for the bundled dev server or the model tools
npm run serve      # http-server on http://localhost:8088
# then open http://localhost:8088/index.html
```

Any static file server works; `index.html` needs `vendor/` and `assets/` next to it.
Opening the file directly from disk will not work — the GLB and HDR are fetched.

## The player model

Players are clones of one rigged GLB, **`assets/fbplayer_opt.glb`** — a 74-bone
Mixamo-skeleton humanoid, 21 meshes, ~150k triangles, 15 materials. It is loaded once
and cloned 24 times into a fixed pool; entities are assigned to pool slots each frame
rather than being created and destroyed.

Individuality comes from per-clone material clones and toggled kit meshes, not from
separate models: skin tone sampled from weighted tone anchors, team colourway, visor,
cleat colour, undersleeves, sock height, and a +/-6% build variation.

Two things about this asset are worth knowing before you touch it:

- **Its material names lie.** They came through an OBJ merge and describe nothing:
  `default` is the facemask, `Mat.2_2mat` the chin cup, `Mat.3` the helmet shell
  (across three meshes), `Plastic_Matte` the neck roll, `Default` the socks. The
  mapping in `makePlayer()` was established by tinting each material and looking.
  Do not infer it from the names.
- **Its attributes are quantised.** `WEIGHTS_0` is normalised `UNSIGNED_BYTE` and
  `POSITION` is normalised `SHORT`. three r128's `BufferAttribute.getX()` returns the
  raw integer, so anything reading vertices directly — including
  `SkinnedMesh.boneTransform()` — reports positions inflated by ~255 x 32767 unless
  you denormalise by hand.

### Animation

There are no animation clips driving gameplay. One 13.9s Mixamo idle ships in the GLB
and is used verbatim for standing players, desynced per player. Everything else is
**procedural**: `applyPose()` computes bone quaternions from a cached bind pose for
eight states — `run`, `reach`, `set`, `throw`, `kick`, `tackle`, `celebrate`, `idle` —
driven by each entity's speed and play state. The run cycle locks stride phase to
ground distance so the feet do not slide. On top of that, `render3D()` layers
contextual overrides the state machine cannot express: stiff-arms, block engagement,
and a randomised fall.

### The legacy model

`assets/player.glb` and `tools/build-player.cjs` are an earlier generated 17-bone rig
that the game **no longer loads**. They remain only for `tools/viewer.html`.
`npm run build:player` rebuilds that legacy asset, not the one in the game.
`PLAYER_MODEL_PROMPT.md` is a spec for a cleaner replacement.

## Three.js

Three.js r128 plus GLTFLoader, SkeletonUtils and RGBELoader are loaded **CDN-first with
the vendored copies under `vendor/` as a same-origin fallback**, written synchronously
during parse so load order is preserved. The game therefore still runs with no network,
but it does try the CDN first.

Textures, crowd, sky and audio are all generated procedurally in code rather than
fetched, so the only binary assets are the player GLB and an optional HDR environment
map (`assets/env.hdr`, with a procedural fallback if it fails to load).

## Layout

```
index.html              the game (engine + 3D renderer + HUD)
gridiron-blitz-3d.html  original single-file version, primitive players (reference)
vendor/                 three.min.js, GLTFLoader, SkeletonUtils, RGBELoader, BufferGeometryUtils
assets/fbplayer_opt.glb the rigged player the game actually loads
assets/env.hdr          HDR environment map (optional)
assets/player.glb       legacy generated rig, used only by tools/viewer.html
tools/                  model tools and measurement harnesses
HANDOFF.md              architecture map, known traps, measured gameplay baselines
```

## Testing

There is no test framework. `tools/build-test.cjs` generates two gitignored debug
builds from `index.html`: `index.test.html` exposes `window.__gb` (scene, camera,
renderer, pool, game state) and `index.sim.html` exposes `window.__sim`, which lets a
harness drive `update(dt)` frame by frame with no rendering at all.

Gameplay is measured against real NFL rates by driving the sim build headlessly — see
the baselines table in `HANDOFF.md` and re-measure anything a change could affect.
Rendering work is measured with `renderer.info` counts (draw calls, triangles,
skeletons), never frame time, since the sim runs under software rendering.

Two practical notes: drive `update(dt)` directly rather than waiting on real time, and
listen for **console** errors as well as page errors — a Three.js shader that fails to
compile raises no page error and silently renders nothing.
