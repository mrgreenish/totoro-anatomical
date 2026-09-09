"""Authored human-inspired heart, matched UV bakes, and shared lumen landmarks.

Blender background: --python scripts/build-heart-detail.py
The outer wall, vascular paths and inner chambers share one coordinate system.
No scan or patient data is used. Geometry is exported before preview materials.
"""
import bpy, bmesh, json, math, os
import numpy as np
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'artwork/anatomy/heart-detail'
OUT = ROOT / 'public/models/heart-detail'
ART.mkdir(parents=True, exist_ok=True); OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
rng = np.random.default_rng(731)
objects = []

def noise(x,y,z):
    def h(a,b,c): return np.mod(np.sin(a*127.1+b*311.7+c*74.7)*43758.5453,1)
    i,j,k=np.floor(x),np.floor(y),np.floor(z)
    a,b,c=x-i,y-j,z-k
    a=a*a*(3-2*a);b=b*b*(3-2*b);c=c*c*(3-2*c)
    lo=(h(i,j,k)*(1-a)+h(i+1,j,k)*a)*(1-b)+(h(i,j+1,k)*(1-a)+h(i+1,j+1,k)*a)*b
    hi=(h(i,j,k+1)*(1-a)+h(i+1,j,k+1)*a)*(1-b)+(h(i,j+1,k+1)*(1-a)+h(i+1,j+1,k+1)*a)*b
    return lo*(1-c)+hi*c

def delta(a,b): return np.arctan2(np.sin(a-b),np.cos(a-b))

def surface(u,v):
    t=u*math.tau; ph=v*np.pi
    radius=np.maximum(0,np.sin(ph))**.87*(1-.28*v)*1.14
    lad=1.16+.48*v; pda=-1.27-.16*v
    coronary=.245+.027*np.sin(t-.3)
    g1=np.exp(-(delta(t,lad)/.062)**2)*np.clip((v-.20)*14,0,1)
    g2=np.exp(-(delta(t,pda)/.067)**2)*np.clip((v-.23)*12,0,1)
    g3=np.exp(-((v-coronary)/.023)**2)
    groove=.036*g1+.025*g2+.034*g3
    r=radius-groove
    # Broad anterior RV, a rounder LV/obtuse margin, and a left-pointing apex.
    x=-.105+.46*v**1.7 + .63*r*np.cos(t)*(1+.075*np.cos(t))
    y=.46-1.35*v+.08*np.sin(ph)+.025*radius*np.cos(t)
    z=.008+.055*v + .385*r*np.sin(t)*(1+.12*np.maximum(-np.cos(t),0))
    z+=.04*radius*np.maximum(np.sin(t),0)*np.maximum(-np.cos(t),0)
    fine=noise(x*14,y*14,z*14)-.5
    x+=radius*.0025*fine*np.cos(t);z+=radius*.0025*fine*np.sin(t)
    fat1=np.exp(-(delta(t,lad)/(.095+.034*noise(t*8,v*26,0)))**2)*np.clip((.96-v)*12,0,1)
    fat2=.8*np.exp(-(delta(t,pda)/.11)**2)
    fat3=np.exp(-((v-coronary)/(.040+.010*np.sin(t*7)))**2)
    fat=np.clip(np.maximum(np.maximum(fat1,fat2),fat3),0,1)
    return np.stack(np.broadcast_arrays(x,y,z),axis=-1),fat,np.maximum(np.maximum(g1,g2),g3)

def surface_path(uv,lift=0):
    uv=np.asarray(uv);u=uv[:,0]/math.tau;v=uv[:,1]
    p=surface(u,v)[0]
    du=surface(u+.0001,v)[0]-surface(u-.0001,v)[0]
    dv=surface(u,v+.0001)[0]-surface(u,v-.0001)[0]
    n=np.cross(du,dv);n/=np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-8)
    outward=np.stack([np.cos(uv[:,0]),np.zeros(len(uv)),np.sin(uv[:,0])],axis=1)
    n*=np.where(np.sum(n*outward,axis=1,keepdims=True)<0,-1,1)
    return p+n*np.asarray(lift).reshape(-1,1) if np.ndim(lift) else p+n*lift

