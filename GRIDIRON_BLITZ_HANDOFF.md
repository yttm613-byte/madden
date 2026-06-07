# Gridiron Blitz — Project Handoff (for Claude Code)

Paste this whole file into Claude Code along with `gridiron-blitz-3d.html`. It is the full context for a 3D American-football game that was built in the Claude chat sandbox, where the assistant **could not see the WebGL render or hear the audio** — only run the logic headlessly. Your biggest advantage in Claude Code is that you can actually **run it in a real browser, screenshot it, and look.** Use that.

---

## What this is
A single, self-contained `gridiron-blitz-3d.html` — a playable 3D football game. No build step, no dependencies except **Three.js r128 loaded from cdnjs** via a `<script>` tag. Open the file in a browser and it runs (needs internet for the CDN).

## Architecture (important — don't rewrite this)
- **One simulation engine** runs all game logic on a flat 2D plane (a big state object `G`): physics, AI, downs, scoring, playbook, two-way possession, kicks.
- **The 3D layer is only a renderer.** Each frame, `render3D()` reads `G` and positions Three.js meshes; `init3D()` builds the static scene. The 3D code does NOT contain game logic. If you upgrade visuals, you mostly touch `render3D()` / `init3D()` / `makePlayer()` and leave the engine alone.
- **Coordinates:** world units are pixels; `PPY` = pixels per yard. Field x = downfield (offense ALWAYS attacks +x toward `GOAL_X`), y = lateral. 3D maps `WX(px)=px/PPY` and `WZ(py)=(py-fieldTop)/PPY`. Field is 120 yds long, 53.3 wide; left end zone 0–10, right 110–120, goal lines at `OWN_GOAL`=yd(10) and `GOAL_X`=yd(110).
- **Possession-flip trick:** interceptions/kick/punt returns reuse the offense-attacks-+x engine by mirroring positions across the field (so the returner attacks +x). Flag `G._returning` + `G._retKind` ('int' | 'kick' | 'punt'); on the play ending, `finishDead` starts a fresh series for the returning team.

## Features already implemented (verify them visually — several were never seen)
- Two-way play: you're on offense (control ball carrier) or defense (control one defender, Space switches to nearest).
- 7-play playbook: runs (dive, sweep, draw) + passes (slants, verticals, screen, play-action). Pre-snap defensive call (blitz/balanced/cover).
- Difficulty: Rookie / Pro / All-Pro (scales CPU speed/reaction/FG accuracy).
- Full rules: downs & distance, 5-min clock, **real kickoffs** (ball is kicked, arcs to a returner who can move while it's in the air, then live return), **punts** (4th-down PUNT button; visible kick + live return), **field goals & extra points** (power+aim mini-game; the kicked ball flies in 3D and goes through/wide/short to match the meters), **2-point conversions** (you choose kick or go-for-2; CPU goes for 2 situationally), **live interception returns**, **safeties**, turnover-on-downs.
- Spin move (Space while running) breaks tackles; sprint (Shift) drains stamina.
- Speed-based "dive" tackling; pre-snap offside clamp; no forward pass past the line of scrimmage (crossing it forces a scramble/run).
- **Two-man commentary booth:** play-by-play + a lower-pitched color analyst, large randomized phrase pools, situational pre-snap calls (red zone, 3rd-and-long, 2-minute), momentum awareness. Speaks via Web Speech API (it picks the most natural available voice) + a caption banner. Delivery is dynamic (excited on big plays). 🎙️ toggles voice.
- Night-stadium presentation: stands + crowd texture, floodlight towers, sky, fog, ambient crowd noise that swells on big plays, camera flashes, mottled turf, ACES filmic tone mapping + sRGB.
- Players are **articulated primitives** (helmet, shoulder pads, torso, two-segment arms & legs that bend at elbow/knee, jersey numbers, helmet stripes, varied builds/skin tones) with a running gait + lean.

## How it was tested (you can do this too, but better)
There's a Node headless harness pattern: extract the `<script>`, `node --check` it, then run it with mocked DOM / canvas / AudioContext / a universal Proxy for `THREE`, pumping ~70k frames to assert 0 errors and that a full game completes. This proves the **logic** never crashes — it proves **nothing about how it looks or sounds.**

## KNOWN LIMITATIONS / what to fix in Claude Code (the whole point)
1. **Nobody has ever seen it render.** Run it in a real browser (e.g. serve the folder and load it, or use Playwright/Puppeteer headless + screenshots) and visually QA: kickoff/punt ball arcs and player spawn positions, field-goal camera framing, the running gait joint directions (knees/elbows may bend the wrong way — sign flips), tone-mapping exposure (may be too dark/bright; it's `renderer.toneMappingExposure`, currently ~1.3), shadow placement, the interception "mirror" teleport.
2. **Players are stylized primitives, not photoreal.** The chat sandbox can't load external 3D assets. In Claude Code you CAN: add a real toolchain, load rigged **GLTF** humanoid/football-player models with skeletal run/idle/tackle animations via `GLTFLoader`, and swap them in for `makePlayer()`. This is the single biggest realism upgrade and was impossible before.
3. **Voice quality depends on the device's installed TTS voices** and the Web Speech API can't do true sentence-level intonation. Consider a better TTS path if you move off a single static file.
4. **Self-contained-file constraint is self-imposed.** If you're willing to make it a real project (folder + assets + a dev server), you can drop the CDN dependency, bundle Three.js, add model/texture/audio files, and ship something far richer.

## Suggested first session in Claude Code
1. Get it running locally and take screenshots of: opening kickoff, a run play mid-tackle, a field-goal attempt, an interception return. Fix whatever looks broken.
2. Confirm/repair the run-cycle joint rotations and camera framing for kicks.
3. Then: replace the primitive players with a GLTF model + animation clips (idle / run / tackle / celebrate), driven by the existing per-entity speed/state in `render3D()`.

## Engine constants quick-ref (in `S={}`, all ×PPY)
carrier 7.5, sprint 9.9, def 8.0, defSprint 9.7, blocker 7.0, rec 7.7, cover 7.45, rush 7.6, cpuRun 7.55, cpuSprint 9.4, throwSpd 34, tackleR 1.5, spinR 3.0, catchR 2.0, intR 0.9. Field render: chase camera lerps behind the ball carrier; pool of ~26 reusable humanoid groups; field is a CanvasTexture plane; PCFSoft shadows; fog.

**Bottom line: the logic is solid and fully featured. The work that remains is visual/audio polish and real 3D models — exactly the things that need eyes on a real render, which you now have.**
