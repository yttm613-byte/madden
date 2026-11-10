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
