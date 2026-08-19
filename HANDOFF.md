# Gridiron Blitz — handoff brief

Everything another model needs to work on this game. Upload this file plus
`index.html`; that pair is the whole project as far as code goes.

---

## 1. What it is

A 3D American football game. One HTML file, no build step, no framework, no npm.
Open `index.html` in a browser and it runs. Three.js r128 renders it; all game
logic is plain JavaScript in one `<script>` at the bottom of the file.

The goal is to feel as close to Madden as a single file can. Play calling,
downs, quarters, a clock, kickoffs, punts, field goals, extra points and
two-point conversions, replays, and a synthesised play-by-play announcer are all
in there.

- `index.html` — 2,751 lines, 198 KB. **The entire game.**
- `assets/fbplayer_opt.glb` — 6.0 MB rigged player model, Mixamo 74-bone
  skeleton. Required to run, not useful to read.
- `assets/env.hdr` — 1.4 MB HDR environment map. Optional; there is a
  procedural fallback if it fails to load.
- `vendor/*.js` — three.js r128 plus GLTFLoader, SkeletonUtils, RGBELoader.
  Loaded from a CDN with these as a same-origin fallback.

**Constraints that are not negotiable:**
- No external runtime dependencies beyond the vendored three.js. The owner is
  behind a content filter, so anything that must be fetched from a third-party
  host at runtime will fail for them. Textures, sounds and the crowd are all
  generated procedurally in code for this reason.
- No build step. The file that ships is the file that runs.
- Everything stays in `index.html`. Splitting it into modules would break the
  "open the file and it works" property that the whole project is built on.

---

## 2. Architecture map

All line numbers are from the current `index.html`.

### Layout and state
| What | Where |
|---|---|
| Speed and radius constants (`S`) | 207 |
| Difficulty table (`DIFF`) | 253 |
| Quarter length (`QTR_SECS = 75`) | 215 |
| Game state object (`G`) built in `newGame()` | 257 |
| Play definitions (`PLAYS`) | 471 |

The game runs on a fixed-size 2D "world" in pixels; `PPY` is pixels per yard and
`yd(n)` converts. The 3D scene is a projection of that 2D world — `WX()`/`WZ()`
at line 1769 map world pixels to three.js metres. **All gameplay logic is 2D.**
The 3D layer is presentation only.

`G.phase` is the state machine: `start` → `playcall` → `presnap` → `live` →
`dead` → back to `playcall`, plus `fg` and `final`.

### Per-frame flow
```
loop()            978   requestAnimationFrame driver
 update(dt)       993   phase dispatch; everything below hangs off this
  updateKickoffFlight  310   kickoffs and punts, from the approach to the catch
  updateDrop     1204   QB drop-back, routes, pass rush
  updateBall     1267   ball in the air
   resolveCatch  1294   catch / incompletion / interception odds
  updateRun      1382   ball carrier, blocking, pursuit, tackles
  updateFG       1663   field goal mini-game
 render3D()      2363   the entire 3D layer, driven off the 2D state
```

### The systems most worth understanding
| System | Line | Notes |
|---|---|---|
| `stepDefenders` | 1086 | The heart of the defence. Per-defender timers tick here for **everyone**, including the human-controlled defender. Tackle resolution lives at the bottom. |
| `aiPursue` | 963 | Moves a defender toward a point. Must write `vx`/`vy` or the player renders as a motionless idle pose. |
| `blockNearest` | 933 | Blocker-to-defender assignment and shed timing. |
| `tackleHit` / `tackleBreak` | 1056 / 1069 | Reach grows with closing speed; broken tackles are rolled from angle, speed and a per-carrier elusiveness. |
| `cpuRunAI` | 1165 | CPU ball carrier. Lane vision — looks ahead and picks the emptiest gap. |
| `resolveCatch` | 1294 | Catch odds by separation **and** throw depth; interception odds likewise. |
| `makeRoute` / `routeSpeed` | 566 / 574 | Routes have a settle depth so receivers stop running away. |
| `makePlayer` | 1984 | Material-to-body-part mapping and per-player skin tone. |
| `applyPose` | 2147 | Procedural skeletal animation — run, idle, throw, tackle, block, celebrate. No animation clips; every pose is computed. |

---

## 3. Things that will bite you

These are all mistakes that were actually made and cost real debugging time.

**Material names on the player model lie.** The model came from a free asset and
its materials are named things like `Mat.3`, `default`, `Default`,
`sepatu_key.obj`. They do not describe what they are. `default` is the
**facemask**. `Mat.2_2mat` is the **chin cup**. `Mat.3` is the helmet shell and
covers three separate meshes. The only reliable way to identify a part is to
colour-code the material and render the player. Do not infer from names.

**The eyeballs share the skin's material name.** They are told apart by triangle
count (`< 4000`), not by name, because the optimiser renames meshes to
`Object_NN`.

