# Prompt: generate an American football player model

Paste the block below. Every requirement exists because the current free model
violated it — the reasons are in the "why" column at the bottom, worth keeping if
you want to argue with whatever generates it.

---

## THE PROMPT

Create a game-ready 3D American football player, delivered as a single **.glb**
file with embedded textures.

**Scale and orientation**
- Y-up, Z-forward, real-world metres. Standing height 1.88 m.
- Origin at the feet, centred between them, at world (0,0,0).
- **A-pose** (arms ~45° down from the shoulders), not T-pose.

**Rig**
- Humanoid skeleton, Mixamo-compatible naming (`mixamorig:Hips`,
  `mixamorig:Spine`, `mixamorig:Spine1`, `mixamorig:Spine2`, `mixamorig:Neck`,
  `mixamorig:Head`, `mixamorig:LeftArm`, `mixamorig:LeftForeArm`,
  `mixamorig:LeftHand`, and the leg chain, mirrored).
- **All five fingers bonned on each hand** — Thumb/Index/Middle/Ring/Pinky, three
  joints each. Not a mitten rig.
- Skin weights normalised, max 4 influences per vertex, no unweighted vertices.
- No animation needed. Bind pose only.

**Topology — this is the part that usually goes wrong**
- The body is **one continuous watertight mesh**. Not separate shells jammed
  together, not converted-and-merged OBJ parts.
- **No duplicate-position vertices** except at genuine UV seams. No overlapping
  or intersecting faces, no spikes, no degenerate triangles, no inverted normals.
- The **head must be clean, watertight and evenly tessellated** — no scan tears,
  no holes, no stray polygons across the cheeks. Mouth **closed**. Do not model
  teeth, tongue or a mouth interior.
- Total budget **40,000–60,000 triangles**, distributed by what is visible:
  roughly 40% body and head, 30% uniform, 30% helmet and equipment. Do not spend
  half the budget on the helmet shell.

**Materials — name them literally, one per part**
`Skin`, `Jersey`, `Pants`, `Helmet`, `Facemask`, `ChinStrap`, `Visor`, `Cleats`,
`Socks`, `Gloves`, `Undersleeves`, `Belt`, `NeckRoll`.
No auto-generated names (`Mat.2`, `default`, `Material.001`), and no two
materials whose names differ only by case.

**Textures**
- PBR set per material group: baseColor, normal, roughness, **ambient occlusion**.
- **A dedicated 2048×2048 head/face texture**, separate from the body atlas.
  Body atlas 2048×2048. Do not pack the face into a corner of the body map.
- **Bake ambient occlusion** into the AO map — collar, under the shoulder pads,
  armpits, every cloth fold.
- Jersey, pants, helmet and socks must be **neutral white/light grey with no team
  colour, no logo, no numbers baked in** — they get tinted at runtime. Keep the
  fabric weave, stitching and panel seams in the normal and roughness maps.
- Skin baseColor should be a **neutral mid-tone**, tintable to any complexion.

**Separate, individually toggleable meshes** (so players can be varied):
`Visor`, `Gloves`, `Undersleeves`, `Cleats`. Each its own mesh object so it can
be hidden per player.

**Style**
Realistic proportions of a modern NFL player — broad shoulders exaggerated by
pads, thick neck, athletic build. Photoreal, not cartoon or stylised.

---

## WHY EACH LINE IS THERE

| Requirement | What went wrong without it |
|---|---|
| One watertight body mesh, no duplicate positions | 2,467 of 13,944 vertices sat at duplicate positions — stitched-together parts |
| Clean watertight head, no tears | The head had torn spiky polygons; it took Laplacian denoising to make it usable |
| Mouth closed, no teeth modelled | The open mouth exposed teeth and braces in every close-up |
| Five-finger rig | Only thumb and index were bonned; the other fingers dragged along as a mitten |
| Literal material names | Names were `sepatu_key.obj`, `Mat.2`, `default` AND `Default` — every part had to be identified by colour-coding and photographing it |
| Dedicated 2K face texture | The face was a small blotchy patch inside the shared body atlas |
| Baked AO | There was no AO map at all, which is why it read flat and plastic |
| Neutral untinted kit | The baked maroon/gold "COUGARS" kit fought every team colour into the same washed salmon |
| Triangle budget by visibility | The helmet shell alone was 46% of the model; the body and arms got ~5,600 triangles |
| Separate visor/gloves/sleeve meshes | Per-player variation needs parts that can be toggled independently |

---

## IF YOU JUST WANT A PICTURE

> Photorealistic full-body render of an American football player in a plain white
> unbranded uniform, A-pose, neutral studio lighting on a grey background, front
> view. Modern NFL build: broad shoulder pads, thick neck, athletic. White helmet
> with a dark facemask, white jersey and pants with no logos or numbers, white
> socks, black cleats. Clean, sharp, no motion blur. Full body in frame, head to
> feet.
