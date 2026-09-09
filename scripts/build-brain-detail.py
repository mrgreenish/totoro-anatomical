"""Reproducible close-up brain: geometry and coordinated analytical UV bakes.

Run with Blender in background mode. The generated color source is projected in
object space; all scalar maps use the same fold field as the editable geometry.
"""
import bpy, bmesh, json, math, os
import numpy as np
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'artwork/anatomy/brain-detail'
OUT = ROOT / 'public/models/brain-detail'
ART.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def noise(x,y,z):
    def h(a,b,c):
        return np.mod(np.sin(a*127.1+b*311.7+c*74.7)*43758.5453,1)
    i,j,k=np.floor(x),np.floor(y),np.floor(z)
    a,b,c=x-i,y-j,z-k
    a=a*a*(3-2*a);b=b*b*(3-2*b);c=c*c*(3-2*c)
    lo=(h(i,j,k)*(1-a)+h(i+1,j,k)*a)*(1-b)+(h(i,j+1,k)*(1-a)+h(i+1,j+1,k)*a)*b
    hi=(h(i,j,k+1)*(1-a)+h(i+1,j,k+1)*a)*(1-b)+(h(i,j+1,k+1)*(1-a)+h(i+1,j+1,k+1)*a)*b
    return lo*(1-c)+hi*c

def surface(u,v,side):
    theta=2*np.pi*u;phi=np.pi*v
    x=np.sin(phi)*np.cos(theta);y=np.cos(phi);z=np.sin(phi)*np.sin(theta)
    seed=7.9 if side>0 else 0
    warp=noise(x*2+seed,y*2,z*2)-.5
    # Contours form long winding sulci, with a second, quieter set of folds.
    f=noise(x*5.2+warp*1.7+seed,y*5.2+warp,z*5.2-warp)
    valley=np.exp(-((f-.50)/.057)**2)
    fine=noise(x*10+seed,y*10+9,z*10)
    secondary=np.exp(-((fine-.50)/.042)**2)*.22
    lateral=np.exp(-((y+.15+.16*z+.06*np.sin(z*6))/ .057)**2)
    lateral*=np.clip(side*x*2,0,1)*np.clip(1-z*z,0,1)
    crease=np.maximum(valley, lateral)
    r=1-.145*crease-.022*secondary+.014*(fine-.5)
    # The medial face is almost planar. Two full ellipsoids would leave a
    # conspicuous bowl-shaped gap instead of a narrow longitudinal fissure.
    lateral_x=np.maximum(side*x,0)
    medial_x=np.minimum(side*x,0)
    px=side*(.018+.658*lateral_x*r*(1-.04*z)+.010*medial_x)
    py=y*.39*r+.04+.026*z
    pz=z*.515*r
    return np.stack(np.broadcast_arrays(px,py,pz),axis=-1), crease

