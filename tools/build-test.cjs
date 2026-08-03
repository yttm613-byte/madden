/* build-test.cjs — regenerate index.test.html / index.sim.html from index.html.
 * These are gitignored debug builds: identical to the shipped game plus one line
 * that exposes internals to the Playwright harnesses. Keeping the generation in a
 * script means the hooks can't silently drift out of date with the game. */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const ANCHOR = '  newGame(); G.phase=\'start\';';
if (!src.includes(ANCHOR)) { console.error('anchor not found in index.html'); process.exit(1); }

const TEST = `  window.__gb={get G(){return G;},get ready(){return playersReady;},get pool(){return pPool;},get scene(){return scene;},get camera(){return camera;},get renderer(){return renderer;},startFG,startKick,fgLock,choosePlay,snap,action,setupPlay,juke,recordFrame,startReplay,stopReplay,cycleQuality,toggleFullscreen,startConversion,tryFumble,startPossession,get q(){return qKey;}};\n`;
const SIM = `  window.__sim={ get G(){return G;}, update, keys, choosePlay, action, snap, chooseDef,\n    startFG, startKick, startKickoff, fgLock, juke, spin, get ready(){return playersReady;}, get pool(){return pPool;} };\n`;

fs.writeFileSync('index.test.html', src.replace(ANCHOR, TEST + ANCHOR));
fs.writeFileSync('index.sim.html',  src.replace(ANCHOR, SIM  + ANCHOR));
console.log('wrote index.test.html, index.sim.html');
