/* build-test.cjs — regenerate index.test.html / index.sim.html from index.html.
 * These are gitignored debug builds: identical to the shipped game plus one line
 * that exposes internals to the Playwright harnesses. Keeping the generation in a
 * script means the hooks can't silently drift out of date with the game. */
const fs = require('fs');
const src = fs.readFileSync('index.html', 'utf8');
const ANCHOR = '  newGame(); G.phase=\'start\';';
if (!src.includes(ANCHOR)) { console.error('anchor not found in index.html'); process.exit(1); }

const TEST = `  window.__gbToss=window.__gbToss||'user'; window.__gb={get G(){return G;},get ready(){return playersReady;},get pool(){return pPool;},get scene(){return scene;},get camera(){return camera;},get ballMesh(){return ballMesh;},get renderer(){return renderer;},startFG,startKick,fgLock,choosePlay,snap,action,setupPlay,juke,recordFrame,startReplay,stopReplay,cycleQuality,toggleFullscreen,startConversion,tryFumble,startPossession,update,keys,render3D,gameOver,showTeam,myTeam,startTwoPlayer,startPractice,chooseDef,endIntro,togglePause,fgYards,setAct:(t)=>{ACT=t;},get TWO_P(){return TWO_P;},get PRACTICE(){return PRACTICE;},throwBall,swatBall,stiffArm,carrierDive,releaseThrow,pollPad,padBar,togglePause,get PAD(){return PAD;},get q(){return qKey;}};\n`;
// The sim build is for harnesses that step the game themselves: it never draws a frame,
// makes no sound and speaks no commentary. Software-rendering the scene and synthesising
// the crowd between a harness's calls was most of the CPU a long run used.
const SIM = `  window.__gbNoDraw=true; window.__gbRatings=window.__gbRatings||'neutral'; window.__gbWeather=window.__gbWeather||'clear'; window.__gbNoIntro=true; window.__gbNoTips=true; try{ window.AudioContext=undefined; window.webkitAudioContext=undefined; Object.defineProperty(window,'speechSynthesis',{value:undefined,configurable:true}); }catch(e){}\n  window.__sim={ get G(){return G;}, update, keys, choosePlay, action, snap, chooseDef,\n    startFG, startKick, startKickoff, startConversion, fgLock, juke, spin, setupPlay, startPossession, endPlay, startPunt, callTimeout, throwBall, swatBall, stiffArm, carrierDive, releaseThrow, makeRoster, rateUp, get ready(){return playersReady;}, get pool(){return pPool;} };\n`;

fs.writeFileSync('index.test.html', src.replace(ANCHOR, TEST + ANCHOR));
fs.writeFileSync('index.sim.html',  src.replace(ANCHOR, SIM  + ANCHOR));
console.log('wrote index.test.html, index.sim.html');
