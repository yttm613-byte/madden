# The player's real head

`head.json` is the head and neck the full player model uses. It is built by `prep.py`
from MakeHuman data, all of it released CC0 (public domain) by the MakeHuman project:

- the base mesh and body-shape targets, taken from the `data/` folder of the MPFB
  add-on (extensions.blender.org, "mpfb"). Only the data files are read; none of the
  add-on's code runs.
- two skin photographs (`young_african_male`, `young_caucasian_male`) from
  `makehuman_system_assets_cc0.zip` on files.makehumancommunity.org.

Neither download is committed (330MB). To rebuild:

    python3 prep.py <mpfb>/data <assets>/skins head.json

What it does: shapes a muscular young man (half African, half Caucasian targets, so the
face suits any tone), scales and moves him so his eyes sit on the player's eyes
(`EYE` in `../body.mjs`), keeps the head and neck, and stores a skin DETAIL colour per
vertex: each photograph divided by its own average, then averaged. The game multiplies
that by the player's skin tone, so one head serves every tone and needs no texture.

`../build.mjs` uses it for the `Skin/headneck` part of the full model. The light (LOD)
model keeps the sculpted head; `SCULPT_HEAD=1` forces the sculpted head on the full one.

# The real body

`body_prep.py` goes further than `prep.py` (which it replaces for `head.json`): it poses
the whole MakeHuman body onto the player's skeleton and bakes it to a distance field.

    node -e "..."            # rig_joints.json: the player's bind joints, from ../rig.mjs
    python3 body_prep.py <mpfb>/data <assets>/skins

MakeHuman ships Mixamo-named bones and skin weights for its mesh
(`data/rigs/standard/rig.mixamo.json`, `weights.mixamo.json`), and the player uses a
Mixamo skeleton, so each bone carries its share of the body onto the player's bone.
Outputs: `head.json`, `arm_detail.json` (photographed skin detail for the arms, looked
up by position) and `body_sdf.bin.gz` + `.json` (signed distance on a 4mm grid, x >= 0).
`../body.mjs` builds the torso, arms, legs, and everything worn, round that field; the
jersey follows a blurred copy of it so cloth spans the hollows. `SCULPT_BODY=1` builds
the old hand-sculpted body.

# Credits

- Body, head, skin photographs, Mixamo rig mapping and weights: the MakeHuman project
  (makehumancommunity.org), CC0.
- Reference photographs of players and helmets, looked at only, not included:
  Wikimedia Commons.
