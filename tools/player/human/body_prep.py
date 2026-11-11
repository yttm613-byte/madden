"""Fits MakeHuman's CC0 body to the player's skeleton and bakes it to a distance field.

  python3 body_prep.py <mpfb data dir> <skins dir>

Reads rig_joints.json (the player's bind joints, written from ../rig.mjs). Writes
  head.json      the head and neck mesh with photographed skin detail (as prep.py did)
  body_sdf.bin.gz + body_sdf.json   signed distance to the posed body on a 4mm grid, x >= 0 half
MakeHuman ships Mixamo-named bones and skin weights for its mesh, and the player uses a
Mixamo skeleton, so each bone carries its share of the body onto the player's bone:
rotated to the bone's direction, stretched to its length, scaled across to player size.
Only data files are read; none of the add-on's code runs.
"""
import gzip, sys, json, numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree
D, SK = sys.argv[1].rstrip('/')+'/', sys.argv[2].rstrip('/')+'/'
EYE = np.array([0.0315, 1.766, 0.0735])
RJ = {k: np.array(v) for k, v in json.load(open('rig_joints.json')).items()}
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
# a football build: all muscle, a quarter of the way to the heavy frame
tgt('macrodetails/universal-male-young-maxmuscle-averageweight',0.75); tgt('macrodetails/universal-male-young-maxmuscle-maxweight',0.25)
tgt('macrodetails/african-male-young',0.5); tgt('macrodetails/caucasian-male-young',0.5)
rig=json.load(open(D+'rigs/standard/rig.mixamo.json'))['bones']
wts=json.load(open(D+'rigs/standard/weights.mixamo.json'))['weights']
def jp(spec):
    if spec['strategy']=='CUBE':
        ids=sorted({v-1 for gg,f in F if gg==spec['cube_name'] for v,_ in f}); return V[ids].mean(0)
    assert spec['strategy']=='MEAN', spec['strategy']
    return V[spec['vertex_indices']].mean(0)
H={b.split(':')[1]: jp(r['head']) for b,r in rig.items()}
T={b.split(':')[1]: jp(r['tail']) for b,r in rig.items()}
def centre(g):
    ids=sorted({v-1 for gg,f in F if gg==g for v,_ in f}); return V[ids].mean(0)
eL,eR=centre('helper-l-eye'),centre('helper-r-eye'); mid=(eL+eR)/2
bodyV=sorted({v-1 for g,f in F if g=='body' for v,_ in f})
S0=1.766/(mid[1]-V[bodyV][:,1].min())               # player size: feet on the ground, eyes at eye height
SH=2*EYE[0]/abs(eL[0]-eR[0])                         # the head: eyes on the player's eyes
CHILD={'Hips':'Spine','Spine':'Spine1','Spine1':'Spine2','Spine2':'Neck','Neck':'Head'}
for s in ['Left','Right']:
    CHILD.update({s+'Shoulder':s+'Arm',s+'Arm':s+'ForeArm',s+'ForeArm':s+'Hand',s+'Hand':s+'HandMiddle1',
                  s+'UpLeg':s+'Leg',s+'Leg':s+'Foot',s+'Foot':s+'ToeBase'})
    for f in ['Index','Middle','Ring','Pinky','Thumb']:
        for k in (1,2): CHILD[s+'Hand'+f+str(k)]=s+'Hand'+f+str(k+1)
WIDE={'Hips':1.04,'Spine':1.04,'Spine1':1.06,'Spine2':1.08}
def rot_between(a,b):
    a=a/np.linalg.norm(a); b=b/np.linalg.norm(b); v=np.cross(a,b); c=float(a@b)
    if np.linalg.norm(v)<1e-9: return np.eye(3)
    K=np.array([[0,-v[2],v[1]],[v[2],0,-v[0]],[-v[1],v[0],0]]); return np.eye(3)+K+K@K/(1+c)
