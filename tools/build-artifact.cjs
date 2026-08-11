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
let fontCss = '';
try { fontCss = fs.readFileSync('/tmp/gf_latin.css', 'utf8'); } catch (e) {}
s = s.replace('<style>', '<style>\n' + fontCss + '\n');

// ---- 3. the model and the HDR environment as data URIs ---------------------------
const glb = b64('assets/fbplayer_opt.glb');
const hdr = b64('assets/env.hdr');
s = s.replace("'assets/fbplayer_opt.glb'", "'data:model/gltf-binary;base64," + glb + "'");
s = s.replace("'assets/env.hdr'", "'data:application/octet-stream;base64," + hdr + "'");

// ---- 4. three.js and its loaders, inline and in order (LAST) ---------------------
const LIBS = ['three.min.js', 'GLTFLoader.js', 'SkeletonUtils.js', 'RGBELoader.js'];
const libBlock = LIBS.map(f =>
  '<script>' + fs.readFileSync(path.join('vendor', f), 'utf8') + '</script>'
).join('\n');
s = s.replace(LIB_MARK, libBlock);

fs.writeFileSync(out, s);
console.log('wrote', out, size(Buffer.byteLength(s)),
  '| model', size(glb.length), '| hdr', size(hdr.length), '| fonts', size(fontCss.length));