def material(name,color,rough=.34):
    m=bpy.data.materials.new('Heart_'+name);m.diffuse_color=(*color,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=rough;p.inputs['Coat Weight'].default_value=.62
    p.inputs['Coat Roughness'].default_value=.16;p.inputs['IOR'].default_value=1.38
    p.inputs['Subsurface Weight'].default_value=.065;p.inputs['Subsurface Radius'].default_value=(.06,.023,.015)
    return m

mats={k:material(k,c,r) for k,c,r in [
    ('myocardium',(.24,.048,.041),.36),('atrium',(.27,.065,.057),.37),
    ('aorta',(.43,.18,.13),.36),('pulmonary',(.28,.16,.16),.34),
    ('vena_cava',(.16,.095,.11),.31),('coronary_artery',(.28,.027,.024),.30),
    ('coronary_vein',(.105,.038,.052),.30),('fat',(.61,.42,.19),.43),
    ('endocardium',(.40,.16,.12),.31),('valve',(.72,.53,.36),.4),('chordae',(.7,.53,.36),.4)]}

def mesh_object(name,verts,faces,kind,uvs=None,internal=False):
    vertices=np.asarray(verts)
    data=bpy.data.meshes.new(name)
    data.from_pydata(np.stack([vertices[:,0],-vertices[:,2],vertices[:,1]],axis=1).tolist(),[],faces);data.update()
    ob=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(ob);objects.append(ob)
    data.materials.append(mats[kind]);ob['tissue']=kind;ob['internal']=internal
    if uvs is not None:
        uv=data.uv_layers.new(name='TissueUV')
        for f in data.polygons:
            for li in f.loop_indices:uv.data[li].uv=uvs[data.loops[li].vertex_index]
    for f in data.polygons:f.use_smooth=True
    return ob

def grid(n,m):
    return [(j*(n+1)+i,j*(n+1)+i+1,(j+1)*(n+1)+i+1,(j+1)*(n+1)+i) for j in range(m) for i in range(n)]

def ellipsoid(name,center,scale,kind,n=64,m=44,internal=False,auricle=False):
    u,v=np.meshgrid(np.linspace(0,1,n+1),np.linspace(0,1,m+1));t=u*math.tau;ph=v*np.pi
    wrinkle=1+(.065*np.sin(t*9+ph*6)*np.sin(ph)**2 if auricle else 0)
    p=np.stack([np.sin(ph)*np.cos(t)*scale[0]*wrinkle+center[0],np.cos(ph)*scale[1]+center[1],np.sin(ph)*np.sin(t)*scale[2]*wrinkle+center[2]],axis=-1)
    uv=np.stack([u*.24+.005,(1-v)*.26+.01],axis=-1).reshape(-1,2)
    return mesh_object(name,p.reshape(-1,3),grid(n,m),kind,uv,internal)

n,m=256,160
u,v=np.meshgrid(np.linspace(0,1,n+1),np.linspace(0,1,m+1))
uv=np.stack([u,.28+(1-v)*.72],axis=-1).reshape(-1,2)
mesh_object('Ventricular_epicardium',surface(u,v)[0].reshape(-1,3),grid(n,m),'myocardium',uv)
ellipsoid('Right_atrium',[-.43,.29,.015],[.25,.265,.23],'atrium',96,64)
ellipsoid('Left_atrium',[.23,.34,-.20],[.27,.235,.225],'atrium',96,64)
ellipsoid('Right_auricular_appendage',[-.32,.38,.245],[.20,.15,.11],'atrium',80,44,auricle=True)
ellipsoid('Left_auricular_appendage',[.37,.40,.13],[.19,.11,.095],'atrium',80,44,auricle=True)

def spline(points,count=80):
    p=np.asarray(points,dtype=float);t=np.linspace(0,len(p)-1,count)
    i=np.minimum(t.astype(int),len(p)-2);f=(t-i)[:,None]
    a=p[np.maximum(i-1,0)];b=p[i];c=p[i+1];d=p[np.minimum(i+2,len(p)-1)]
    return .5*((2*b)+(-a+c)*f+(2*a-5*b+4*c-d)*f*f+(-a+3*b-3*c+d)*f*f*f)

def tube(name,points,radii,kind,sides=12,hollow=False,internal=False):
    points=np.asarray(points);radii=np.broadcast_to(radii,(len(points),));verts=[];uv=[];faces=[]
    tangents=np.gradient(points,axis=0);tangents/=np.linalg.norm(tangents,axis=1,keepdims=True)
    # Parallel transport prevents rings twisting at curved vessel junctions.
    a=np.cross(tangents[0],[0,0,1]);a/=max(np.linalg.norm(a),1e-6)
    frames=[]
    for i,t in enumerate(tangents):
        a=a-np.dot(a,t)*t;a/=max(np.linalg.norm(a),1e-6);b=np.cross(t,a);frames.append((a.copy(),b.copy()))
    layers=2 if hollow else 1
    for layer in range(layers):
        for i,p in enumerate(points):
            a,b=frames[i];r=radii[i]*(.78 if layer else 1)
            for k in range(sides+1):
                t=k/sides*math.tau
                # Small connective ridges continue around the opening.
                rr=r*(1+.015*math.sin(t*5+i*.24))
                verts.append(p+(a*math.cos(t)+b*math.sin(t))*rr)
                uv.append([.51+.23*k/sides,.014+.24*i/(len(points)-1)])
        offset=layer*len(points)*(sides+1)
        for f in grid(sides,len(points)-1):faces.append(tuple(offset+k for k in (f[::-1] if layer else f)))
    if hollow:
        total=len(points)*(sides+1)
        for end in [0,len(points)-1]:
            base=end*(sides+1)
            for k in range(sides):faces.append((base+k,base+k+1,base+k+1+total,base+k+total))
    else:
        faces.extend([tuple(range(sides-1,-1,-1)),tuple((len(points)-1)*(sides+1)+k for k in range(sides))])
    ob=mesh_object(name,verts,faces,kind,uv,internal)
    return ob

vessels={
 'aorta':{'points':[[-.055,.28,-.025],[-.12,.55,.045],[-.10,.82,.015],[.12,.99,-.10],[.37,.87,-.255],[.40,.57,-.29],[.38,.38,-.29]],'radius':[.125,.121,.116,.112,.105,.096,.091],'kind':'aorta'},
 'pulmonary_trunk':{'points':[[-.18,-.025,.145],[-.045,.34,.265],[.06,.56,.255],[.18,.69,.13],[.30,.68,-.03]],'radius':[.122,.118,.106,.098,.083],'kind':'pulmonary'},
 'left_pulmonary_artery':{'points':[[.18,.66,.15],[.36,.68,.01],[.54,.64,-.13],[.65,.59,-.19]],'radius':[.088,.081,.073,.067],'kind':'pulmonary'},
 'right_pulmonary_artery':{'points':[[.18,.68,.11],[.08,.69,-.14],[-.22,.61,-.23],[-.48,.56,-.24]],'radius':[.079,.075,.071,.064],'kind':'pulmonary'},
 'superior_vena_cava':{'points':[[-.44,.24,-.01],[-.48,.46,-.015],[-.49,.68,-.035],[-.46,.83,-.07]],'radius':[.115,.109,.096,.089],'kind':'vena_cava'},
 'inferior_vena_cava':{'points':[[-.39,.23,-.08],[-.48,.05,-.12],[-.47,-.14,-.22]],'radius':[.107,.103,.098],'kind':'vena_cava'},
}
for name,p,r in [('brachiocephalic',[[-.095,.78,.0],[-.17,1.01,.02],[-.24,1.16,.0]],[.061,.052,.045]),('left_common_carotid',[[.065,.935,-.065],[.09,1.13,-.04],[.11,1.23,-.055]],[.039,.034,.030]),('left_subclavian',[[.24,.943,-.155],[.32,1.095,-.16],[.43,1.18,-.22]],[.042,.037,.032])]:
    vessels[name]={'points':p,'radius':r,'kind':'aorta'}
for side in [-1,1]:
    for level in [0,1]:
        x=.22+side*.22;y=.28+level*.16
        vessels[f'pulmonary_vein_{side}_{level}']={'points':[[x,y,-.20],[x+side*.10,y+.035,-.34],[x+side*.19,y+.025,-.43]],'radius':[.064,.060,.054],'kind':'vena_cava'}
for name,data in vessels.items():
    points=spline(data['points'],72 if name=='aorta' else 48)
    radii=np.interp(np.linspace(0,1,len(points)),np.linspace(0,1,len(data['radius'])),data['radius'])
    tube(name,points,radii,data['kind'],40,True)

# Coronary vessels: anatomically placed main trunks, then tapering branches.
coronaries=[]
vv=np.linspace(.24,.94,120)
coronaries.append(('LAD',np.stack([1.16+.48*vv,vv],axis=1),.016,'coronary_artery'))
coronaries.append(('Great_cardiac_vein',np.stack([1.26+.48*vv,vv],axis=1),.012,'coronary_vein'))
tt=np.linspace(1.55,4.35,150)
coronaries.append(('Right_coronary',np.stack([tt,.244+.027*np.sin(tt-.3)],axis=1),.014,'coronary_artery'))
tt=np.linspace(1.15,-2.0,145)
coronaries.append(('Circumflex',np.stack([tt,.25+.027*np.sin(tt-.3)],axis=1),.014,'coronary_artery'))
vv=np.linspace(.25,.89,100)
coronaries.append(('Posterior_descending',np.stack([-1.27-.16*vv,vv],axis=1),.012,'coronary_artery'))
tt=np.linspace(-.35,-2.7,110)
coronaries.append(('Coronary_sinus',np.stack([tt,.207+.02*np.sin(tt)],axis=1),.017,'coronary_vein'))
for j in range(6):
    start=.33+j*.082;f=np.linspace(0,1,60)
    for side in [-1,1]:
        t=1.16+.48*start+side*(.50+.18*j/6)*f+.04*np.sin(f*4)
        v=start+(.23-.07*j/6)*f
        coronaries.append((f'Diagonal_{j}_{side}',np.stack([t,v],axis=1),.0085-j*.0007,'coronary_artery'))
for j in range(8):
    start=2+j*.52;f=np.linspace(0,1,65)
    coronaries.append((f'Marginal_{j}',np.stack([start+.26*f,.255+.50*f],axis=1),.008,'coronary_artery'))
    coronaries.append((f'Venous_return_{j}',np.stack([start+.08+.31*f,.26+.52*f],axis=1),.006,'coronary_vein'))
for name,path,r,kind in list(coronaries):
    radii=np.linspace(r,r*.17,len(path));tube(name,surface_path(path,radii*.46+.002),radii,kind,10)
    if name.startswith(('Diagonal','Marginal')):
        for j in [0,1]:
            k=22+j*16;f=np.linspace(0,1,28)
            pp=path[k]+np.stack([(.19 if j else -.20)*f,.095*f],axis=1)
            rr=np.linspace(r*.43,.00065,len(pp));tube(name+'_twig_'+str(j),surface_path(pp,rr*.5+.001),rr,kind,7)

# Fat is shallow and seated in sulci; broad color comes from the matched bake.
for j in range(82):
    if j<48:
        v=rng.uniform(.26,.84);t=(1.16+.48*v if j%2 else -1.27-.16*v)+rng.normal(0,.075)
    else:
        t=rng.uniform(-math.pi,math.pi);v=.245+.027*math.sin(t-.3)+rng.normal(0,.024)
    p=surface_path([[t,v]],-.001)[0]
    r=rng.uniform(.015,.034)
    tangent=np.array([-math.sin(t),0,math.cos(t)]);normal=np.array([math.cos(t),0,math.sin(t)])
    u,vv=np.meshgrid(np.linspace(0,1,13),np.linspace(0,1,9));tt=u*math.tau;ph=vv*np.pi
    verts=p+np.sin(ph)[:,:,None]*np.cos(tt)[:,:,None]*tangent*r
    verts+=np.cos(ph)[:,:,None]*np.array([0,1,0])*r*.70
    verts+=np.sin(ph)[:,:,None]*np.sin(tt)[:,:,None]*normal*.004
    uv=np.stack([u*.23+.76,(1-vv)*.26+.01],axis=-1).reshape(-1,2)
    mesh_object('Epicardial_fat_'+str(j),verts.reshape(-1,3),grid(12,8),'fat',uv)

chambers={
 'right_atrium':{'center':[-.43,.29,.015],'scale':[.188,.204,.169],'side':0},
 'right_ventricle':{'center':[-.205,-.15,.18],'scale':[.245,.365,.144],'side':0},
 'left_atrium':{'center':[.23,.34,-.20],'scale':[.204,.169,.162],'side':1},
 'left_ventricle':{'center':[.20,-.275,-.008],'scale':[.235,.437,.219],'side':1},
}
for name,data in chambers.items():
    ob=ellipsoid('Endocardium_'+name,data['center'],data['scale'],'endocardium',64,48,True)
    ob['chamber']=name
    # Fine ridges within the ventricles remain visible in the translucent study.
    if 'ventricle' in name:
        c=np.array(data['center']);s=np.array(data['scale'])
        for j in range(18):
            t=j/18*math.tau;ph=np.linspace(.65,2.75,40)
            pp=c+np.stack([np.sin(ph)*np.cos(t+.11*np.sin(ph*5))*s[0],np.cos(ph)*s[1],np.sin(ph)*np.sin(t+.11*np.sin(ph*5))*s[2]],axis=1)*.96
            tube('Trabecula_'+name+str(j),pp,np.sin(np.linspace(0,np.pi,40))*.007+.001,'endocardium',6,internal=True)

valves={
 'tricuspid':{'center':[-.32,.125,.125],'radius':.112,'leaflets':3,'gate':'av','side':0},
 'mitral':{'center':[.225,.135,-.10],'radius':.105,'leaflets':2,'gate':'av','side':1},
 'pulmonary':{'center':[-.065,.33,.261],'radius':.086,'leaflets':3,'gate':'out','side':0},
 'aortic':{'center':[-.06,.355,-.01],'radius':.092,'leaflets':3,'gate':'out','side':1},
}
for name,d in valves.items():
    c=np.array(d['center']);r=d['radius']
    for leaflet in range(d['leaflets']):
        verts=[];uv=[]
        for j in range(9):
            f=j/8
            for k in range(21):
                t=(leaflet+k/20)/d['leaflets']*math.tau
                rr=r*(1-f*.93)
                verts.append(c+[rr*math.cos(t),-.026*math.sin(f*math.pi),rr*math.sin(t)])
                uv.append([.76+k/20*.23,.01+f*.25])
        ob=mesh_object('Valve_'+name+'_'+str(leaflet),verts,grid(20,8),'valve',uv,True)
        ob['valve']=name;ob['leaflet']=leaflet
    if d['gate']=='av':
        for j in range(12):
            t=j/12*math.tau
            tip=c+np.array([math.cos(t)*r*.65,-.055,math.sin(t)*r*.65])
            foot=c+np.array([math.cos(t)*r*.55,-.23,math.sin(t)*r*.55])
            tube('Chordae_'+name+str(j),spline([foot,(tip+foot)/2+[0,0,.008],tip],15),.0017,'chordae',5,internal=True)

# Weld duplicate poles/seams, keeping UV seams on face corners.
for ob in objects:
    bm=bmesh.new();bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.0000005)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free();ob.data.update()