def mesh_object(name,vertices,faces,uvs=None):
    # Geometry math uses glTF axes; Blender is Z up / front -Y.
    vertices=np.asarray(vertices)
    verts=np.stack([vertices[:,0],-vertices[:,2],vertices[:,1]],axis=1)
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts.tolist(),[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
    if uvs is not None:
        layer=mesh.uv_layers.new(name='TissueUV')
        for poly in mesh.polygons:
            for li in poly.loop_indices:layer.data[li].uv=uvs[mesh.loops[li].vertex_index]
    for p in mesh.polygons:p.use_smooth=True
    return obj

def grid_faces(n,m):
    return [(j*(n+1)+i,j*(n+1)+i+1,(j+1)*(n+1)+i+1,(j+1)*(n+1)+i) for j in range(m) for i in range(n)]

def mat(name,color,rough=.25):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=rough;p.inputs['Coat Weight'].default_value=.9;p.inputs['Coat Roughness'].default_value=.085
    p.inputs['Subsurface Weight'].default_value=.075;p.inputs['Subsurface Radius'].default_value=(.045,.02,.014)
    return m

tissue=mat('BrainDetail_tissue',(.57,.32,.29))
cerebellar=mat('BrainDetail_cerebellum',(.51,.29,.275))
stemmat=mat('BrainDetail_stem',(.66,.43,.37))
artery=mat('BrainDetail_artery',(.23,.027,.035),.25)
vein=mat('BrainDetail_vein',(.135,.046,.073),.29)
objects=[]
for side in [-1,1]:
    n,m=256,192
    u,v=np.meshgrid(np.linspace(0,1,n+1),np.linspace(0,1,m+1))
    p,_=surface(u,v,side)
    uv=np.stack([u*.5+(0 if side<0 else .5),1-v],axis=-1).reshape(-1,2)
    ob=mesh_object('Cerebrum_'+('L' if side<0 else 'R'),p.reshape(-1,3),grid_faces(n,m),uv)
    ob.data.materials.append(tissue);objects.append(ob)

for side in [-1,1]:
    n,m=160,80
    u,v=np.meshgrid(np.linspace(0,1,n+1),np.linspace(0,1,m+1))
    t=u*2*np.pi;ph=v*np.pi
    fold=np.sin(ph*76+np.sin(t*4)*1.1)
    radius=1-.058*(.5+.5*fold)**3
    p=np.stack([side*.17+np.sin(ph)*np.cos(t)*.245*radius,
                -.265+np.cos(ph)*.155*radius,
                -.27+np.sin(ph)*np.sin(t)*.235*radius],axis=-1)
    uv=np.stack([u*.5+(0 if side<0 else .5),1-v],axis=-1).reshape(-1,2)
    ob=mesh_object('Cerebellum_'+str(side),p.reshape(-1,3),grid_faces(n,m),uv)
    ob.data.materials.append(cerebellar);objects.append(ob)

def ellipsoid(name,center,scale,material,segments=64,rings=40):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,location=(center[0],-center[2],center[1]))
    ob=bpy.context.object;ob.name=name;ob.scale=(scale[0],scale[2],scale[1]);ob.data.materials.append(material)
    for p in ob.data.polygons:p.use_smooth=True
    objects.append(ob);return ob
ellipsoid('Pons',(0,-.29,-.075),(.12,.14,.135),stemmat)
ob=ellipsoid('Medulla',(0,-.43,-.095),(.071,.21,.072),stemmat)
ob.rotation_euler.x=-.17
ellipsoid('Interhemispheric_bridge',(0,-.125,-.015),(.16,.11,.32),stemmat)

def make_tube(name,points,radii,material,sides=7):
    verts=[];faces=[]
    for i,p in enumerate(points):
        tangent=Vector(points[min(len(points)-1,i+1)])-Vector(points[max(0,i-1)])
        tangent.normalize();a=tangent.cross(Vector((0,1,0)))
        if a.length<.01:a=tangent.cross(Vector((1,0,0)))
        a.normalize();b=tangent.cross(a).normalized()
        for k in range(sides):
            angle=k*math.tau/sides
            verts.append(Vector(p)+(a*math.cos(angle)+b*math.sin(angle))*float(radii[i]))
    for j in range(len(points)-1):
        for k in range(sides):faces.append((j*sides+k,j*sides+(k+1)%sides,(j+1)*sides+(k+1)%sides,(j+1)*sides+k))
    faces.extend([tuple(range(sides-1,-1,-1)),tuple((len(points)-1)*sides+k for k in range(sides))])
    ob=mesh_object(name,verts,faces);ob.data.materials.append(material);objects.append(ob)
    return ob

