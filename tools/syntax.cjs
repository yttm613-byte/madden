/* syntax.cjs — extract the game's main <script> from index.html and node --check it.
 * Catches parse errors without needing a browser. */
const fs=require('fs'), cp=require('child_process');
const src=fs.readFileSync('index.html','utf8');
const i=src.lastIndexOf('<script>'), j=src.lastIndexOf('</script>');
if(i<0||j<0){ console.error('script block not found'); process.exit(1); }
const body=src.slice(i+8,j);
fs.writeFileSync('/tmp/gb-check.js', body);
try{ cp.execSync('node --check /tmp/gb-check.js',{stdio:'pipe'}); console.log('syntax OK ('+body.split('\n').length+' lines)'); }
catch(e){ console.error('SYNTAX ERROR\n'+e.stderr.toString()); process.exit(1); }