bpy.ops.object.select_all(action='DESELECT')
for ob in objects:ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ART/'heart-detail-raw.glb'),export_format='GLB',use_selection=True,export_yup=True,export_extras=True)
(OUT/'anatomy.json').write_text(json.dumps({'vessels':vessels,'chambers':chambers,'valves':valves},separators=(',',':')))

def save_image(name,data):
    h,w=data.shape[:2];rgba=np.ones((h,w,4),np.float32);rgba[:,:,:3]=data if data.ndim==3 else data[:,:,None]
    im=bpy.data.images.new(name,width=w,height=h,float_buffer=True);im.colorspace_settings.name='Non-Color'
    im.pixels.foreach_set(rgba.ravel());im.filepath_raw=str(ART/(name+'.png'));im.file_format='PNG'
    bpy.context.scene.render.image_settings.color_depth='8';bpy.context.scene.render.image_settings.color_mode='RGB'
    im.save_render(str(ART/(name+'.png')),scene=bpy.context.scene);bpy.data.images.remove(im)

source=bpy.data.images.load(str(ART/'tissue-source.png'));source.colorspace_settings.name='Non-Color'
sw,sh=source.size;pixels=np.empty(sw*sh*4,np.float32);source.pixels.foreach_get(pixels);pixels=pixels.reshape(sh,sw,4)[:,:,:3]
bpy.context.scene.view_settings.view_transform='Raw'
for size in [2048,4096]:
    color=np.empty((size,size,3),np.float32);height=np.empty((size,size),np.float32)
    surface_map=np.empty((size,size,3),np.float32)
    for row in range(0,size,64):
        stop=min(row+64,size);vv=(np.arange(row,stop,dtype=np.float32)[:,None]+.5)/size
        uu=(np.arange(size,dtype=np.float32)[None,:]+.5)/size
        v=np.clip(1-(vv-.28)/.72,0,1)
        p,fat,groove=surface(uu,v);x,y,z=p[:,:,0],p[:,:,1],p[:,:,2]
        # Bottom atlas tiles hold atrial and vascular tissue.
        low=vv<.28;t=uu*4*math.tau;ph=vv/.28*np.pi
        x=np.where(low,np.sin(ph)*np.cos(t)*.29,x);y=np.where(low,np.cos(ph)*.26,y);z=np.where(low,np.sin(ph)*np.sin(t)*.21,z)
        fat=np.where(low,0,fat);groove=np.where(low,0,groove)
        macro=noise(x*9+3,y*9,z*9);fine=noise(x*120,y*120,z*120)
        micro=noise(x*330+7,y*330,z*330)
        def sample(a,b):
            a=1-np.abs(np.mod(a*2.1+.45,1)*2-1);b=1-np.abs(np.mod(b*2.1+.37,1)*2-1)
            return pixels[(b*(sh-1)).astype(int),(a*(sw-1)).astype(int)]
        rgb=(sample(x,y)+sample(z,y)+sample(x,z))/3
        rgb=rgb*.67+np.array([.40,.145,.121])*.33
        rgb*=.93+.15*macro[:,:,None]
        f=np.clip((fat-.1)*1.16,0,.94)
        adipose=np.stack([.68+.08*fine,.49+.06*fine,.26+.05*fine],axis=-1)
        rgb=rgb*(1-f[:,:,None])+adipose*f[:,:,None]
        rgb*=1-.12*groove[:,:,None]
        # Fine spiral-oriented striae with damped contrast beneath epicardium.
        fiber=np.sin(y*390+x*88+noise(x*20,y*20,z*20)*8)
        h=.5+.105*(fine-.5)+.055*(micro-.5)+.013*fiber*(1-f)
        h+=f*.055*np.sin(x*220+micro)*np.sin(y*210+fine)
        color[row:stop]=np.clip(rgb,0,1);height[row:stop]=h
        surface_map[row:stop,:,0]=1-.31*groove
        surface_map[row:stop,:,1]=np.clip(.39+.12*f+.05*(fine-.5)-.09*groove,.25,.57)
        surface_map[row:stop,:,2]=np.where(low,.27+.2*fine,.73+.20*np.sin(v*np.pi)-.20*groove)
    dy,dx=np.gradient(height);strength=size*.007
    normal=np.stack([-dx*strength,-dy*strength,np.ones_like(height)],axis=-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
    # Do not turn the boundary between separate UV islands into a raised seam.
    boundary=int(size*.28);normal[max(0,boundary-2):boundary+3]=[0,0,1]
    save_image('basecolor-'+str(size),color);save_image('normal-'+str(size),normal*.5+.5)
    if size==2048:save_image('surface',surface_map)
    del color,height,surface_map,normal,dx,dy
    print('HEART_BAKES',size,flush=True)

# Offline materials use the same color/normal data; runtime adds optical transport.
for kind,m in mats.items():
    n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF')
    if kind in ['myocardium','atrium']:
        tex=n.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ART/'basecolor-4096.png'),check_existing=True);l.new(tex.outputs['Color'],p.inputs['Base Color'])
    tex=n.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ART/'normal-4096.png'),check_existing=True);tex.image.colorspace_settings.name='Non-Color'
    nm=n.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.32;l.new(tex.outputs[0],nm.inputs['Color']);l.new(nm.outputs[0],p.inputs['Normal'])
