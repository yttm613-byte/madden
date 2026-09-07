/* build-artifact.cjs — bundle the game into ONE self-contained HTML page.
 *
 *   node tools/build-artifact.cjs <outfile>
 *
 * The published page runs under a strict CSP that blocks every external host, and
 * relative paths resolve against the host rather than this repo. So everything the
 * game loads has to travel with it: the three.js libraries inline, the player model
 * and the HDR environment as data URIs, and the two Google fonts embedded.
 * Head/body/doctype are stripped because the publisher supplies its own skeleton.
 *
 * ORDER MATTERS. Strip the document skeleton FIRST, while the file is still just the
 * game, and only then inline the libraries. Doing it the other way round runs those
 * tag-stripping regexes across three.js — and `<meta[^>]*>` happily matches
 * `#include <metalnessmap_pars_fragment>` inside the shader chunks, which deletes the
 * include and every material fails to compile with "undeclared identifier
 * metalnessFactor". Verified: the bundle rendered a blank field until this was fixed.
 */
const fs = require('fs');
const path = require('path');
const out = process.argv[2] || 'game.html';

let s = fs.readFileSync('index.html', 'utf8');
const b64 = f => fs.readFileSync(f).toString('base64');
const size = n => (n / 1e6).toFixed(2) + 'MB';

// ---- 1. drop the parts the publisher supplies, and the blocked font stylesheet ----
const scriptStart = s.indexOf('<!-- Three.js:');
const scriptEnd = s.indexOf('</head>');
if (scriptStart < 0 || scriptEnd < 0) { console.error('could not find the script block'); process.exit(1); }
const LIB_MARK = '<!--THREE_LIBS-->';
s = s.slice(0, scriptStart) + LIB_MARK + s.slice(scriptEnd);

s = s.replace(/<!DOCTYPE html>\s*/i, '')
     .replace(/<html[^>]*>\s*/i, '')
     .replace(/<\/html>\s*/i, '')
     .replace(/<head>\s*/i, '')
     .replace(/<\/head>\s*/i, '')
     .replace(/<body[^>]*>\s*/i, '')
     .replace(/<\/body>\s*/i, '')
     .replace(/<meta[^>]*>\s*/gi, '')
     .replace(/<link[^>]*>\s*/gi, '');

// ---- 2. fonts, embedded (the stylesheet link would be blocked) -------------------
// Vendored, not fetched. This read used to point at a file in /tmp, and when /tmp was
// cleared the build silently produced a bundle with NO fonts and said "fonts 0.00MB"
// in a line nobody reads. A missing font is invisible in a diff and obvious on screen.
const FONTS = 'vendor/fonts.css';
if (!fs.existsSync(FONTS)) { console.error('missing ' + FONTS + ' — the bundle needs it'); process.exit(1); }
const fontCss = fs.readFileSync(FONTS, 'utf8');
s = s.replace('<style>', '<style>\n' + fontCss + '\n');

// ---- 3. the model, its LOD meshes and the HDR environment as data URIs -----------
// The LOD file is what keeps the bundle playable on a laptop — without it every one
// of the twenty-two players on the field renders all 150k of its triangles — and the
// game only warns in the console when it is missing, so fail the build instead.
const LOD = 'assets/player-lod.bin';
if (!fs.existsSync(LOD)) { console.error('missing ' + LOD + ' — run: npm run build:lod'); process.exit(1); }
const glb = b64('assets/fbplayer_opt.glb');
const hdr = b64('assets/env.hdr');
const lod = b64(LOD);
s = s.replace("'assets/fbplayer_opt.glb'", "'data:model/gltf-binary;base64," + glb + "'");
s = s.replace("'assets/env.hdr'", "'data:application/octet-stream;base64," + hdr + "'");
s = s.replace("'assets/player-lod.bin'", "'data:application/octet-stream;base64," + lod + "'");

// ---- 4. three.js and its loaders, inline and in order (LAST) ---------------------
const LIBS = ['three.min.js', 'GLTFLoader.js', 'SkeletonUtils.js', 'RGBELoader.js'];
const libBlock = LIBS.map(f =>
  '<script>' + fs.readFileSync(path.join('vendor', f), 'utf8') + '</script>'
).join('\n');
s = s.replace(LIB_MARK, libBlock);

fs.writeFileSync(out, s);
console.log('wrote', out, size(Buffer.byteLength(s)),
  '| model', size(glb.length), '| lod', size(lod.length), '| hdr', size(hdr.length), '| fonts', size(fontCss.length));