**The running lean writes `model.rotation.z` every frame.** Anything else that
wants that axis (the fall animation) has to own it explicitly or it gets
overwritten silently.

**`aiPursue` is deliberately not called for the human-controlled defender.** Any
per-defender timer put inside it will never expire on your own player. This
caused a bug where a single block meant blocked for the entire rest of the play.

**The 2D world flips on a change of possession.** Offence always attacks +x.
`flipLos()` at 267 mirrors the field. Interception returns mirror every entity.

---

## 4. Measured baselines — do not undo these

Every number below was tuned against real NFL rates using headless browser
harnesses, not guessed. If you change the physics, the AI or the odds, re-measure
these before claiming an improvement. Several of them moved in the wrong
direction from changes that looked obviously correct on paper.

| Metric | Current | NFL |
|---|---|---|
| Yards per carry | 4.5 | 4.3 |
| Run gain range | −0.1 to 15.1 | wide tails both ways |
| Completion rate | 62.8% | 65% |
| Interception rate | 3.3% of attempts | 2.3% |
| Yards after catch (median) | 3.0 | ~4 |
| Sack rate | ~6% of dropbacks | 6.5% |
| Punt return | 10.1 avg | ~9 |
| Kick return | 22.3 avg | ~22 |
| Field goal, 40 yards | 89% | 82% |
| Field goal, 50 yards | 71% | 68% |
| Total points per game | 51–63 | 45 |

**The measurement method matters more than the numbers.** Three separate times a
"regression" turned out to be a broken harness rather than a broken game — a
returner that never moved because the test pressed no keys, a counter that
re-recorded the same completion every frame, a sim that ran past the end of the
game and restarted on the goal line. Validate the harness before trusting a
surprising result.

---

## 5. Known gaps — good things to work on

Roughly in order of how much they would improve the game.

1. **Scoring is ~25% too high.** 51–63 points a game against an NFL 45. Not one
   broken mechanic any more; it is that a game is ~40 offensive plays instead of
   125, so every drive is a large fraction of the game. Needs a structural
   answer, not more tuning.
2. **No CPU carry ever loses yards.** Tackles for loss happen to the player but
   not to the CPU back, who starts 3–4 yards deep and is faster than anyone
   chasing him. The NFL stuffs ~17% of carries at or behind the line.
3. **Only 3% of runs go 10+ yards** against an NFL 11%. The explosive tail is
   thin even though the mean is right.
4. **Players do not get up after the whistle.** They stay down through the dead
   phase and pop upright at the next snap.
5. **No onside kicks, no fair catches, no penalties, no audibles, no hot routes,
   no defensive line shifts.** All standard Madden features that are simply
   absent.
6. **The player model is a cheap free asset.** Torn head geometry that needed
   Laplacian denoising to be usable, a mitten hand rig with only thumb and index
   bonned, a college uniform baked into the texture, and 46% of its triangle
   budget spent on the helmet shell. It is worked around, not fixed.
   `PLAYER_MODEL_PROMPT.md` in the repo is a spec for a replacement.

---

## 6. How to test

There is no test framework. Testing is done by driving the real game in a
headless browser and measuring against NFL rates.

`tools/build-test.cjs` generates two debug builds from `index.html`:
- `index.test.html` exposes `window.__gb` — scene, camera, renderer, game state.
- `index.sim.html` exposes `window.__sim` — `update(dt)`, `keys`, `snap()`,
  `choosePlay()` and friends, so a harness can drive the game frame by frame
  without rendering.

Harnesses live in `tools/*.mjs` and each one measures a single thing:
`runtrace` (run distribution), `yactrace` (yards after catch), `depthtrace`
(completion by throw depth), `tacklenow` (frames from contact to whistle),
`puntzero` / `koret` (returns), `sacktrace`, `inttrace`, `fullsim` (whole games).

Two practical notes: drive `update(dt)` directly rather than waiting on real
time, because software rendering only manages a few frames a second; and listen
for **console** errors, not just page errors — a three.js shader that fails to
compile never raises a page error and will silently render nothing.

---

## 7. Suggested prompt

> This is a complete 3D American football game in a single HTML file. Read
> HANDOFF.md first — it maps the architecture, lists the traps, and gives the
> measured baselines the gameplay is tuned to.
>
> [then pick one]
> - Work on gap #2 and #3 from the handoff: the run game has the right average
>   but almost no tail in either direction.
> - Add penalties: holding, false start, pass interference, with the flag, the
>   announcement and the yardage.
> - Add a playbook screen so the player picks from a real set of formations
>   instead of three runs and four passes.
> - Review the rendering for performance; it targets 60fps and drops on older
>   machines at the Ultra quality setting.
>
> Constraints: everything stays in the one file, no build step, no runtime
> dependency on any external host. Re-measure anything in the baselines table
> that your change could plausibly affect, and say what you measured.
