"""Lists every fixed commentary line in index.html, with who says it (pbp or analyst)."""
import re, json, sys
src=open('../../index.html',encoding='utf8').read().split('\n')
a=next(i for i,l in enumerate(src) if 'const SCREAMS=' in l); b=next(i for i,l in enumerate(src) if i>a and l.startswith('  function commentate'))
end=next(i for i in range(b+1,len(src)) if src[i]=='  }')
lit=re.compile(r'"((?:[^"\\]|\\.)*)"|\'((?:[^\'\\]|\\.)*)\'')
out={}
def ok(t): return len(t)>=6 and ' ' in t.strip() and re.search(r'[a-z]',t) and not re.search(r'[<>{}=;]|\$\{|\\n',t) and len(t)<200
for i,l in enumerate(src):
    inblock = a<=i<=end
    if not inblock and not re.search(r'\b(say|color)\(',l): continue
    for m in lit.finditer(l):
        t=m.group(1) if m.group(1) is not None else m.group(2)
        t=re.sub(r'\\u([0-9a-fA-F]{4})', lambda q: chr(int(q.group(1),16)), t).replace("\\'","'").replace('\\"','"')
        if not re.match(r'[A-Z"\u2018\u201c]', t): continue
        if not (ok(t) or (inblock and t.isupper() and '!' in t)): continue
        pre=l[:m.start()]
        if not inblock:
            k=max(pre.rfind('say('),pre.rfind('color('))
            if k<0: continue
        who='analyst' if ('COLOR_' in pre.split('const')[-1] and inblock and 'COLOR_' in l[:60]) or pre.rfind('aside=')>max(pre.rfind('line='),pre.rfind('say(')) or pre.rfind('color(')>pre.rfind('say(') else 'pbp'
        out.setdefault(t,who)
# down-and-distance clips: same formula as downLine() in index.html
D=['First','Second','Third','Fourth']; N=['one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','long','goal']
for d in D:
    for n in N: out.setdefault(d+(' and goal.' if n=='goal' else ' and '+n+'.'),'pbp')
json.dump(out,open(sys.argv[1],'w',encoding='utf8'),ensure_ascii=False,indent=0)
print(len(out),'lines;',sum(1 for v in out.values() if v=='analyst'),'analyst')
