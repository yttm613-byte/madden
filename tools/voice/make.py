"""Records the game's fixed commentary lines with free neural voices (Piper).

  python3 extract.py lines.json
  python3 make.py lines.json <dir with the two .onnx voices> ../../assets/voice

Voices: en_US-joe-medium (play-by-play, CC0) and en_US-bryce-medium (analyst, public
domain), from huggingface.co/rhasspy/piper-voices. Needs `pip install piper-tts` and ffmpeg.
Writes one small mp3 per line and manifest.json (line text -> file).
"""
import json, sys, os, re, wave, subprocess, hashlib
from piper import PiperVoice, SynthesisConfig
lines=json.load(open(sys.argv[1],encoding='utf8')); vdir=sys.argv[2]; out=sys.argv[3]; os.makedirs(out,exist_ok=True)
V={'pbp':PiperVoice.load(os.path.join(vdir,'en_US-joe-medium.onnx')),'analyst':PiperVoice.load(os.path.join(vdir,'en_US-bryce-medium.onnx'))}
def spoken(t):
    # the engine spells out words in capitals; say them, and let the punctuation carry the shout
    t=re.sub(r"[A-Z][A-Z']{2,}", lambda m: m.group(0).capitalize(), t)
    return t.replace('—',', ').replace('–',', ').replace('…','...').replace('CPU','C P U')
man={}; total=0
for i,(text,who) in enumerate(lines.items()):
    hype=text.count('!')>=1; big=text.isupper() or text.count('!')>=2
    cfg=SynthesisConfig(length_scale=(0.86 if hype else 0.93) if who=='pbp' else 1.0, noise_scale=0.75 if hype else 0.6, noise_w_scale=0.9 if hype else 0.7)
    name=('p' if who=='pbp' else 'a')+hashlib.md5(text.encode()).hexdigest()[:8]+'.mp3'
    with wave.open('/tmp/_v.wav','wb') as w: V[who].synthesize_wav(spoken(text), w, syn_config=cfg)
    # a shouted line: a little higher and quicker, and louder; everything trimmed and levelled
    af=('asetrate=22050*%s,aresample=22050,'%('1.06' if big else '1.03') if hype and who=='pbp' else '')+'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,loudnorm=I=-16:TP=-1.5:LRA=9'
    subprocess.run(['ffmpeg','-v','error','-y','-i','/tmp/_v.wav','-af',af,'-ac','1','-ar','22050','-b:a','32k',os.path.join(out,name)],check=True)
    man[text]=name; total+=os.path.getsize(os.path.join(out,name))
json.dump(man,open(os.path.join(out,'manifest.json'),'w',encoding='utf8'),ensure_ascii=False,indent=0)
print(len(man),'clips',round(total/1e6,2),'MB')
