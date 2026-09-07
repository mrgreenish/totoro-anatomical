"""Authored anatomical volumes, built in staged Blender MCP calls.

Passes: skeleton, organs, muscles, networks, finish. Coordinates: Blender Z up,
front -Y; export metadata uses glTF Y up. No external model library is used.
"""
import bpy
import bmesh
import math
import json
import random
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artwork' / 'anatomy'
OUT.mkdir(exist_ok=True)
PHASE = globals().get('ANATOMY_PHASE', 'all')
random.seed(94)
if PHASE in ('skeleton', 'all'):
    old = bpy.data.collections.get('ANATOMY')
    if old:
        for ob in list(old.all_objects): bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.collections.remove(old)
    collection = bpy.data.collections.new('ANATOMY')
    bpy.context.scene.collection.children.link(collection)
else:
    collection = bpy.data.collections['ANATOMY']
    if PHASE in ('organs','muscles','networks'):
        for ob in list(collection.objects):
            systems=list(ob.get('systems',[]))
            matching=PHASE in systems or PHASE=='networks' and (any(s in systems for s in ['arteries','veins']) or ob.get('partId')=='nervous_network')
            if matching:bpy.data.objects.remove(ob,do_unlink=True)

def material(name, color, rough=.48, texture=None):
    name = 'Anatomy_' + name
    if name in bpy.data.materials: return bpy.data.materials[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    m.diffuse_color = (*color, 1)
    shader = m.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = rough
    shader.inputs['Subsurface Weight'].default_value = .065 if texture else 0
    shader.inputs['Subsurface Radius'].default_value = (1, .35, .18)
    if texture:
        image = bpy.data.images.load(str(OUT / 'textures' / texture), check_existing=True)
        tex = m.node_tree.nodes.new('ShaderNodeTexImage'); tex.image = image
        m.node_tree.links.new(tex.outputs['Color'], shader.inputs['Base Color'])
        # Color factors are retained separately and applied to the exported PBR
        # material by optimize-anatomy.mjs; Blender uses a matching multiplier.
        tint = m.node_tree.nodes.new('ShaderNodeMixRGB'); tint.blend_type = 'MULTIPLY'
        tint.inputs[0].default_value = 1; tint.inputs[2].default_value = (*color, 1)
        m.node_tree.links.new(tex.outputs['Color'], tint.inputs[1])
        m.node_tree.links.new(tint.outputs[0], shader.inputs['Base Color'])
        m['tint'] = list(color); m['textureSource'] = texture
    return m

BONE = material('cortical_bone', (.81, .74, .57), .56)
MARROW = material('marrow', (.40, .15, .115), .62)
CART = material('cartilage', (.60, .76, .72), .36)
MUSCLE = material('muscle', (.83, .59, .53), .5, 'muscle-albedo.png')
TENDON = material('tendon', (.76, .79, .66), .58)
SKIN = material('dermis', (.76, .46, .27), .65)
FAT = material('fat', (.84, .65, .32), .68)
BRAIN = material('brain', (.95, .80, .65), .5, 'organ-albedo.png')
NERVE = material('nerves', (.89, .69, .23), .43)
ARTERY = material('arteries', (.63, .035, .035), .38)
VEIN = material('veins', (.08, .25, .47), .38)
HEART = material('myocardium', (.64, .25, .25), .42, 'organ-albedo.png')
LUNG = material('lungs', (.91, .59, .59), .58, 'organ-albedo.png')
LIVER = material('liver', (.47, .24, .20), .4, 'organ-albedo.png')
STOMACH = material('stomach', (.95, .64, .42), .46, 'organ-albedo.png')
GUT = material('intestine', (.99, .70, .48), .48, 'organ-albedo.png')
KIDNEY = material('kidney', (.61, .22, .21), .44, 'organ-albedo.png')
GLAND = material('glands', (.87, .67, .30), .5, 'organ-albedo.png')
SPLEEN = material('spleen', (.38, .22, .34), .5, 'organ-albedo.png')
GALL = material('gallbladder', (.25, .44, .24), .41)
AIRWAY = material('airway', (.70, .58, .42), .48)
SCLERA = material('sclera', (.93, .88, .73), .25)

OFFSETS = {'skin': (-4.35,0,0), 'bones': (0,0,0), 'muscles': (3.6,0,.1),
           'arteries': (-2.3,0,1.5), 'veins': (2.3,0,1.5), 'nerves': (0,0,-2.2)}

def tag(ob, pid, label, system, offset=None, cavity=False, description=''):
    ob.name = pid
    ob['partId'] = pid; ob['label'] = label
    ob['systems'] = ['organs','nerves'] if pid in ('brain','brain_white_matter','cerebellum','brainstem') else [system]
    ob['assemblyGroup'] = system
    ob['explodeOffset'] = list(offset if offset is not None else OFFSETS.get(system,(0,0,2.8)))
    ob['cap'] = True; ob['cavity'] = cavity
    ob['description'] = description
    return ob

def mesh(name, verts, faces, mat):
    data = bpy.data.meshes.new(name); data.from_pydata(verts, [], faces); data.update()
    ob = bpy.data.objects.new(name, data); collection.objects.link(ob)
    data.materials.append(mat)
    bm=bmesh.new(); bm.from_mesh(data); bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces)); bm.to_mesh(data); bm.free()
    for p in data.polygons: p.use_smooth=True
    return ob