paths=[];vessel_count=0
for side in [-1,1]:
    for index in range(7):
        u0=index/7+.013*(side>0);v0=.23+.02*math.sin(index*4)
        us=u0+.035*np.sin(np.linspace(0,5,95)+index)+np.linspace(0,.085,95)
        vs=np.linspace(v0,.78,95)
        def path(uu,vv,lift):
            p,_=surface(np.mod(uu,1),vv,side)
            # Conform every sample to the folded cortex, then lift half a radius.
            normals=p-np.array([side*.318,.04,0]);normals/=np.linalg.norm(normals,axis=-1,keepdims=True)
            return p+normals*lift
        pp=path(us,vs,.0035)
        radii=np.linspace(.0065,.0012,len(pp))*(.85 if index%2 else 1)
        make_tube('Pial_vessel_'+str(vessel_count),pp,radii,vein if index%3==0 else artery);vessel_count+=1
        for branch in [0,1,2]:
            start=20+branch*21;tt=np.linspace(0,1,38)
            uu=us[start]+tt*(.065 if branch%2 else -.072)+.008*np.sin(tt*7)
            vv=vs[start]+tt*.115
            bp=path(uu,vv,.0024)
            make_tube('Pial_branch_'+str(vessel_count),bp,np.linspace(radii[start]*.63,.0005,len(bp)),vein if index%3==0 else artery,sides=6);vessel_count+=1
        # Neural pathways live just under the wet membrane and are rendered
        # with surface depth testing and an attenuated shader, never x-ray glow.
        if index%2==0:
            uu=us+.023;vv=vs-.01
            pp=path(uu,vv,.0014)
            paths.append({'points':pp.tolist(),'phase':(index*.21+(side+1)*.13)%1,'depth':.55+index*.04})
            for branch in [1,2]:
                start=24+branch*14;tt=np.linspace(0,1,36)
                bp=path(uu[start]+tt*(.065 if branch==1 else -.055),vv[start]+tt*.10,.0014)
                paths.append({'points':bp.tolist(),'phase':(index*.21+(side+1)*.13+.10)%1,'depth':.72})
(OUT/'neural-paths.json').write_text(json.dumps(paths,separators=(',',':')))

# Keep pole/seam normals continuous without losing the per-loop UV seams.
for ob in objects:
    bm=bmesh.new();bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(ob.data);bm.free();ob.data.update()

# Export geometry separately; web materials choose texture resolution lazily.
bpy.ops.object.select_all(action='DESELECT')
for ob in objects:ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ART/'brain-detail-raw.glb'),export_format='GLB',use_selection=True,export_yup=True,export_extras=True)

source=bpy.data.images.load(str(ART/'tissue-source.png'),check_existing=True)
sw,sh=source.size
source_pixels=np.empty(sw*sh*4,dtype=np.float32);source.pixels.foreach_get(source_pixels)
source_pixels=source_pixels.reshape(sh,sw,4)[:,:,:3].copy()

def save_image(name,data,depth='8'):
    h,w=data.shape[:2];rgba=np.ones((h,w,4),dtype=np.float32)
    rgba[:,:,:3]=data if data.ndim==3 else data[:,:,None]
    img=bpy.data.images.new(name,width=w,height=h,float_buffer=True)
    img.colorspace_settings.name='Non-Color'
    img.pixels.foreach_set(rgba.ravel());img.filepath_raw=str(ART/(name+'.png'));img.file_format='PNG'
    scene=bpy.context.scene;scene.render.image_settings.color_depth=depth
    scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.file_format='PNG'
    img.save_render(str(ART/(name+'.png')),scene=scene)
    bpy.data.images.remove(img)