XF={}
for b in H:
    if b=='Head':
        XF[b]=(np.eye(3)*SH, np.array([0,EYE[1],EYE[2]])-SH*mid); continue
    c=CHILD.get(b); par=b
    if c is None:                                     # end bones follow their parent's frame
        par=next((p for p,q in CHILD.items() if q==b), b); c=CHILD.get(par)
    if c is None or par not in RJ or c not in RJ:
        M=np.eye(3)*S0
    else:
        a=H[c]-H[par]; a2=RJ[c]-RJ[par]; u=a/np.linalg.norm(a)
        k=S0*WIDE.get(par,1.12 if 'Arm' in par else 1.06 if 'Leg' in par else 1.0)
        Sm=k*np.eye(3)+(np.linalg.norm(a2)/np.linalg.norm(a)-k)*np.outer(u,u)   # along the bone: its length; across: player size
        M=rot_between(a,a2)@Sm
    anchor=RJ.get(b, None)
    if anchor is None: M=np.eye(3)*S0; anchor=RJ['Hips']+S0*(H[b]-H['Hips'])
    XF[b]=(M, anchor-M@H[b])
names=[b.split(':')[1] for b in wts]; Wm=np.zeros((len(V),len(names)))
for k,(b,lst) in enumerate(wts.items()):
    idx=np.array([i for i,_ in lst]); Wm[idx,k]=np.array([x for _,x in lst])
bv=np.array(bodyV); tot=Wm.sum(1); ok=bv[tot[bv]>0.2]; bad=bv[tot[bv]<=0.2]
if len(bad):                                          # a few unweighted vertices (inside the mouth): follow their nearest neighbour
    _,nn=cKDTree(V[ok]).query(V[bad]); Wm[bad]=Wm[ok[nn]]
    print('unweighted vertices given their neighbour\'s weights:',len(bad),'y range',V[bad][:,1].min().round(2),V[bad][:,1].max().round(2))
Wm/=np.maximum(Wm.sum(1),1e-9)[:,None]
P=np.zeros_like(V)
for k,nm in enumerate(names):
    M,t=XF[nm]; P+=Wm[:,k:k+1]*(V@M.T+t)
body=[f for g,f in F if g=='body']
print('posed bbox',P[bv].min(0).round(3),P[bv].max(0).round(3))
for n in ['LeftArm','LeftForeArm','LeftHand','LeftUpLeg','LeftLeg','LeftFoot']: print(n,'target',RJ[n].round(3))

# ---- head.json: head and neck with photographed skin detail --------------------------------
keep=[f for f in body if all(P[v-1][1]>1.40 and abs(P[v-1][0])<0.15 for v,_ in f)]
uvOf={}
for f in keep:
    for v,t in f: uvOf.setdefault(v,t)
ids=sorted(uvOf); vm={v:i for i,v in enumerate(ids)}
def detail(idlist, uvlist, refmask):
    col=np.zeros((len(idlist),3))
    for name in ['young_african_male/young_darkskinned_male_diffuse.png','young_caucasian_male/young_lightskinned_male_diffuse.png']:
        im=np.asarray(Image.open(SK+name).convert('RGB').resize((1024,1024),Image.LANCZOS)).astype(float)/255
        lin=im**2.2; uv=VT[uvlist]
        px=np.clip((uv[:,0]*1023).round().astype(int),0,1023); py=np.clip(((1-uv[:,1])*1023).round().astype(int),0,1023)
        c=lin[py,px]; col+=0.5*c/np.median(c[refmask],axis=0)
    return np.clip(col,0.05,1.3)
face=np.array([P[v-1][1]>1.70 and P[v-1][2]>0.02 for v in ids])
col=detail(ids,[uvOf[v]-1 for v in ids],face)
tris=[]
for f in keep:
    a=[vm[v] for v,_ in f]
    for k in range(1,len(a)-1): tris+=[a[0],a[k],a[k+1]]