for ob in objects:
    if ob.get('internal'):ob.hide_render=True
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.world.color=(.04,.04,.04);scene.view_settings.view_transform='AgX'
for name,pos,power,size in [('Key',(-2,-3,3),200,2.4),('Rim',(2,1,2),180,1.5),('Fill',(2,-3,.3),70,2)]:
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='RECTANGLE';data.size=size;data.size_y=size*.65
    ob=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(ob);ob.location=pos;ob.rotation_euler=(-ob.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(.9,-3.5,1.35));camera=bpy.context.object;scene.camera=camera
camera.data.type='ORTHO';camera.data.ortho_scale=2.65
scene.render.resolution_x=1100;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
for image in bpy.data.images:
    if image.filepath and Path(bpy.path.abspath(image.filepath)).parent==ART:image.filepath='//'+Path(image.filepath).name
bpy.ops.wm.save_as_mainfile(filepath=str(ART/'heart-detail.blend'))
for name,pos,target,scale in [('anterior',(.65,-3.5,1.0),(0,0,.16),2.55),('posterior',(-1,3.5,1.1),(0,0,.16),2.55),('macro',(.85,-3,1.0),(.15,-.30,-.1),1.05)]:
    camera.location=pos;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=scale
    scene.render.filepath=str(ART/(name+'.png'));bpy.ops.render.render(write_still=True)
print('HEART_COMPLETE',len(objects),flush=True)