def surface(name, center, scale, mat, shape=None, n=40, rings=22, wall=0):
    # Single poles avoid degenerate UV sphere triangles. A reversed inner shell
    # gives an actual cavity instead of a flat disk at a clipping plane.
    verts=[]; faces=[]
    def shell(factor, inward):
        start=len(verts)
        def point(t,p):
            q=Vector((math.sin(t)*math.cos(p),math.sin(t)*math.sin(p),math.cos(t)))
            if shape: q=Vector(shape(q,t,p))
            return tuple(Vector(center)+Vector((q.x*scale[0]*factor,q.y*scale[1]*factor,q.z*scale[2]*factor)))
        verts.append(point(0,0))
        for j in range(1,rings):
            for i in range(n): verts.append(point(math.pi*j/rings,2*math.pi*i/n))
        end=len(verts); verts.append(point(math.pi,0))
        f=[]
        for i in range(n): f.append((start,start+1+i,start+1+(i+1)%n))
        for j in range(rings-2):
            for i in range(n):
                a=start+1+j*n+i; b=start+1+j*n+(i+1)%n
                f.append((a,a+n,b+n,b))
        for i in range(n): f.append((end,start+1+(rings-2)*n+(i+1)%n,start+1+(rings-2)*n+i))
        faces.extend([tuple(reversed(x)) for x in f] if inward else f)
    shell(1,False)
    if wall: shell(1-wall,True)
    ob=mesh(name,verts,faces,mat)
    if wall:
        # recalc_face_normals treats disconnected shells separately; restore
        # the inward cavity winding explicitly after mesh construction.
        half=len(ob.data.polygons)//2
        bm=bmesh.new();bm.from_mesh(ob.data);bm.faces.ensure_lookup_table()
        bmesh.ops.reverse_faces(bm,faces=list(bm.faces)[half:]);bm.to_mesh(ob.data);bm.free()
    return ob

def spline(points, steps=5):
    points=[Vector(p) for p in points]; result=[]
    for i in range(len(points)-1):
        a=points[max(0,i-1)];b=points[i];c=points[i+1];d=points[min(len(points)-1,i+2)]
        for j in range(steps):
            t=j/steps
            result.append((b*2+(c-a)*t+(a*2-b*5+c*4-d)*t*t+(-a+b*3-c*3+d)*t*t*t)*.5)
    return result+[points[-1]]

def tube(name, points, radii, mat, sides=10, steps=4, wall=0, ellipse=1):
    pts=spline(points,steps);verts=[];faces=[]
    if isinstance(radii,(float,int)): radii=[radii,radii]
    count=len(pts)
    def radius(t):
        v=t*(len(radii)-1);i=min(len(radii)-2,int(v));return radii[i]*(1-(v-i))+radii[i+1]*(v-i)
    previous_u=None
    for j,p in enumerate(pts):
        tangent=(pts[min(j+1,count-1)]-pts[max(0,j-1)]).normalized()
        if previous_u is None:
            reference=Vector((0,0,1)) if abs(tangent.z)<.9 else Vector((1,0,0))
            u=tangent.cross(reference).normalized()
        else:
            u=(previous_u-tangent*previous_u.dot(tangent)).normalized()
            if u.length<.5:u=tangent.cross(Vector((0,1,0))).normalized()
        v=tangent.cross(u).normalized();previous_u=u.copy()
        r=radius(j/(count-1))
        for fac in ([1,1-wall] if wall else [1]):
            for k in range(sides):
                a=2*math.pi*k/sides
                verts.append(tuple(p+fac*r*(u*math.cos(a)+v*math.sin(a)*ellipse)))
    stride=sides*(2 if wall else 1)
    for j in range(count-1):
        for k in range(sides):
            a=j*stride+k;b=j*stride+(k+1)%sides
            faces.append((a,b,b+stride,a+stride))
            if wall:
                a+=sides;b+=sides;faces.append((a,a+stride,b+stride,b))
    for j in (0,count-1):
        base=j*stride
        if wall:
            for k in range(sides):
                f=(base+k,base+(k+1)%sides,base+(k+1)%sides+sides,base+k+sides)
                faces.append(f if j==0 else tuple(reversed(f)))
        else:
            faces.append(tuple(base+k for k in (range(sides-1,-1,-1) if j==0 else range(sides))))
    return mesh(name,verts,faces,mat)

def join(objects, pid, label, system, offset=None, cavity=False, description=''):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in objects: ob.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    if len(objects)>1: bpy.ops.object.join()
    ob=objects[0]
    # Simple cylindrical/spherical projection provides stable UVs for the
    # fine tissue maps without a costly per-part unwrap.
    uv=ob.data.uv_layers.get('UVMap') or ob.data.uv_layers.new(name='UVMap')
    for loop in ob.data.loops:
        p=ob.data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv=(math.atan2(p.y,p.x)/(2*math.pi)+.5,p.z*.8)
    return tag(ob,pid,label,system,offset,cavity,description)

def organ(pid,label,c,s,mat,offset,shape=None,wall=0):
    return join([surface(pid,c,s,mat,shape,wall=wall)],pid,label,'organs',offset,cavity=bool(wall))

def boolean(ob, cutter):
    bpy.context.view_layer.objects.active=ob
    mod=ob.modifiers.new('Anatomical opening','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
    bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)

def trim(ob, point, normal, keep_positive):
    normal=Vector(normal).normalized()
    bpy.ops.mesh.primitive_cube_add(size=1,location=Vector(point)+normal*(-5 if keep_positive else 5))
    cutter=bpy.context.object;cutter.scale=(10,10,10)
    cutter.rotation_euler=normal.to_track_quat('Z','Y').to_euler()
    boolean(ob,cutter)

def longbone(pid,label,a,b,r):
    a,b=Vector(a),Vector(b);axis=(b-a)
    parts=[tube(pid,[a,a+axis*.16,a+axis*.48,a+axis*.83,b],[r*1.12,r,r*.64,r,r*1.14],BONE,14,3,wall=.5),
           tube(pid+'_marrow',[a+axis*.12,b-axis*.12],r*.28,MARROW,8,3)]
    parts.append(surface('proximal_head',a,(r*1.5,r*1.43,r*1.25),BONE,n=22,rings=14,wall=.22))
    for s in [-1,1]:
        parts.append(surface('distal_condyle',b+Vector((s*r*.63,0,0)),(r*.89,r*1.1,r*.86),BONE,n=18,rings=12,wall=.24))
    return join(parts,pid,label,'bones',cavity=True)