# Analytical bakes are evaluated at each actual hemisphere UV coordinate.
# Source RGB stays color data; scalar channels are linear, normal is tangent-space.
bpy.context.scene.view_settings.view_transform='Raw'
for size in [2048,4096]:
    color=np.empty((size,size,3),np.float32);height=np.empty((size,size),np.float32)
    crease_map=np.empty_like(height);thickness=np.empty_like(height)
    for row in range(0,size,64):
        stop=min(row+64,size)
        vv=(np.arange(row,stop,dtype=np.float32)[:,None]+.5)/size
        uu=(np.arange(size//2,dtype=np.float32)[None,:]+.5)/(size//2)
        for half,side in enumerate([-1,1]):
            p,c=surface(uu,1-vv,side);x,y,z=p[:,:,0],p[:,:,1],p[:,:,2]
            # Continuous triplanar color sampling avoids seams and pole pinches.
            def sample(a,b):
                a=np.mod(a*2.7+.5,1);b=np.mod(b*2.7+.5,1)
                # mirrored repetition makes the generated texture edge-continuous
                a=1-np.abs(a*2-1);b=1-np.abs(b*2-1)
                return source_pixels[(b*(sh-1)).astype(int),(a*(sw-1)).astype(int)]
            rgb=(sample(x,z)+sample(y,z)+sample(x,y))/3
            rgb=rgb*.67+np.array([.76,.57,.53])*.33
            rgb*=1-.09*c[:,:,None]
            fine=noise(x*140+3,y*140,z*140)
            micro=noise(x*340,y*340+7,z*340)
            h=.5+.19*(fine-.5)+.065*(micro-.5)
            sl=slice(half*(size//2),(half+1)*(size//2))
            color[row:stop,sl]=rgb; height[row:stop,sl]=h;crease_map[row:stop,sl]=c
            thickness[row:stop,sl]=np.clip(.42+.45*np.sin(np.pi*vv)-.12*c,.15,.95)
    # Y follows the UV direction, stored bottom up by Blender.
    dy,dx=np.gradient(height)
    strength=size*.009
    normals=np.stack([-dx*strength,-dy*strength,np.ones_like(height)],axis=-1)
    normals/=np.linalg.norm(normals,axis=-1,keepdims=True)
    save_image('basecolor-'+str(size),color)
    save_image('normal-'+str(size),normals*.5+.5)
    if size==2048:
        save_image('height',height,'16')
        save_image('roughness',.44-.17*crease_map+.16*(height-.5))
        save_image('ao',1-.38*crease_map)
        save_image('wetness',.62+.34*crease_map)
        save_image('thickness',thickness)
    print('Baked maps',size,flush=True)
    del color,height,crease_map,thickness,normals,dx,dy

# Editable source retains the complete geometry and full physical material.
for material in [tissue,cerebellar,stemmat]:
    nodes=material.node_tree.nodes;links=material.node_tree.links;bs=nodes.get('Principled BSDF')
    tex=nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ART/'basecolor-4096.png'),check_existing=True)
    links.new(tex.outputs['Color'],bs.inputs['Base Color'])
    normal=nodes.new('ShaderNodeTexImage');normal.image=bpy.data.images.load(str(ART/'normal-4096.png'),check_existing=True);normal.image.colorspace_settings.name='Non-Color'
    convert=nodes.new('ShaderNodeNormalMap');convert.inputs['Strength'].default_value=.55
    links.new(normal.outputs['Color'],convert.inputs['Color']);links.new(convert.outputs['Normal'],bs.inputs['Normal'])
    rough=nodes.new('ShaderNodeTexImage');rough.image=bpy.data.images.load(str(ART/'roughness.png'),check_existing=True);rough.image.colorspace_settings.name='Non-Color'
    links.new(rough.outputs['Color'],bs.inputs['Roughness'])

scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=40;scene.cycles.use_denoising=True
scene.world.color=(.045,.045,.045);scene.view_settings.view_transform='AgX'
for name,pos,power,size in [('Key',(-2,-2,3),140,2),('Strip',(2,0,1),95,.6),('Fill',(-1,2,.8),55,1.8)]:
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='RECTANGLE';data.size=size;data.size_y=size*.3
    light=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(light);light.location=pos;light.rotation_euler=(-light.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(1.4,-2,1.6));camera=bpy.context.object;scene.camera=camera;camera.data.type='ORTHO';camera.data.ortho_scale=1.8
scene.render.resolution_x=1100;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
bpy.ops.wm.save_as_mainfile(filepath=str(ART/'brain-detail.blend'))
for image in bpy.data.images:
    if image.filepath and Path(bpy.path.abspath(image.filepath)).parent==ART:
        image.filepath='//'+Path(image.filepath).name
bpy.ops.wm.save_as_mainfile(filepath=str(ART/'brain-detail.blend'),relative_remap=False)
views={'three-quarter':(1.4,-2,1.6),'side':(2,-.3,.65),'underside':(.8,-1.5,-1.6),'macro':(.8,-1,1.6)}
for name,position in views.items():
    camera.location=position;target=Vector((.18,-.02,.17)) if name=='macro' else Vector((0,0,-.04))
    camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=.65 if name=='macro' else 1.8
    scene.render.filepath=str(ART/(name+'.png'));bpy.ops.render.render(write_still=True)
print('Detailed brain and four review renders complete.',flush=True)