pos=P[[v-1 for v in ids]]
json.dump({'pos':[round(float(x),5) for x in pos.ravel()],'tris':tris,'col':[round(float(x),3) for x in col.ravel()]},open('head.json','w'))
print('head verts',len(ids),'tris',len(tris)//3)

# ---- skin detail colours for the whole body, looked up by position (arms use it) -------------
uvAll={}
for f in body:
    for v,t in f: uvAll.setdefault(v,t)
ia=sorted(uvAll); arm=np.array([P[v-1][0]>0.30 and P[v-1][1]>1.05 for v in ia])
ca=detail(ia,[uvAll[v]-1 for v in ia],arm)
sel=np.array([abs(P[v-1][0])>0.20 and P[v-1][1]>0.95 and P[v-1][1]<1.60 for v in ia])
json.dump({'pos':[round(float(x),4) for x in P[[v-1 for v in ia]][sel].ravel()],'col':[round(float(x),3) for x in ca[sel].ravel()]},open('arm_detail.json','w'))

# ---- distance field ---------------------------------------------------------------------------
h=0.004; lo=np.array([-0.64,-0.03,-0.27]); hi=np.array([0.64,1.74,0.31]); n=np.ceil((hi-lo)/h).astype(int)+1
TR=[]
for f in body:
    a=[v-1 for v,_ in f]
    for k in range(1,len(a)-1): TR.append([a[0],a[k],a[k+1]])
TR=np.array(TR); A=P[TR[:,0]]; Bv=P[TR[:,1]]; C=P[TR[:,2]]
hits=np.zeros((n[0],n[1],n[2]+1),dtype=np.int32)
jit=np.array([0.000137,0.000211])
for a,b,c in zip(A,Bv,C):
    mn=np.minimum(np.minimum(a,b),c); mx=np.maximum(np.maximum(a,b),c)
    i0=max(0,int(np.ceil((mn[0]-lo[0]-jit[0])/h))); i1=min(n[0]-1,int(np.floor((mx[0]-lo[0]-jit[0])/h)))
    j0=max(0,int(np.ceil((mn[1]-lo[1]-jit[1])/h))); j1=min(n[1]-1,int(np.floor((mx[1]-lo[1]-jit[1])/h)))
    if i1<i0 or j1<j0: continue
    X,Y=np.meshgrid(lo[0]+jit[0]+h*np.arange(i0,i1+1), lo[1]+jit[1]+h*np.arange(j0,j1+1), indexing='ij')
    d=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
    if abs(d)<1e-14: continue
    l1=((b[1]-c[1])*(X-c[0])+(c[0]-b[0])*(Y-c[1]))/d; l2=((c[1]-a[1])*(X-c[0])+(a[0]-c[0])*(Y-c[1]))/d; l3=1-l1-l2
    m=(l1>=0)&(l2>=0)&(l3>=0)
    if not m.any(): continue
    z=l1*a[2]+l2*b[2]+l3*c[2]; kz=np.clip(np.ceil((z-lo[2])/h).astype(int),0,n[2])
    ii,jj=np.nonzero(m); np.add.at(hits,(ii+i0,jj+j0,kz[m]),1)
inside=(np.cumsum(hits,axis=2)[:,:,:n[2]]%2)==1
inside=ndimage.median_filter(inside.astype(np.uint8),size=3).astype(bool)
dist=np.where(inside,-ndimage.distance_transform_edt(inside)*h+h/2, ndimage.distance_transform_edt(~inside)*h-h/2)
# exact distance near the surface: nearest of a dense sampling of the triangles
r=np.random.default_rng(1); area=0.5*np.linalg.norm(np.cross(Bv-A,C-A),axis=1)
cnt=np.maximum(1,(area/(0.0012**2)).astype(int)); tid=np.repeat(np.arange(len(TR)),cnt)
u=r.random(len(tid)); v=r.random(len(tid)); sw=u+v>1; u[sw]=1-u[sw]; v[sw]=1-v[sw]
pts=np.vstack([A[tid]+u[:,None]*(Bv[tid]-A[tid])+v[:,None]*(C[tid]-A[tid]), P[bv]])
tree=cKDTree(pts); band=np.abs(dist)<0.016; gi=np.argwhere(band)
dd,_=tree.query(lo+gi*h, workers=-1)
dist[band]=np.where(inside[band],-dd,dd)
dist=ndimage.gaussian_filter(dist,0.6)
i0=int(round((0-lo[0])/h))-2; half=dist[i0:]
q=np.clip(np.round(half/0.00001),-32000,32000).astype('<i2')      # 10 micron steps, clamped to +-0.32m
q=np.clip(q,-6000,6000)                                            # nothing asks further than 6cm
gzip.open('body_sdf.bin.gz','wb',6).write(q.tobytes(order='C'))
json.dump({'h':h,'lo':[float(lo[0]+i0*h),float(lo[1]),float(lo[2])],'n':[int(x) for x in half.shape],'unit':0.00001},open('body_sdf.json','w'))
print('grid',half.shape,'inside cells',int(inside.sum()),'surface samples',len(pts))