def build_skeleton():
    # Cranial vault, cheek arches and mandible share the broad Totoro muzzle.
    skull=surface('skull',(0,.075,3.47),(.99,.64,.54),BONE,n=56,rings=30,wall=.16)
    for side in [-1,1]:
        boolean(skull,surface('orbital_cut',(side*.62,-.53,3.54),(.25,.35,.235),BONE))
    boolean(skull,surface('nasal_cut',(0,-.59,3.31),(.17,.24,.19),BONE))
    boolean(skull,surface('foramen',(0,.18,2.99),(.145,.18,.24),BONE))
    parts=[skull]
    for s in [-1,1]:
        parts.append(tube('zygomatic',[(s*.82,.0,3.44),(s*.97,-.27,3.35),(s*.78,-.64,3.26),(s*.38,-.71,3.22)],.075,BONE,12))
    join(parts,'skull','Skull · cranial vault & cheek arches','bones',cavity=True)
    join([tube('jaw',[(-.92,.05,3.24),(-.96,-.36,3.06),(-.67,-.73,2.97),(0,-.88,2.94),(.67,-.73,2.97),(.96,-.36,3.06),(.92,.05,3.24)], [.07,.095,.11,.095,.07],BONE,14)],'mandible','Mandible','bones')
    roots=[]
    for i in range(10):
        x=-.86+i*.191;y=-.88+.20*(abs(x)/.86)**2;z=3.08+.14*(abs(x)/.86)**2
        roots.append(tube('root',[(x,y,z),(x*.98,y+.018,z-.10)], [.046,.018],BONE,8,3))
    join(roots,'tooth_roots','Tooth roots','bones')
    for i in range(24):
        z=.77+i*.095; y=.49+.12*math.sin(i/23*math.pi)
        r=.105 if i>18 else .135
        ring=tube('vertebral_body',[(0,y,z-.033),(0,y,z+.033)],r,BONE,16,2,wall=.53,ellipse=.8)
        arch=tube('vertebral_arch',[(-r*.7,y,z),(-r*.85,y+.11,z),(0,y+.19,z),(r*.85,y+.11,z),(r*.7,y,z)],.027,BONE,8,3)
        process=tube('spinous_process',[(0,y+.17,z),(0,y+.29,z-.02)],[.044,.015],BONE,8,3)
        join([ring,arch,process],f'vertebra_{i+1:02}',f'Vertebra {i+1}','bones',cavity=True)
        join([tube('disc',[(0,y,z-.044),(0,y,z-.035)],r*.94,CART,14,2,wall=.55)],f'disc_{i+1:02}',f'Intervertebral disc {i+1}','bones',cavity=True)
    for s,side in [(-1,'L'),(1,'R')]:
        for i in range(12):
            z=2.87-i*.073; width=.62+.41*math.sin((i+1)/13*math.pi)
            pts=[(s*.11,.61,z),(s*width*.65,.55,z+.035),(s*width,.12,z-.035),(s*width*.88,-.40,z-.07),(s*.17,-.66,z-.09)]
            pieces=[tube('rib',pts,[.032,.04,.038,.03],BONE,10)]
            if i<7:pieces.append(tube('costal_cartilage',[pts[-1],(s*.06,-.70,z-.09)],.029,CART,9,3))
            join(pieces,f'rib_{side}_{i+1:02}',f'{side} rib {i+1}','bones')
        join([tube('clavicle',[(s*.04,-.42,2.91),(s*.42,-.41,2.91),(s*.87,-.22,2.81),(s*1.15,.04,2.65)], [.055,.065,.06],BONE,12)],f'clavicle_{side}',f'{side} clavicle','bones')
        scap=surface('scapula',(s*.82,.45,2.57),(.29,.09,.38),BONE,shape=lambda q,t,p:(q.x*(.68+.32*q.z),q.y,q.z))
        join([scap],f'scapula_{side}',f'{side} scapula','bones')
        hip=surface('ilium',(s*.59,.31,.66),(.52,.14,.34),BONE,shape=lambda q,t,p:(q.x*(1+.18*q.z),q.y+.3*q.x*q.x,q.z))
        boolean(hip,surface('obturator',(s*.61,.24,.51),(.20,.27,.14),BONE))
        join([hip,tube('pubic_ramus',[(s*.83,.23,.59),(s*.57,-.17,.42),(s*.08,-.26,.48)],.095,BONE,12)],f'pelvis_{side}',f'{side} pelvis','bones',cavity=True)
        shoulder=(s*1.15,.02,2.63); elbow=(s*1.53,-.13,1.91); wrist=(s*1.60,-.29,1.20)
        longbone(f'humerus_{side}',f'{side} humerus',shoulder,elbow,.095)
        longbone(f'radius_{side}',f'{side} radius',(s*1.57,-.16,1.87),(s*1.65,-.31,1.22),.044)
        longbone(f'ulna_{side}',f'{side} ulna',(s*1.46,-.10,1.91),(s*1.53,-.23,1.24),.040)
        carpals=[]
        for j in range(6): carpals.append(surface('carpal',(s*(1.51+(j%3)*.053),-.29,.119e1+(j//3)*.037),(.032,.029,.028),BONE,n=12,rings=8))
        join(carpals,f'carpals_{side}',f'{side} wrist bones','bones')
        for j in range(5):
            x=s*(1.46+j*.052)
            longbone(f'metacarpal_{side}_{j}',f'{side} metacarpal {j+1}',(x,-.30,1.17),(x+s*.028,-.33,1.07),.023)
            join([tube('phalanges',[(x+s*.028,-.33,1.07),(x+s*.029,-.35,1.02),(x+s*.015,-.38,.987)],[.024,.018,.011],BONE,8)],f'finger_{side}_{j}',f'{side} finger {j+1}','bones')
        longbone(f'femur_{side}',f'{side} femur',(s*.67,.16,.64),(s*.77,-.15,.39),.105)
        longbone(f'tibia_{side}',f'{side} tibia',(s*.77,-.15,.37),(s*.76,-.49,.19),.075)
        longbone(f'fibula_{side}',f'{side} fibula',(s*.91,-.13,.37),(s*.91,-.48,.18),.033)
        join([surface('patella',(s*.77,-.245,.39),(.095,.04,.075),BONE,n=20,rings=12)],f'patella_{side}',f'{side} patella','bones')
        for j in range(3):
            x=s*.755+(j-1)*.16
            longbone(f'metatarsal_{side}_{j}',f'{side} metatarsal {j+1}',(x,-.45,.17),(x,-.75,.135),.04)
            join([tube('toe',[(x,-.76,.135),(x,-.85,.13),(x,-.92,.105)],[.042,.037,.025],BONE,10)],f'toe_{side}_{j}',f'{side} toe bones {j+1}','bones')
        ear=tube('ear_cartilage',[(s*.73,.04,3.83),(s*.78,.04,4.18),(s*.91,.03,4.68)],[.12,.145,.02],CART,12,6,ellipse=.32)
        join([ear],f'ear_cartilage_{side}',f'{side} ear cartilage','bones')
    join([tube('sternum',[(0,-.64,2.83),(0,-.72,2.51),(0,-.69,2.20)],[.10,.065,.035],BONE,12,5,ellipse=.5)],'sternum','Sternum','bones')
    join([surface('sacrum',(0,.43,.67),(.23,.11,.22),BONE,n=26,rings=16)],'sacrum','Sacrum','bones')
    for i in range(9):
        y=.64+i*.092;z=.65+.12*math.sin(i/9*math.pi)
        join([surface('caudal',(0,y,z),(.095-i*.006,.063,.078-i*.004),BONE,n=16,rings=10)],f'tail_vertebra_{i+1}',f'Tail vertebra {i+1}','bones')
    build_skins()

def build_skins():
    for ob in list(collection.all_objects):
        if ob.get('assemblyGroup')=='skin':bpy.data.objects.remove(ob,do_unlink=True)
    # Tissue shell immediately beneath the existing exterior. Its inward face
    # makes a skin band at the cut instead of sealing the entire body cavity.
    for name in ['Body','Arm_L','Arm_R','Foot_L','Foot_R','Ear_L','Ear_R','Tail']:
        source=bpy.data.objects.get(name)
        if not source: continue
        deps=bpy.context.evaluated_depsgraph_get()
        data=bpy.data.meshes.new_from_object(source.evaluated_get(deps))
        ob=bpy.data.objects.new('dermis_'+name,data);collection.objects.link(ob);ob.matrix_world=source.matrix_world.copy()
        ob.data.materials.clear();ob.data.materials.append(SKIN)
        ob.modifiers.clear()
        dec=ob.modifiers.new('Skin envelope resolution','DECIMATE');dec.ratio=.28
        bpy.context.view_layer.objects.active=ob;bpy.ops.object.modifier_apply(modifier=dec.name)
        # Recess about each envelope's center. Constant normal offsets can
        # invert the very narrow ear tips; proportional inset preserves them.
        center=sum((v.co for v in ob.data.vertices),Vector())/len(ob.data.vertices)
        factor=.986 if name=='Body' else .91 if name.startswith('Ear') else .955
        for vertex in ob.data.vertices:vertex.co=center+(vertex.co-center)*factor
        ob.data.update()
        solid=ob.modifiers.new('Dermis wall','SOLIDIFY');solid.thickness=.018;solid.offset=-1;solid.use_even_offset=False
        bpy.ops.object.modifier_apply(modifier=solid.name)
        ob['surfaceRole']='skin-wall'
        tag(ob,'dermis_'+name,'Skin · '+name.replace('_',' '),'skin',cavity=True)

def build_organs():
    # Bilateral folded cortex. Gyri follow curved paths on the cortical surface;
    # the medial fissure and cerebellum remain distinct modeled structures.
    brain=[]
    for s in [-1,1]:
        c=Vector((s*.355,.08,3.56));sc=Vector((.352,.47,.35))
        def cortex(q,t,p):
            # Warped sulci are carved into the cortical volume. Two broad
            # frequency bands create meandering folds with rounded crowns.
            warped=p*9+1.8*math.sin(t*7)+.60*math.sin(p*5-t*8)
            grooves=math.exp(-(math.sin(warped)**2)/.085)
            cross=math.exp(-(math.sin(t*10+.7*math.sin(p*6))**2)/.07)
            depth=.057*grooves+.035*cross
            bulge=1+.017*math.sin(p*4+t*3)-depth
            return (q.x*bulge,q.y*bulge,q.z*bulge)
        brain.append(surface('hemisphere',c,sc,BRAIN,n=128,rings=72,shape=cortex))
    join(brain,'brain','Brain · cerebral hemispheres','nerves',(0,1.2,1.8),description='Two folded hemispheres separated by the longitudinal fissure.')
    folds=[]
    for s in [-1,1]:
        folds.append(surface('cerebellum',(s*.22,.31,3.18),(.23,.25,.18),BRAIN))
        for j in range(9):
            z=3.045+j*.031;rr=math.sqrt(max(.1,1-((z-3.17)/.17)**2))
            folds.append(tube('folium',[(s*.22+.23*rr*math.cos(t),.31+.25*rr*math.sin(t),z) for t in [k*2*math.pi/24 for k in range(25)]],.012,BRAIN,6,1))
    join(folds,'cerebellum','Cerebellum','nerves',(0,.5,2.1))
    join([tube('stem',[(0,.2,3.3),(0,.35,3.15),(0,.50,2.99)],[.10,.085,.057],BRAIN,14,5)],'brainstem','Brainstem','nerves',(0,.35,2.0))
    for s,side in [(-1,'L'),(1,'R')]:
        organ('eye_'+side,side+' eyeball',(s*.62,-.50,3.53),(.175,.23,.175),SCLERA,(s*.85,.6,2.5),wall=.10)
        earparts=[tube('cochlea',[(s*(.90+.05*t*math.cos(t*math.pi*5)),.10+.05*t*math.sin(t*math.pi*5),3.49+.02*t) for t in [k/30 for k in range(31)]],.016,GLAND,7,1)]
        for axis in range(3):
            pts=[]
            for k in range(33):
                a=2*math.pi*k/32;p=Vector((s*.91,.13,3.54));p[axis]+=.07*math.cos(a);p[(axis+1)%3]+=.09*math.sin(a);pts.append(p)
            earparts.append(tube('semicircular_canal',pts,.012,GLAND,6,1))
        join(earparts,'inner_ear_'+side,side+' inner ear','organs',(s*1.9,.8,1.8))
    organ('tongue','Tongue',(0,-.50,3.04),(.40,.22,.105),MUSCLE,(0,.25,3.1),shape=lambda q,t,p:(q.x,q.y*(1+.12*q.x),q.z))
    for s,side in [(-1,'L'),(1,'R')]:
        organ('salivary_'+side,side+' salivary glands',(s*.70,-.18,3.12),(.15,.13,.20),GLAND,(s*1.25,.05,3))
    organ('pituitary','Pituitary gland',(0,-.02,3.22),(.064,.065,.045),GLAND,(-.6,.3,2.7))
    organ('thyroid','Thyroid gland',(0,-.23,2.90),(.19,.075,.11),GLAND,(.7,.2,2.7),shape=lambda q,t,p:(q.x,q.y*(.5+.9*abs(q.x)),q.z))
    para=[]
    for s in [-1,1]:
        for z in [2.87,2.94]:para.append(surface('parathyroid',(s*.12,-.17,z),(.027,.02,.032),GLAND,n=12,rings=8))
    join(para,'parathyroids','Parathyroid glands','organs',(.8,.1,3))
    trachea=[tube('trachea',[(0,-.14,3.00),(0,-.13,2.77),(0,-.12,2.52)],.08,AIRWAY,14,7,wall=.26)]
    for i in range(12):
        z=2.99-i*.035
        trachea.append(tube('tracheal_ring',[(.083*math.cos(t),-.135+.083*math.sin(t),z) for t in [k*2*math.pi/24 for k in range(25)]],.011,CART,6,1))
    for s in [-1,1]:
        trachea.append(tube('bronchus',[(0,-.12,2.54),(s*.25,-.04,2.47),(s*.44,.0,2.41)],[.067,.04,.025],AIRWAY,12,4,wall=.28))
        for j in range(3):trachea.append(tube('bronchiole',[(s*.36,-.01,2.44),(s*.51,.04,2.39+j*.12),(s*.65,.10,2.2+j*.24)],[.035,.018,.01],AIRWAY,8,3,wall=.3))
    join(trachea,'airways','Trachea & bronchial tree','organs',(0,.2,1.8),True)
    for s,side in [(-1,'L'),(1,'R')]:
        def lungshape(q,t,p):
            z=q.z if q.z>-.65 else -.65+(q.z+.65)*.24
            return (q.x*(.86-.20*q.z)+s*.09*q.z,q.y*(.87-.16*q.z),z)
        full=surface('lung',(s*.55,.05,2.45),(.47,.51,.56),LUNG,lungshape,n=52,rings=30)
        boolean(full,surface('cardiac_notch',(-.10,-.42,2.40),(.38,.34,.48),LUNG))
        upper=full.copy();upper.data=full.data.copy();collection.objects.link(upper)
        splitpoint=(s*.55,0,2.53 if s<0 else 2.62);normal=(s*.10,-.42,1)
        trim(upper,Vector(splitpoint)+Vector((0,0,.006)),normal,True)
        trim(full,Vector(splitpoint)-Vector((0,0,.006)),normal,False)
        lobes=[upper,full]
        if s==1:
            middle=full.copy();middle.data=full.data.copy();collection.objects.link(middle)
            trim(middle,(s*.55,-.13,2.40),(.05,-1,.30),True)
            trim(full,(s*.55,-.12,2.40),(.05,-1,.30),False)
            lobes.append(middle)
        join(lobes,'lung_'+side,side+' lung · '+('two' if s<0 else 'three')+' lobes','organs',(s*1.65,.35,2.15))
    # Separate atrial/ventricular walls provide four true cavities and septa.
    myocardium=surface('myocardial_wall',(-.13,-.40,2.42),(.31,.245,.39),HEART,n=56,rings=34,shape=lambda q,t,p:(q.x*(.84+.19*q.z)+.10*q.z,q.y*(.9+.10*q.z),q.z))
    for s in [-1,1]:
        boolean(myocardium,surface('ventricular_cavity',(s*.105-.13,-.40,2.32),(.087,.13,.22),HEART,n=28,rings=18))
        boolean(myocardium,surface('atrial_cavity',(s*.108-.13,-.40,2.62),(.086,.115,.105),HEART,n=28,rings=18))
    heart=[myocardium]
    for s in [-1,1]:
        for j in range(3):
            a=j*2*math.pi/3
            heart.append(surface('valve_leaflet',(s*.115-.12+.048*math.cos(a),-.40+.065*math.sin(a),2.47),(.055,.03,.013),CART,n=16,rings=8))
        heart.append(tube('papillary',[(s*.115-.12,-.4,2.23),(s*.115-.12,-.4,2.40)],[.04,.014],HEART,8))
    join(heart,'heart','Heart · four chambers & valves','organs',(-.25,.05,3.45),True,'Muscular walls, atria, ventricles, septa and valve leaflets.')
    organ('liver','Liver',(.30,-.03,1.81),(.86,.48,.26),LIVER,(1.6,-.15,2.8),shape=lambda q,t,p:(q.x,q.y*(.76+.23*q.x),q.z*(.58+.38*q.x)+.16*(1-q.x*q.x)))
    organ('gallbladder','Gallbladder',(.52,-.25,1.60),(.10,.10,.20),GALL,(1.30,-.5,3.5),wall=.17)
    join([tube('esophagus',[(0,.04,3.01),(0,.11,2.54),(-.12,.02,2.0),(-.35,-.12,1.79)],.056,STOMACH,12,7,wall=.25)],'esophagus','Esophagus','organs',(-.45,0,2.6),True)
    join([tube('gastric_wall',[(-.33,-.12,1.85),(-.56,-.22,1.79),(-.69,-.24,1.60),(-.53,-.25,1.37),(-.20,-.19,1.39)],[.09,.20,.25,.19,.07],STOMACH,28,10,wall=.17,ellipse=.80)],'stomach','Stomach','organs',(-1.35,-.2,3),True)
    organ('pancreas','Pancreas',(-.20,.12,1.61),(.43,.12,.095),GLAND,(-.7,-.4,3.55),shape=lambda q,t,p:(q.x,q.y*(1+.14*math.sin(p*11)),q.z*(.85+.15*math.cos(p*13))))
    organ('spleen','Spleen',(-.98,.10,1.75),(.18,.29,.25),SPLEEN,(-1.9,-.15,2.75))
    loops=[(-.20,-.19,1.39),(.10,-.05,1.36),(.18,.03,1.16),(-.12,-.04,1.10),(-.42,-.27,1.22)]
    for row in range(5):
        z=1.21-row*.12
        pts=[]
        for k in range(40):
            x=-.69+k*1.38/39
            pts.append((x,-.35+.20*math.sin(k/39*math.pi*3+row*1.8),z+.034*math.sin(k/39*math.pi*4)))
        if row%2: pts.reverse()
        loops.extend(pts)
    loops.append((.83,-.28,.63))
    join([tube('small_bowel',loops,.065,GUT,9,2,wall=.23)],'small_intestine','Small intestine & duodenum','organs',(-.65,-.55,2.7),True)
    colonpts=[(.83,-.28,.63),(.94,-.25,1.07),(.89,-.16,1.44),(.40,-.29,1.47),(-.16,-.35,1.38),(-.87,-.20,1.40),(-.97,-.26,.91),(-.75,-.27,.51),(-.3,-.17,.43),(0,.12,.46),(0,.24,.29)]
    colon=tube('large_bowel',colonpts,[.098+.012*math.sin(k*math.pi*.8) for k in range(85)],GUT,14,10,wall=.25)
    join([colon],'large_intestine','Colon & rectum','organs',(.65,-.55,3.25),True)
    join([tube('appendix',[(.83,-.25,.65),(.90,-.18,.55),(.83,-.14,.49)],[.029,.022,.012],GUT,8)],'appendix','Appendix','organs',(1.3,-.5,3.1))
    for s,side in [(-1,'L'),(1,'R')]:
        def kidneyshape(q,t,p):
            indent=.32*math.exp(-(q.z/.45)**2)*max(0,-s*q.x)
            return (q.x+s*indent,q.y,q.z)
        k=organ('kidney_'+side,side+' kidney',(s*.72,.42,1.43),(.255,.17,.33),KIDNEY,(s*1.7,-.6,1.2),kidneyshape,wall=.30)
        pyramids=[]
        for j in range(7):
            a=(j/6-.5)*math.pi*1.6
            start=(s*.72+s*.15*math.cos(a),.42,1.43+.22*math.sin(a))
            pyramids.append(tube('renal_pyramid',[start,(s*.66,.42,1.43)],[.046,.012],GLAND,8,2))
        join(pyramids,'kidney_medulla_'+side,side+' renal medulla','organs',(s*1.7,-.6,1.2))
        organ('adrenal_'+side,side+' adrenal gland',(s*.72,.42,1.79),(.14,.10,.075),GLAND,(s*1.6,-.3,1.2),shape=lambda q,t,p:(q.x*(.6+.4*q.z),q.y,q.z))
        join([tube('ureter',[(s*.63,.36,1.40),(s*.48,.25,.98),(s*.19,.01,.49)],[.026,.021,.018],STOMACH,9,6,wall=.28)],'ureter_'+side,side+' ureter','organs',(s*.8,-.6,1.7),True)
    organ('bladder','Urinary bladder',(0,-.02,.46),(.24,.21,.19),STOMACH,(0,-.5,3.3),shape=lambda q,t,p:(q.x*(.85+.15*q.z),q.y,q.z),wall=.21)
    join([tube('urethra',[(0,-.02,.31),(0,-.07,.22)],[.025,.018],STOMACH,9,4,wall=.3)],'urethra','Urethra','organs',(0,-.5,3.3),True)

def build_muscles():
    def muscle(pid,label,points,r,ellipse=.65):
        pts=[Vector(x) for x in points]
        m=tube(pid,pts,[r*.22,r*.85,r,r*.76,r*.2],MUSCLE,14,7,ellipse=ellipse)
        tendons=[tube('tendon',[pts[0],pts[0].lerp(pts[1],.25)],[r*.22,r*.26],TENDON,8,3),tube('tendon',[pts[-1].lerp(pts[-2],.18),pts[-1]],[r*.25,r*.18],TENDON,8,3)]
        return join([m,*tendons],pid,label,'muscles')
    for s,side in [(-1,'L'),(1,'R')]:
        muscle('temporalis_'+side,side+' temporalis',[(s*.77,.18,3.83),(s*.91,.02,3.62),(s*.97,-.16,3.33)],.14,.7)
        muscle('masseter_'+side,side+' masseter',[(s*.93,-.21,3.43),(s*1.02,-.33,3.22),(s*.91,-.40,3.03)],.18,.75)
        muscle('trapezius_'+side,side+' trapezius',[(s*.12,.61,3.0),(s*.55,.68,2.76),(s*1.18,.20,2.60)],.20,.46)
        muscle('deltoid_'+side,side+' deltoid',[(s*1.13,.03,2.72),(s*1.31,-.10,2.54),(s*1.41,-.16,2.25)],.21,.83)
        muscle('biceps_'+side,side+' biceps',[(s*1.28,-.19,2.53),(s*1.45,-.27,2.25),(s*1.54,-.22,1.93)],.17,.9)
        muscle('triceps_'+side,side+' triceps',[(s*1.31,.13,2.53),(s*1.49,.08,2.19),(s*1.57,.00,1.92)],.19,.76)
        for j in range(3):
            muscle(f'forearm_{side}_{j}',side+' forearm '+['flexors','extensors','brachioradialis'][j],[(s*(1.47+j*.065),-.11-j*.10,1.98),(s*(1.52+j*.05),-.16-j*.075,1.60),(s*(1.55+j*.035),-.25-j*.03,1.24)],.08,.72)
        for j in range(3):
            muscle(f'pectoralis_{side}_{j}',side+f' pectoralis bundle {j+1}',[(s*.10,-.77,2.65-j*.12),(s*.63,-.78,2.62-j*.09),(s*1.13,-.27,2.62)],.15,.47)
        for j in range(4):
            muscle(f'abdominis_{side}_{j}',side+f' rectus abdominis segment {j+1}',[(s*.20,-.97,1.91-j*.24),(s*.24,-1.01,1.82-j*.24),(s*.23,-.98,1.71-j*.24)],.19,.32)
        for j in range(4):
            muscle(f'oblique_{side}_{j}',side+f' external oblique bundle {j+1}',[(s*1.10,-.41,1.94-j*.22),(s*.96,-.75,1.68-j*.18),(s*.48,-.93,1.39-j*.16)],.135,.45)
        muscle('latissimus_'+side,side+' latissimus dorsi',[(s*1.13,.23,2.56),(s*.89,.80,2.00),(s*.26,.86,1.04)],.29,.34)
        muscle('erector_'+side,side+' erector spinae',[(s*.24,.74,2.93),(s*.26,.82,1.83),(s*.22,.65,.76)],.105,.66)
        muscle('gluteus_'+side,side+' gluteal muscles',[(s*.38,.52,.84),(s*.70,.54,.61),(s*.83,.30,.41)],.28,.72)
        muscle('quadriceps_'+side,side+' quadriceps',[(s*.70,-.02,.74),(s*.84,-.25,.54),(s*.79,-.34,.39)],.18,.67)
        muscle('hamstrings_'+side,side+' hamstrings',[(s*.67,.43,.64),(s*.83,.24,.43),(s*.83,-.12,.34)],.15,.71)
        muscle('calf_'+side,side+' calf & Achilles tendon',[(s*.79,.10,.41),(s*.82,-.14,.31),(s*.79,-.51,.17)],.13,.64)
    # Dome-shaped diaphragm is a closed thin shell, open below the thorax.
    diaphragm=surface('diaphragm',(0,.03,1.99),(1.0,.66,.13),MUSCLE,n=44,rings=16,wall=.3)
    join([diaphragm],'diaphragm','Diaphragm','muscles',cavity=True)
    muscle('tail_muscles','Tail muscles',[(0,.61,.64),(0,1.02,.74),(0,1.48,.75)],.27,.85)

def build_networks():
    for system,mat,shift in [('arteries',ARTERY,-.12),('veins',VEIN,.12)]:
        parts=[]
        def vessel(points,r,steps=5):
            parts.append(tube(system,points,r,mat,9,steps,wall=.3))
        if system=='arteries':
            vessel([(-.14,-.33,2.64),(-.22,-.22,2.85),(.06,.03,2.92),(.17,.32,2.72),(.08,.44,2.28),(-.10,.45,1.64),(-.10,.36,.72)],[.070,.074,.060,.049])
        else:
            vessel([(.12,.34,.72),(.13,.46,1.55),(.12,.36,2.20),(.09,-.19,2.59),(.18,.20,2.88)],[.065,.08,.095,.055])
        for s in [-1,1]:
            vessel([(shift,.18,2.85),(s*.28,.18,3.08),(s*.41,.22,3.40),(s*.55,.16,3.69)],[.038,.031,.021,.011])
            vessel([(shift,.20,2.86),(s*.55,.13,2.82),(s*1.12,.01,2.66),(s*1.47,-.1,2.06),(s*1.56,-.18,1.55),(s*1.59,-.25,1.18)],[.043,.038,.030,.018,.011])
            vessel([(shift,.41,1.43),(s*.36,.42,1.42),(s*.63,.39,1.44)],[.034,.032,.024])
            vessel([(shift,.38,.82),(s*.45,.24,.62),(s*.76,.04,.51),(s*.79,-.29,.31),(s*.77,-.69,.17)],[.042,.038,.027,.016])
            for j in range(5):
                vessel([(s*1.58,-.24,1.25),(s*(1.45+j*.055),-.3,1.15),(s*(1.47+j*.055),-.34,1.04)],[.014,.009,.006],3)
            for j in range(3):vessel([(s*.78,-.52,.23),(s*.75+(j-1)*.15,-.74,.18),(s*.75+(j-1)*.16,-.86,.15)],[.014,.010,.006],3)
            vessel([(s*.49,.17,3.57),(s*.70,.07,3.87),(s*.81,.03,4.20),(s*.91,.03,4.55)],[.017,.013,.009,.005])
            for j in range(6):
                z=2.79-j*.14
                vessel([(shift,.44,z),(s*.57,.38,z),(s*.87,.06,z-.05),(s*.68,-.36,z-.12)],[.018,.014,.008])
            vessel([(-.14,-.27,2.58),(s*.29,-.30,2.60),(s*.43,.0,2.58),(s*.62,.05,2.69)],[.045,.034,.025,.012])
        for j in range(7):
            z=1.64-j*.13
            vessel([(shift,.42,z),(.08,-.02,z),((-.65+j*.18),-.34,1.03+.12*math.sin(j))],[.025,.019,.009])
        vessel([(shift,.38,.75),(0,.73,.68),(0,1.14,.77),(0,1.43,.77)],[.024,.018,.009,.006])
        join(parts,system+'_network',system.capitalize()+' · connected vascular tree',system,cavity=True)
    coronary=[]
    for s in [-1,1]:coronary.append(tube('coronary',[(-.12,-.5,2.65),(s*.12-.12,-.58,2.52),(s*.15-.12,-.57,2.33),(-.14,-.48,2.15)],[.021,.016,.009,.005],ARTERY,8,6,wall=.3))
    join(coronary,'coronary_arteries','Coronary arteries','arteries',(-.25,.05,3.45),True)
    nerves=[tube('spinal_cord',[(0,.2,3.2),(0,.52,2.95),(0,.59,2.1),(0,.58,1.35),(0,.48,.81)],[.060,.056,.045,.022],NERVE,12,9)]
    for s in [-1,1]:
        nerves.append(tube('optic',[(s*.11,.02,3.32),(s*.31,-.19,3.39),(s*.60,-.35,3.51)],[.028,.023,.020],NERVE,9,5))
        for j in range(5):
            nerves.append(tube('cranial',[(s*.07,.22,3.19),(s*.30,.02,3.31),(s*(.40+j*.12),-.30,3.19+j*.13)],[.018,.013,.007],NERVE,8,5))
        for j in range(16):
            z=2.85-j*.12
            nerves.append(tube('spinal_root',[(0,.58,z),(s*.24,.52,z-.03),(s*.54,.30,z-.065),(s*.87,-.03,z-.11)],[.019,.014,.009,.005],NERVE,8,4))
        paths=[[(s*.13,.49,2.82),(s*.74,.13,2.75),(s*1.29,-.01,2.43),(s*1.54,-.17,1.77),(s*1.57,-.24,1.15)],[(s*.13,.48,1.08),(s*.43,.30,.71),(s*.78,.02,.48),(s*.80,-.38,.25),(s*.78,-.81,.15)],[(s*.11,.18,3.12),(s*.18,.02,2.81),(s*.17,.10,2.05),(s*.27,-.05,1.61)]]
        for p in paths:nerves.append(tube('nerve',p,[.034,.029,.020,.009],NERVE,9,6))
        for j in range(5):nerves.append(tube('digital',[(s*1.57,-.24,1.23),(s*(1.46+j*.055),-.32,1.13),(s*(1.49+j*.055),-.35,1.04)],[.011,.007,.004],NERVE,7,4))
        nerves.append(tube('auricular',[(s*.52,.09,3.62),(s*.73,.035,3.91),(s*.84,.025,4.37)],[.013,.009,.005],NERVE,8,5))
    nerves.append(tube('caudal',[(0,.48,.87),(0,.72,.72),(0,1.12,.78),(0,1.43,.77)],[.021,.018,.011,.006],NERVE,8,6))
    join(nerves,'nervous_network','Spinal cord & peripheral nerves','nerves')

def build_details():
    for ob in list(collection.all_objects):
        if ob.get('detailPass'):bpy.data.objects.remove(ob,do_unlink=True)
    before=set(collection.all_objects)
    for s,side in [(-1,'L'),(1,'R')]:
        for name,c,sc in [('shoulder',(s*1.15,.02,2.64),(.15,.145,.10)),('elbow',(s*1.53,-.13,1.90),(.105,.10,.046)),('wrist',(s*1.60,-.29,1.20),(.11,.065,.036)),('hip',(s*.67,.16,.65),(.16,.15,.085)),('knee',(s*.77,-.15,.38),(.15,.13,.034)),('ankle',(s*.76,-.49,.19),(.11,.085,.030))]:
            join([surface(name,c,sc,CART,n=24,rings=12,wall=.16)],'cartilage_'+name+'_'+side,side+' '+name+' joint cartilage','bones',cavity=True)
        eyeoff=(s*.85,.6,2.5)
        organ('lens_'+side,side+' eye lens',(s*.62,-.658,3.53),(.087,.038,.087),CART,eyeoff)
        organ('retina_'+side,side+' retina',(s*.62,-.465,3.53),(.147,.164,.147),LIVER,eyeoff,wall=.075)
    organ('pineal','Pineal gland',(0,.24,3.38),(.037,.045,.03),GLAND,(.55,.45,2.4))
    organ('thymus','Thymus',(0,-.55,2.77),(.16,.06,.16),GLAND,(.45,.2,3.0),shape=lambda q,t,p:(q.x*(.65+.35*q.z),q.y,q.z))
    join([tube('biliary_tree',[(.52,-.25,1.68),(.38,-.22,1.61),(.18,-.05,1.35)],[.026,.022,.014],GALL,10,5,wall=.22)],'biliary_tree','Bile ducts','organs',(1.3,-.5,3.5),True)
    white=material('white_matter',(.91,.85,.68),.58)
    # Deep white matter inside each closed cortical volume.
    join([surface('white_matter',(s*.355,.08,3.56),(.268,.37,.263),white,n=44,rings=24) for s in [-1,1]],'brain_white_matter','Brain · deep white matter','nerves',(0,1.2,1.8))
    for ob in list(collection.all_objects):
        if ob not in before:ob['detailPass']=True

def finish():
    fitter=Path(__file__).with_name('contain_anatomy.py')
    exec(compile(fitter.read_text(),str(fitter),'exec'),{'__file__':str(fitter),'ANATOMY_PHASE':'fit'})
    # glTF cannot export Blender's Multiply graph. Use the actual source map
    # and apply the recorded material factor in the optimized glTF afterward.
    for m in bpy.data.materials:
        if not m.name.startswith('Anatomy_') or not m.get('textureSource'): continue
        shader=m.node_tree.nodes.get('Principled BSDF')
        image=next(n for n in m.node_tree.nodes if n.type=='TEX_IMAGE')
        m.node_tree.links.new(image.outputs['Color'],shader.inputs['Base Color'])
    parts=[]; triangles=0
    for ob in collection.all_objects:
        if ob.type!='MESH': continue
        ob.data.calc_loop_triangles();triangles+=len(ob.data.loop_triangles)
        parts.append({'id':ob['partId'],'label':ob['label'],'systems':list(ob['systems']), 'triangles':len(ob.data.loop_triangles),'cavity':bool(ob['cavity'])})
    bpy.ops.object.select_all(action='DESELECT')
    for ob in list(collection.all_objects): ob.select_set(True)
    triangulation=[]
    for ob in list(collection.all_objects):
        mod=ob.modifiers.new('Export tangent triangulation','TRIANGULATE');triangulation.append((ob,mod))
    bpy.ops.export_scene.gltf(filepath=str(OUT/'anatomy-raw.glb'),export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_animations=False,export_cameras=False,export_lights=False,export_extras=True,export_tangents=True,export_image_format='AUTO')
    for ob,mod in triangulation:ob.modifiers.remove(mod)
    materials={m.name:{'tint':list(m.get('tint',[1,1,1])),'texture':m.get('textureSource')} for m in bpy.data.materials if m.name.startswith('Anatomy_')}
    (OUT/'manifest.json').write_text(json.dumps({'version':1,'coordinates':'glTF Y up, front +Z','parts':parts,'triangles':triangles,'materials':materials},indent=2))
    # Restore the authoring shaders for the editable source and offline reviews.
    for m in bpy.data.materials:
        if m.name.startswith('Anatomy_') and m.get('textureSource'):
            tint=next(n for n in m.node_tree.nodes if n.type=='MIX_RGB')
            m.node_tree.links.new(tint.outputs[0],m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'totoro-anatomy.blend'))
    print('ANATOMY_EXPORTED',len(parts),'parts',triangles,'triangles')

passes={'skeleton':build_skeleton,'organs':build_organs,'muscles':build_muscles,'networks':build_networks,'details':build_details,'skins':build_skins,'finish':finish}
if PHASE=='all':
    for name,fn in passes.items():fn();print('PASS_COMPLETE',name,flush=True)
else:
    passes[PHASE]()
    if PHASE!='finish':bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'totoro-anatomy.blend'))
    print('PASS_COMPLETE',PHASE,flush=True)
