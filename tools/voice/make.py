"""Records the game's fixed commentary lines with free neural voices (Piper).

  python3 extract.py lines.json
  python3 make.py lines.json <dir with the two .onnx voices> ../../assets/voice

Voices: en_US-joe-medium (play-by-play, CC0) and en_US-bryce-medium (analyst, public
domain), from huggingface.co/rhasspy/piper-voices. Needs `pip install piper-tts` and ffmpeg.
Writes one small mp3 per line and manifest.json (line text -> file).
"""
import tempfile, json, sys, os, re, wave, subprocess, hashlib
from piper import PiperVoice, SynthesisConfig
TMPW=os.path.join(tempfile.gettempdir(),'_v.wav'); FF=os.environ.get('FFMPEG','ffmpeg')
lines=json.load(open(sys.argv[1],encoding='utf8')); vdir=sys.argv[2]; out=sys.argv[3]; os.makedirs(out,exist_ok=True)
V={'pbp':PiperVoice.load(os.path.join(vdir,'en_US-joe-medium.onnx'))}
if os.path.exists(os.path.join(vdir,'en_US-bryce-medium.onnx')): V['analyst']=PiperVoice.load(os.path.join(vdir,'en_US-bryce-medium.onnx'))
# NEW_ONLY=1: record only lines with no clip yet and merge into the existing manifest (a missing voice just skips its lines)
mf=os.path.join(out,'manifest.json'); old=json.load(open(mf,encoding='utf8')) if os.path.exists(mf) else {}
if os.environ.get('NEW_ONLY'): lines={t:w for t,w in lines.items() if t not in old and w in V}
def spoken(t):
    # the engine spells out words in capitals; say them, and let the punctuation carry the shout
    t=re.sub(r"[A-Z][A-Z']{2,}", lambda m: m.group(0).capitalize(), t)
    return t.replace('—',', ').replace('–',', ').replace('…','...').replace('CPU','C P U')
man=dict(old) if os.environ.get('NEW_ONLY') else {}; total=0
for i,(text,who) in enumerate(lines.items()):
    hype=text.count('!')>=1; big=text.isupper() or text.count('!')>=2
    cfg=SynthesisConfig(length_scale=(0.80 if big else 0.86 if hype else 0.90) if who=='pbp' else (0.96 if hype else 1.0), noise_scale=0.85 if hype else 0.7, noise_w_scale=1.0 if hype else 0.8)
    name=('p' if who=='pbp' else 'a')+hashlib.md5(text.encode()).hexdigest()[:8]+'.mp3'
    with wave.open(TMPW,'wb') as w: V[who].synthesize_wav(spoken(text), w, syn_config=cfg)
    # a shouted line: a little higher and quicker, and louder; everything trimmed and levelled
    af=('asetrate=22050*%s,aresample=22050,'%('1.06' if big else '1.03') if hype and who=='pbp' else '')+'highpass=f=90,equalizer=f=140:t=q:w=1:g=3,equalizer=f=3200:t=q:w=1.2:g=2.5,acompressor=threshold=-21dB:ratio=3.5:attack=4:release=90:makeup=3,silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,loudnorm=I=-16:TP=-1.5:LRA=9'
    subprocess.run([FF,'-v','error','-y','-i',TMPW,'-af',af,'-ac','1','-ar','22050','-b:a','32k',os.path.join(out,name)],check=True)
    man[text]=name; total+=os.path.getsize(os.path.join(out,name))
json.dump(man,open(os.path.join(out,'manifest.json'),'w',encoding='utf8'),ensure_ascii=False,indent=0)
print(len(man),'clips',round(total/1e6,2),'MB')
