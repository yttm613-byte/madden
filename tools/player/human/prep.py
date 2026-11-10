"""Builds the player's real head from MakeHuman's CC0 data.

Inputs (not committed; see README.md here): MakeHuman base mesh + shape targets
(from the MPFB add-on's data folder) and two CC0 skin photographs. No add-on code runs.
Output: head.json — positions in the player's space, triangles, and a per-vertex
skin DETAIL colour (photo / its own average), which the game multiplies by each
player's skin tone. So one head serves every skin tone and needs no texture in the game.

  python3 prep.py <mpfb data dir> <skins dir> head.json
"""
import gzip, sys, json, numpy as np
from PIL import Image
D, SK, OUT = sys.argv[1].rstrip('/')+'/', sys.argv[2].rstrip('/')+'/', sys.argv[3]
EYE = np.array([0.0315, 1.766, 0.0735])          # tools/player/body.mjs EYE (left eye centre)
V=[];VT=[];F=[];grp=None
for ln in open(D+'3dobjs/base.obj'):
    p=ln.split()
    if not p: continue
    if p[0]=='v': V.append([float(x) for x in p[1:4]])
    elif p[0]=='vt': VT.append([float(x) for x in p[1:3]])
    elif p[0]=='g': grp=p[1]
    elif p[0]=='f': F.append((grp,[tuple(int(a) for a in q.split('/')[:2]) for q in p[1:]]))
V=np.array(V); VT=np.array(VT)
def tgt(name,w):
    for ln in gzip.open(D+'targets/'+name+'.target.gz','rt'):
        p=ln.split()
        if len(p)==4 and p[0][0]!='#': V[int(p[0])]+=w*np.array([float(p[1]),float(p[2]),float(p[3])])
tgt('macrodetails/universal-male-young-maxmuscle-averageweight',1.0)
tgt('macrodetails/african-male-young',0.5); tgt('macrodetails/caucasian-male-young',0.5)
def centre(g):
    ids=sorted({v-1 for gg,f in F if gg==g for v,_ in f}); return V[ids].mean(0)
eL,eR=centre('helper-l-eye'),centre('helper-r-eye')
if eL[0]<eR[0]: eL,eR=eR,eL
s=2*EYE[0]/abs(eL[0]-eR[0]); mid=(eL+eR)/2
P=(V-mid)*s+np.array([0,EYE[1],EYE[2]])
print('scale',s,'eye L after',(eL-mid)*s+np.array([0,EYE[1],EYE[2]]))
body=[f for g,f in F if g=='body']
# keep the head and neck column only
keep=[f for f in body if all(P[v-1][1]>1.40 and abs(P[v-1][0])<0.15 for v,_ in f)]
# per-vertex detail colour: both photographs, each divided by its own skin average
uvOf={}
for f in keep:
    for v,t in f: uvOf.setdefault(v,t)
ids=sorted(uvOf); vm={v:i for i,v in enumerate(ids)}
col=np.zeros((len(ids),3))
for name in ['young_african_male/young_darkskinned_male_diffuse.png','young_caucasian_male/young_lightskinned_male_diffuse.png']:
    im=np.asarray(Image.open(SK+name).convert('RGB').resize((1024,1024),Image.LANCZOS)).astype(float)/255
    lin=im**2.2
    uv=VT[[uvOf[v]-1 for v in ids]]
    px=np.clip((uv[:,0]*1023).round().astype(int),0,1023); py=np.clip(((1-uv[:,1])*1023).round().astype(int),0,1023)
    c=lin[py,px]
    face=np.array([P[v-1][1]>1.70 and P[v-1][2]>0.02 for v in ids])
    c=c/np.median(c[face],axis=0)
    col+=0.5*c
col=np.clip(col,0.05,1.3)
tris=[]
for f in keep:
    a=[vm[v] for v,_ in f]
    for k in range(1,len(a)-1): tris+= [a[0],a[k],a[k+1]]
pos=P[[v-1 for v in ids]]
print('verts',len(ids),'tris',len(tris)//3,'bbox',pos.min(0).round(3),pos.max(0).round(3))
json.dump({'pos':[round(float(x),5) for x in pos.ravel()],'tris':tris,'col':[round(float(x),3) for x in col.ravel()]},open(OUT,'w'))
