"""Create an editable Totoro sculpture and a browser-ready glTF in Blender.

Run: blender -b --python scripts/build_totoro.py
Coordinates: Z up, face toward -Y. The glTF exporter converts to Y up.
"""
import bpy
import math
import random
import json
import os
from bisect import bisect_left
from pathlib import Path
from mathutils import Vector

random.seed(24)
ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'public' / 'models'
SOURCE = ROOT / 'artwork'
ASSETS.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for data in list(bpy.data.materials):
    bpy.data.materials.remove(data)

# Deterministic value noise. Blender's own noise functions are not reproducible run to run.
def lattice(i,j,k,salt):
    # Integer hash to [-1, 1]; pure arithmetic, so the groom is identical on every run.
    h=(i*374761393+j*668265263+k*2147483629+salt*1274126177)&0xffffffff
    h=((h^(h>>13))*1274126177)&0xffffffff
    return ((h^(h>>16))&0xffff)/32767.5-1

def swirl(p,salt=0):
    """Smooth vector noise for cowlicks and whorls in the flow field."""
    x,y,z=p.x,p.y,p.z;i,j,k=math.floor(x),math.floor(y),math.floor(z)
    fx,fy,fz=[t*t*(3-2*t) for t in (x-i,y-j,z-k)]
    out=[]
    for axis in range(3):
        c=[lattice(i+a,j+b,k+d,salt*3+axis) for a in (0,1) for b in (0,1) for d in (0,1)]
        x0=[c[0]*(1-fz)+c[1]*fz,c[2]*(1-fz)+c[3]*fz,c[4]*(1-fz)+c[5]*fz,c[6]*(1-fz)+c[7]*fz]
        y0=[x0[0]*(1-fy)+x0[1]*fy,x0[2]*(1-fy)+x0[3]*fy]
        out.append(y0[0]*(1-fx)+y0[1]*fx)
    return Vector(out)

def material(name, color, roughness=.8, sheen=0, noise=False):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Sheen Weight'].default_value = sheen
    bsdf.inputs['Sheen Roughness'].default_value = .7
    if noise:
        tex = nodes.new('ShaderNodeTexNoise')
        tex.inputs['Scale'].default_value = 1
        tex.inputs['Detail'].default_value = 2
        coordinates = nodes.new('ShaderNodeTexCoord')
        groom = nodes.new('ShaderNodeVectorMath'); groom.operation = 'MULTIPLY'
        groom.inputs[1].default_value = (210, 210, 38)
        mat.node_tree.links.new(coordinates.outputs['Generated'], groom.inputs[0])
        mat.node_tree.links.new(groom.outputs['Vector'], tex.inputs['Vector'])
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = .055
        bump.inputs['Distance'].default_value = .0025
        mat.node_tree.links.new(tex.outputs['Fac'], bump.inputs['Height'])
        mat.node_tree.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return mat

fur = material('Fur • warm slate', (.135, .151, .147), .92, .5, True)
belly = material('Belly • warm ivory', (.73, .69, .55), .95, .7, True)
markings = material('Seven chevrons', (.095, .112, .103), .95, .3)
inner_ear = material('Fur • ear folds', (.116, .132, .126), .94, .4)
white = material('Eyes • ivory', (.94, .935, .845), .3)
black = material('Eyes and nose • obsidian', (.011, .016, .014), .27)
nose_mat = material('Nose • soft charcoal', (.016, .021, .018), .48)
enamel = material('Teeth • warm enamel', (.90, .89, .81), .36)
mouth_mat = material('Mouth • deep umber', (.019, .014, .012), .86)
whisker_mat = material('Whiskers', (.027, .034, .026), .8)
claw_mat = material('Claws • horn', (.062, .071, .058), .48)
leaf_mat = material('Leaf • fresh green', (.125, .28, .065), .51, .12)
vein_mat = material('Leaf veins', (.27, .42, .103), .7)

character = bpy.data.collections.new('TOTORO • optimized sculpture')
bpy.context.scene.collection.children.link(character)

def move_character(obj):
    for col in list(obj.users_collection):
        col.objects.unlink(obj)
    character.objects.link(obj)
    return obj

def mesh_object(name, verts, faces, mat):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    character.objects.link(obj)
    obj.data.materials.append(mat)
    for poly in mesh.polygons:
        poly.use_smooth = True
    return obj

def sphere(name, loc, scale, mat, segments=32, rings=20):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=loc)
    obj = move_character(bpy.context.object)
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj

def tube(name, points, radius, mat, resolution=3, taper=True):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = 3 if len(points)>10 else 8
    curve.bevel_depth = radius
    curve.bevel_resolution = resolution
    sp = curve.splines.new('BEZIER')
    sp.bezier_points.add(len(points)-1)
    for i, (p, co) in enumerate(zip(sp.bezier_points, points)):
        p.co = co
        p.handle_left_type = 'AUTO'
        p.handle_right_type = 'AUTO'
        p.radius = 1 - .85 * (i / max(1, len(points)-1)) if taper else 1
    ob = bpy.data.objects.new(name, curve)
    character.objects.link(ob)
    ob.data.materials.append(mat)
    return ob

# Smoothly lofted torso: a broad crown, cheek shelf, shoulder transition,
# lower belly and tucked haunches. The same surface drives all attached details.
BODY_PROFILE = [
    (.155, .015, .02), (.24, .64, .49), (.46, 1.10, .80),
    (.82, 1.40, 1.01), (1.28, 1.565, 1.125), (1.78, 1.59, 1.15),
    (2.20, 1.52, 1.085), (2.60, 1.395, .965), (2.89, 1.305, .855),
    (3.16, 1.30, .835), (3.39, 1.255, .81), (3.64, 1.10, .695),
    (3.84, .935, .52), (3.98, .69, .34), (4.045, .32, .16),
    (4.065, .008, .008),
]

def profile_value(profile, z, column):
    if z <= profile[0][0]: return profile[0][column]
    if z >= profile[-1][0]: return profile[-1][column]
    for i in range(len(profile)-1):
        a, b = profile[i], profile[i+1]
        if a[0] <= z <= b[0]:
            prev, nxt = profile[max(0,i-1)], profile[min(len(profile)-1,i+2)]
            t = (z-a[0])/(b[0]-a[0]); d = b[0]-a[0]
            m0 = (b[column]-prev[column])/(b[0]-prev[0])
            m1 = (nxt[column]-a[column])/(nxt[0]-a[0])
            return ((2*t**3-3*t*t+1)*a[column] + (t**3-2*t*t+t)*d*m0
                    + (-2*t**3+3*t*t)*b[column] + (t**3-t*t)*d*m1)

def facial_volume(x,z):
    muzzle = .115*math.exp(-(x/.78)**4-((z-3.22)/.34)**4)
    cheeks = .080*math.exp(-((abs(x)-.94)/.28)**2-((z-3.25)/.28)**2)
    brow = .030*math.exp(-((abs(x)-.65)/.20)**2-((z-3.68)/.10)**2)
    chin = .026*math.exp(-(x/.70)**4-((z-2.83)/.13)**2)
    socket = .024*math.exp(-((abs(x)-.65)/.16)**4-((z-3.55)/.17)**4)
    return muzzle+cheeks+brow+chin-socket

def body_surface(theta,phi):
    z=2.11+1.955*math.cos(theta)
    rx=profile_value(BODY_PROFILE,z,1); ry=profile_value(BODY_PROFILE,z,2)
    x=rx*math.cos(phi); y=ry*math.sin(phi)
    facing=max(0,-math.sin(phi))
    y-=facial_volume(x,z)*facing**3
    # Shallow, flowing variations in the haunches avoid a perfect lathed surface.
    x*=1+.007*math.cos(phi*4)*math.exp(-((z-1.0)/.65)**2)
    return Vector((x,y,z))

def body_point(theta, phi, displacement=0):
    p=body_surface(theta,phi)
    dt=body_surface(theta+.0001,phi)-body_surface(theta-.0001,phi)
    dp=body_surface(theta,phi+.0001)-body_surface(theta,phi-.0001)
    n=dt.cross(dp).normalized()
    return p+n*displacement,n

def front(x, z, extra=0):
    rx=profile_value(BODY_PROFILE,z,1); ry=profile_value(BODY_PROFILE,z,2)
    f=math.sqrt(max(.001,1-(x/rx)**2))
    return -ry*f-facial_volume(x,z)*f**3-extra

verts, faces = [], []
RINGS, SEGMENTS = 100, 128
for j in range(RINGS+1):
    theta = .002 + (math.pi-.004)*j/RINGS
    for i in range(SEGMENTS):
        p, n = body_point(theta, 2*math.pi*i/SEGMENTS)
        p += n * swirl(p*23).x * .0015
        verts.append(tuple(p))
for j in range(RINGS):
    for i in range(SEGMENTS):
        a=j*SEGMENTS+i; b=j*SEGMENTS+(i+1)%SEGMENTS
        faces.append((a, a+SEGMENTS, b+SEGMENTS, b))
body = mesh_object('Body', verts, faces, fur)
# Close the tiny crown and underside rings; fur ribbons intentionally stay open.
body.data.polygons.foreach_set('use_smooth', [True]*len(body.data.polygons))
import bmesh
bm=bmesh.new(); bm.from_mesh(body.data)
bmesh.ops.holes_fill(bm,edges=[e for e in bm.edges if e.is_boundary],sides=0)
bm.to_mesh(body.data); bm.free()

# A thin patch follows the pear surface exactly, with an irregular soft boundary.
verts, faces = [], []
PATCH_RINGS, PATCH_SEGMENTS = 30, 112
for j in range(PATCH_RINGS+1):
    r = max(.0001, j/PATCH_RINGS)
    for i in range(PATCH_SEGMENTS):
        a = 2*math.pi*i/PATCH_SEGMENTS
        z = 1.62 + 1.155*r*math.cos(a)
        x = 1.205*r*math.sin(a)*(1-.065*math.cos(a))
        if j==PATCH_RINGS:
            z += .008*math.sin(a*39)+.003*math.sin(a*67)
        offset=.010*(1-min(1,max(0,(r-.95)/.05)))+.001
        verts.append((x, front(x,z,offset), z))
for j in range(PATCH_RINGS):
    for i in range(PATCH_SEGMENTS):
        a=j*PATCH_SEGMENTS+i; b=j*PATCH_SEGMENTS+(i+1)%PATCH_SEGMENTS
        faces.append((a,b,b+PATCH_SEGMENTS,a+PATCH_SEGMENTS))
belly_obj=mesh_object('Cream belly', verts, faces, belly)
# A feathered colour transition is stable at every view angle and needs no alpha.
belly_colors=belly_obj.data.color_attributes.new(name='Belly edge',type='FLOAT_COLOR',domain='POINT')
for index,vertex in enumerate(belly_obj.data.vertices):
    r=(index//PATCH_SEGMENTS)/PATCH_RINGS
    t=min(1,max(0,(r-.945)/.055)); t=t*t*(3-2*t)
    belly_colors.data[index].color=tuple(belly.diffuse_color[k]*(1-t)+fur.diffuse_color[k]*t for k in range(3))+(1,)
tint=belly.node_tree.nodes.new('ShaderNodeVertexColor');tint.layer_name='Belly edge'
belly.node_tree.links.new(tint.outputs['Color'],belly.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])

# Ears taper from a narrow root, through a wide middle, into gently curved tips.
def ear(side):
    verts, faces = [], []
    profile=[(0,.17),(.12,.145),(.28,.205),(.46,.23),(.67,.165),(.85,.080),(1,.003)]
    for z,r in profile:
        for i in range(32):
            a=i/32*2*math.pi
            x=side*(.72+.17*z+.025*math.sin(z*math.pi))+r*math.cos(a)
            x+=side*.018*math.sin(z*math.pi*.7)*(1 if side<0 else -.6)
            y=.045+.06*z+r*.66*math.sin(a)+(.043 if side<0 else -.018)*z*z
            # A longitudinal fold is sculpted into the front face of the ear.
            if math.sin(a)<0: y+=.027*math.sin(math.pi*z)*(-math.sin(a))**8
            verts.append((x,y,3.83+1.16*z))
    for j in range(len(profile)-1):
        for i in range(32):
            a=j*32+i; b=j*32+(i+1)%32
            faces.append((a,b,b+32,a+32))
    ob=mesh_object('Ear_L' if side<0 else 'Ear_R',verts,faces,fur)
    mod=ob.modifiers.new('Soft ear contours','SUBSURF'); mod.levels=2
    bpy.context.view_layer.objects.active=ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bm=bmesh.new();bm.from_mesh(ob.data)
    bmesh.ops.holes_fill(bm,edges=[e for e in bm.edges if e.is_boundary],sides=0)
    bm.to_mesh(ob.data);bm.free()
    # Recenter origins at the roots for browser secondary animation.
    pivot=Vector((side*.72,.045,3.83))
    for v in ob.data.vertices: v.co -= pivot
    ob.location=pivot
    return ob
ear(-1); ear(1)

def attach(ob,parent):
    # Parents here are unparented, so their own transform is their world transform.
    # matrix_world can be stale right after rotation_euler is set (the tail).
    ob.parent=parent; ob.matrix_parent_inverse=parent.matrix_basis.inverted()
    return ob

def paw(side, label):
    # A toe fan flows into a raised instep buried inside the haunch. The
    # weight-bearing sole is flat, unlike the previous squashed ellipsoid.
    profile=[(-1.015,.018,.145,.025),(-.92,.245,.185,.145),
             (-.73,.370,.235,.205),(-.44,.350,.290,.255),
             (-.10,.285,.325,.290),(.18,.195,.245,.210),(.31,.012,.18,.04)]
    v,f=[],[]
    for j in range(49):
        y=-1.015+1.325*j/48
        width,center,height=[profile_value(profile,y,k) for k in [1,2,3]]
        for k in range(48):
            angle=2*math.pi*k/48
            x=width*math.cos(angle)
            z=center+height*math.sin(angle)
            # Very shallow toe knuckles; the paw remains one continuous form.
            z+=.012*math.cos(x*31)*max(0,math.sin(angle))*math.exp(-((y+.82)/.17)**2)
            z=max(.024,z)
            v.append((side*.72+x+side*.045*max(0,-y),y,z))
    for j in range(48):
        for k in range(48):
            a=j*48+k;b=j*48+(k+1)%48
            f.append((b,a,a+48,b+48))
    f.extend([tuple(range(48)),tuple(reversed(range(48*48,49*48)))])
    ob=mesh_object('Foot_'+label,v,f,fur)
    for c in range(3):
        spread=c-1;x=side*.755+spread*.165
        y=-.952+.042*abs(spread)
        claw=tube('Toe_'+label+'_claw',[(x,y+.060,.195),(x+spread*.015,y-.037,.139),(x+spread*.019,y-.088,.079)],.045,claw_mat,2)
        attach(claw,ob)
    return ob

for side in [-1,1]:
    label='L' if side<0 else 'R'
    profile=[(1.17,1.52,-.30,.025,.04),(1.29,1.57,-.25,.20,.27),
             (1.58,1.59,-.13,.255,.355),(1.99,1.51,-.015,.29,.40),
             (2.37,1.33,.055,.30,.355),(2.67,1.13,.055,.27,.28),
             (2.87,1.04,.055,.08,.10)]
    v,f=[],[]
    for j in range(45):
        z=1.17+(2.87-1.17)*j/44
        cx,cy,rx,ry=[profile_value(profile,z,k) for k in [1,2,3,4]]
        for k in range(40):
            a=k/40*2*math.pi
            # Palm knuckles only affect the lower end of the continuous forearm.
            knuckle=1+.025*math.cos(5*a)*math.exp(-((z-1.30)/.14)**2)
            v.append((side*(cx+rx*math.cos(a)*knuckle),cy+ry*math.sin(a),z))
    for j in range(44):
        for k in range(40):
            a=j*40+k;b=j*40+(k+1)%40
            f.append((a,b,b+40,a+40) if side>0 else (b,a,a+40,b+40))
    f.extend([tuple(reversed(range(40))),tuple(range(44*40,45*40))])
    arm=mesh_object('Arm_'+label,v,f,fur)
    pivot=Vector((side*1.20,.015,2.6))
    for vertex in arm.data.vertices: vertex.co-=pivot
    arm.location=pivot
    paw(side,label)
    for c in range(5):
        x=side*(1.40+c*.078)
        z=1.27+.05*abs(c-2)/2
        claw=tube('Hand_'+label+'_claw',[(x,-.40,z),(x+side*.018,-.51,z-.09),(x+side*.014,-.52,z-.17)],.036,claw_mat,3)
        attach(claw,arm)

tail=sphere('Tail',(0,.86,.75),(.60,.79,.50),fur,40,24)
for vertex in tail.data.vertices:
    t=(vertex.co.y/.77+1)*.5
    vertex.co.x*=1-.40*t
    vertex.co.z=vertex.co.z*(1-.18*t)+.16*t*t
    vertex.co.y+=.10*t*t
tail.rotation_euler.x=-.30

for side in [-1,1]:
    x,z=side*.65,3.55
    y=front(x,z,.002)
    normal=Vector(((front(x+.001,z)-front(x-.001,z))/.002,-1,(front(x,z+.001)-front(x,z-.001))/.002)).normalized()
    rotation=normal.to_track_quat('-Y','Z')
    eye=sphere('Eye_L' if side<0 else 'Eye_R',(x,y,z),(.128,.052,.136),white,40,24)
    eye.rotation_mode='QUATERNION';eye.rotation_quaternion=rotation
    pupil=sphere('Pupil_L' if side<0 else 'Pupil_R',Vector((x,y,z))+rotation@Vector((-side*.007,-.051,.004)),(.049,.012,.056),black,32,20)
    pupil.rotation_mode='QUATERNION';pupil.rotation_quaternion=rotation
    sphere('Eye catchlight',pupil.location+rotation@Vector((-.014,-.012,.019)),(.009,.003,.010),white,12,8)
    # Two fleshy patches share a Blink shape key. The eyes retain their volume.
    lid_vertices,lid_closed,lid_faces=[],[],[]
    center=Vector((x,y,z))
    for upper in [True,False]:
        start=len(lid_vertices);sign=1 if upper else -1
        for j in range(9):
            t=j/8
            for k in range(41):
                angle=math.pi*k/40
                xx=(.129*(1-t)+.153*t)*math.cos(angle)
                for closed,dest in [(False,lid_vertices),(True,lid_closed)]:
                    opening=-.040 if closed else sign*.127
                    zz=(opening*(1-t)+sign*.158*t)*math.sin(angle)
                    dome=math.sqrt(max(0,1-(xx/.143)**2-(zz/.151)**2))
                    crease=.006*math.exp(-(t/.22)**2)*math.sin(angle) if closed else 0
                    p=center+rotation@Vector((xx,-.074*dome-.002+crease,zz))
                    # The outer row dissolves into the cheek instead of a tube rim.
                    p.y=min(p.y,front(p.x,p.z,.001))
                    dest.append(tuple(p))
        for j in range(8):
            for k in range(40):
                a=start+j*41+k
                face=(a,a+1,a+42,a+41)
                lid_faces.append(tuple(reversed(face)) if upper else face)
    lid=mesh_object('Eyelids_'+('L' if side<0 else 'R'),lid_vertices,lid_faces,fur)
    lid.shape_key_add(name='Basis')
    closed=lid.shape_key_add(name='Blink')
    for vertex,co in zip(closed.data,lid_closed):vertex.co=co
    closed.value=0

# Broad, gently triangular nose, rounded with subdivision.
outline=[(-.28,3.425),(-.20,3.478),(0,3.490),(.20,3.478),(.28,3.425),(.14,3.383),(0,3.355),(-.14,3.383)]
verts=[]
for depth,scale in [(-.012,1),(.090,1),(.14,.58)]:
    for x,z in outline:
        x*=scale;z=3.425+(z-3.425)*scale
        verts.append((x,front(x,z,depth),z))
faces=[]
for j in range(2):
    for i in range(8):
        a=j*8+i;b=j*8+(i+1)%8;faces.append((a,b,b+8,a+8))
faces.extend([tuple(reversed(range(8))),tuple(range(16,24))])
nose=mesh_object('Nose',verts,faces,nose_mat)
sub=nose.modifiers.new('Rounded nose','SUBSURF');sub.levels=2
bpy.context.view_layer.objects.active=nose;bpy.ops.object.modifier_apply(modifier=sub.name)
for side in [-1,1]:
    sphere('Nostril',(side*.125,front(side*.125,3.403,.126),3.403),(.034,.013,.017),mouth_mat,20,12)

# The closed crescent grin is a curved mouth inset with ten rounded enamel
# crowns, not a white plane or cubes. Every crown follows the cheek in depth.
def smile_bounds(x):
    t=min(1,abs(x)/.99)
    return 2.825+.438*t*t,3.190+.073*t*t

def smile_surface(name,x0,x1,mat,offset,inset=0,crown=False):
    v,f=[],[];cols=12 if crown else 80;rows=8
    for j in range(rows+1):
        t=j/rows
        for i in range(cols+1):
            u=i/cols
            # Round crown corners in the surface itself, keeping broad tooth faces.
            corner=.008*(abs(2*t-1)**10) if crown else 0
            x=x0+corner+(x1-x0-2*corner)*u
            bottom,top=smile_bounds(x)
            z=bottom+inset+(top-bottom-2*inset)*t
            bulge=.012*math.sin(math.pi*u)*math.sin(math.pi*t) if crown else 0
            v.append((x,front(x,z,offset+bulge),z))
    for j in range(rows):
        for i in range(cols):
            a=j*(cols+1)+i;f.append((a,a+1,a+cols+2,a+cols+1))
    ob=mesh_object(name,v,f,mat)
    sol=ob.modifiers.new('Enamel depth' if crown else 'Mouth inset thickness','SOLIDIFY');sol.thickness=.018 if crown else .006
    bpy.context.view_layer.objects.active=ob;bpy.ops.object.modifier_apply(modifier=sol.name)
    return ob
smile_surface('Mouth_inset',-.991,.991,mouth_mat,.023)
edges=[-.982,-.824,-.642,-.437,-.221,0,.221,.437,.642,.824,.982]
for i in range(len(edges)-1):
    smile_surface('Tooth_%02d'%(i+1),edges[i]+.0035,edges[i+1]-.0035,enamel,.039,.014,True)
for row in [0,1]:
    points=[]
    for i in range(33):
        x=-.99+1.98*i/32;z=smile_bounds(x)[row]
        points.append((x,front(x,z,.028),z))
    tube('Smile outline',points,.010,mouth_mat,2,False)
for side in [-1,1]:
    tube('Smile corner',[(side*.985,front(side*.985,3.264,.03),3.264),(side*1.015,front(side*1.015,3.287,.018),3.287),(side*1.006,front(side*1.006,3.316,.01),3.316)],.011,whisker_mat,2)

# Seven markings stay shallow, with their own matching fur across the edges.
chevron_outlines=[]
for row,(zs,xs) in enumerate([(2.40,[-.56,0,.56]),(1.99,[-.81,-.275,.275,.81])]):
    for k,x0 in enumerate(xs):
        w=.39 if row==0 else .37
        outline=[(-.5,-.09),(-.44,.012),(-.20,.14),(-.05,.18),(.13,.16),(.44,.01),(.5,-.075),(.32,-.055),(.012,.075),(-.31,-.075)]
        v=[(x0+u*w,front(x0+u*w,zs+v,.013),zs+v) for u,v in outline]
        chevron_outlines.append([(x0+u*w,zs+z) for u,z in outline])
        center=Vector((x0,front(x0,zs+.075,.013),zs+.075));v.append(tuple(center))
        f=[(len(v)-1,(i+1)%len(outline),i) for i in range(len(outline))]
        ob=mesh_object('Belly chevron',v,f,markings)
        subdiv=ob.modifiers.new('Conform markings','SUBSURF');subdiv.subdivision_type='SIMPLE';subdiv.levels=2
        bpy.context.view_layer.objects.active=ob;bpy.ops.object.modifier_apply(modifier=subdiv.name)
        for vertex in ob.data.vertices:vertex.co.y=front(vertex.co.x,vertex.co.z,.013)

for side in [-1,1]:
    for k in range(3):
        z=3.39-k*.13
        x=side*(1.04+.035*k)
        y=front(x,z,.018)
        tube('Whisker',[(x,y,z),(side*1.35,y-.07,z+.07-.04*k),(side*(1.96-.035*k),y-.16,z+.27-.20*k)],.016,whisker_mat,3)
        sphere('Whisker follicle',(x,y-.008,z),(.026,.013,.021),fur,16,10)

# A slightly cupped, asymmetrical leaf with sculpted veins.
leaf_verts, leaf_faces=[],[]
def leaf_point(t,u):
    envelope=math.sin(math.pi*t)
    width=.52*envelope**.72
    # Both tip cross-sections collapse to one point. The midrib rests on the
    # crown and the outer lobes drape down, rather than forming a floating brim.
    p=Vector((-.80+1.62*t,-.08+u*width+.055*envelope,
              4.024+.016*envelope+.04*t+(-.15*u*u+.023*math.sin(u*3+t*4)+.025*u**3*math.sin(t*5))*envelope))
    low,high=3.64,4.065
    for _ in range(16):
        height=(low+high)/2
        inside=(p.x/profile_value(BODY_PROFILE,height,1))**2+(p.y/profile_value(BODY_PROFILE,height,2))**2<1
        if inside:low=height
        else:high=height
    p.z=max(p.z,low+.010)
    return p
for j in range(25):
    for i in range(17):
        leaf_verts.append(tuple(leaf_point(.001+.998*j/24,-1+2*i/16)))
for j in range(24):
    for i in range(16):
        a=j*17+i;leaf_faces.append((a,a+17,a+18,a+1))
leaf=mesh_object('Leaf_hat',leaf_verts,leaf_faces,leaf_mat)
sol=leaf.modifiers.new('Delicate leaf edge','SOLIDIFY');sol.thickness=.006
bpy.context.view_layer.objects.active=leaf;bpy.ops.object.modifier_apply(modifier=sol.name)
leaf_parts=[leaf]
leaf_parts.append(tube('Leaf midrib',[tuple(leaf_point(t,0)+Vector((0,0,.008))) for t in [0,.2,.4,.6,.8,1]],.009,vein_mat,2))
for t in [.20,.35,.50,.65,.80]:
    for side in [-1,1]:
        leaf_parts.append(tube('Leaf vein',[tuple(leaf_point(t,0)+Vector((0,0,.008))),tuple(leaf_point(min(.99,t+.08),side*.5)+Vector((0,0,.008))),tuple(leaf_point(min(.99,t+.1),side*.9)+Vector((0,0,.009)))],.004,vein_mat,1))
leaf_parts.append(tube('Leaf stem',[tuple(leaf_point(0,0)),(-.92,-.01,4.12),(-.96,.02,4.22)],.023,vein_mat,2))
leaf_rig=bpy.data.objects.new('Leaf',None);character.objects.link(leaf_rig);leaf_rig.location=(0,0,4.06)
bpy.context.view_layer.update()
for ob in leaf_parts:
    ob.parent=leaf_rig;ob.matrix_parent_inverse=leaf_rig.matrix_world.inverted()

# Coat. Three layers of opaque, tapered ribbons share each part's fiber mesh:
#   undercoat  short, fine fuzz that softens the outline
#   locks      medium ribbons grouped into clumps whose tips converge, so the
#              coat reads as combed locks with darker partings between them
#   wisps      sparse long guard hairs that stand off the surface and break the
#              silhouette
# Roots are sampled by surface area and every layer follows one smooth flow
# field. Strands keep authored surface normals and root-to-tip color, so they
# shade like the skin beneath them. Opaque geometry avoids alpha overdraw in the
# real-time renderer, and roots are embedded so no cut edge shows.
from mathutils.kdtree import KDTree

def smoothstep(a,b,x):
    t=min(1,max(0,(x-a)/(b-a)));return t*t*(3-2*t)

def rng_for(*key):
    # Named streams keep each part's groom stable while other parts are tuned.
    return random.Random('|'.join(str(k) for k in key))

def turn(v,n,angle):
    return v*math.cos(angle)+n.cross(v)*math.sin(angle)

# Layer recipe. length and width are (min, max) in model units, lift is the
# (root, tip) angle above the surface in radians, tone is the (root, middle,
# tip) brightness of the ribbon and taper the width remaining at its last pair.
LAYERS={
    'under':dict(segments=2,length=(.024,.044),width=(.0024,.0036),lift=(.80,.15),tone=(.66,.92,1.03),taper=.48,embed=0),
    'locks':dict(segments=2,length=(.050,.088),width=(.0055,.0095),lift=(1.05,.30),tone=(.58,.95,1.10),taper=.60,embed=.003),
    'wisps':dict(segments=3,length=(.100,.190),width=(.0020,.0032),lift=(1.30,.70),tone=(.78,1.03,1.18),taper=.60,embed=.003),
}
# Strands per unit of surface area for each layer: undercoat, locks, wisps.
DENSITY={'torso':(440,420,85),'arm':(420,400,60),'tail':(360,330,55),'ear':(560,380,60),'foot':(260,170,0)}
CLUMP=5  # average strands per lock

def coat_flow(p,n,kind):
    if kind=='tail':d=Vector((p.x*.25,1,-.25))
    elif kind=='ear':d=Vector((p.x*.08,.12,1))
    else:
        sweep=.24*math.sin(p.x*2.3+p.z*1.8)
        if kind=='torso' and p.y<0:
            if p.z>2.70:sweep+=p.x*.5           # cheeks sweep outward
            elif p.z>.4:sweep+=p.x*.22          # chest and belly fan out
        d=Vector((sweep,.10*math.sin(p.x*3+p.y*2),-1))
    d+=swirl(p*1.7)*.30                         # slow swirls and cowlicks
    f=d-n*d.dot(n)
    if f.length<.04:f=Vector((0,-1,0))+n*n.y
    return f.normalized()

def face_clearance(p):
    # Distance to the mouth, eyes and nose: fur near them must stay short.
    if p.y>=0 or p.z<2.70:return 9
    bottom,top=smile_bounds(p.x)
    d=[math.hypot(max(abs(p.x)-1.015,0),max(bottom-p.z,p.z-top,0))]
    for side in [-1,1]:d.append(math.hypot(p.x-side*.65,p.z-3.55)-.17)
    d.append(math.hypot(max(abs(p.x)-.30,0),max(3.33-p.z,p.z-3.51,0)))
    return min(d)

def part_scale(p,kind,group):
    # Returns (length scale, cap on the final length, whether the coat is allowed to stand up).
    cap=.22;tall=True;s=1.0
    if kind=='torso':
        s+=.55*math.exp(-((abs(p.x)-1.12)/.30)**2-((p.z-3.0)/.55)**2)   # cheek ruff
        s+=.25*math.exp(-((p.z-2.62)/.35)**2)                            # collar under the chin
        s+=.15*math.exp(-((p.z-1.2)/.5)**2)                              # haunches
        s*=.55+.45*smoothstep(.3,1.1,p.z)                                 # short at the plinth
        if p.y<0 and p.z>2.78:s*=.38+.62*smoothstep(.95,1.28,abs(p.x))   # short face keeps the grin crisp
        if p.z>3.80 and abs(p.x)<.85 and abs(p.y+.08)<.56:s*=.3;tall=False  # under the leaf
        if group=='belly':s*=.6;cap=.07
        if group=='mark':s*=.6;cap=.04
        clear=face_clearance(p)
        cap=min(cap,max(.015,.9*(clear-.02)))
    elif kind=='arm':s=.5+.5*smoothstep(1.25,1.70,p.z)     # claws stay clear
    elif kind=='tail':s=1.3
    elif kind=='ear':s=.85;cap=.12
    elif kind=='foot':s=.7*(.5 if p.y<-.8 else 1);cap=.06
    return s,cap,tall

def base_color(mat,p):
    base=list(mat.diffuse_color[:3])
    if mat==belly:
        bz=(p.z-1.62)/1.155
        r=math.sqrt((p.x/(1.205*(1-.065*bz)))**2+bz*bz)
        t=smoothstep(.945,1.0,r)
        base=[base[k]*(1-t)+fur.diffuse_color[k]*t for k in range(3)]
    return base

fiber_materials={}
class Coat:
    """Accumulates strands for one output mesh."""
    def __init__(self,name,mat):
        self.name,self.mat=name,mat
        self.verts,self.faces,self.normals,self.colors=[],[],[],[]

    def add(self,layer,root,n,pts,axis,width,tone):
        cfg=LAYERS[layer];segments=cfg['segments'];a=len(self.verts)
        base=base_color(self.mat,root)
        t0,t1,t2=cfg['tone']
        if self.mat==belly:t0,t2=max(t0,.72),min(t2,1.07)
        def factor(s):return t0+(t1-t0)*min(1,s/.5)+(t2-t1)*max(0,(s-.5)/.5)
        line=[root]+pts
        for k in range(segments):
            s=k/segments
            half=width*.5*(1-(1-cfg['taper'])*(k/max(1,segments-1)))
            for sign in [-1,1]:
                self.verts.append(tuple(line[k]+axis*half*sign))
                self.colors.append(tuple(c*tone*factor(s) for c in base)+(1,))
        self.verts.append(tuple(line[-1]))
        self.colors.append(tuple(c*tone*factor(1) for c in base)+(1,))
        for k in range(segments-1):
            i=a+2*k;self.faces.extend([(i,i+1,i+2),(i+1,i+3,i+2)])
        i=a+2*(segments-1);self.faces.append((i,i+1,a+2*segments))
        self.normals.extend([tuple(n)]*(2*segments+1))

    def build(self):
        if self.mat.name not in fiber_materials:
            fm=self.mat.copy();fm.name=self.mat.name+' fibers'
            tint=fm.node_tree.nodes.new('ShaderNodeVertexColor');tint.name='Coat tint';tint.layer_name='Coat tint'
            fm.node_tree.links.new(tint.outputs['Color'],fm.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
            fiber_materials[self.mat.name]=fm
        ob=mesh_object(self.name,self.verts,self.faces,fiber_materials[self.mat.name])
        ob.visible_shadow=False
        ob.data.normals_split_custom_set_from_vertices(self.normals)
        color=ob.data.color_attributes.new(name='Coat tint',type='FLOAT_COLOR',domain='POINT')
        for item,value in zip(color.data,self.colors):item.color=value
        return ob

def strand_curve(p,n,f,across,length,lift0,lift1,curl,segments):
    pts=[];pos=p.copy()
    for k in range(segments):
        s=(k+.5)/segments
        beta=lift0+(lift1-lift0)*s**.8
        d=(f*math.cos(beta)+n*math.sin(beta)+across*curl*s).normalized()
        pos=pos+d*(length/segments);pts.append(pos)
    return pts

def new_lock(p,n,kind,rng,layer):
    f=coat_flow(p,n,kind)
    spread={'under':.45,'locks':.34,'wisps':.55}[layer]
    return dict(p=p.copy(),n=n.copy(),f=turn(f,n,rng.gauss(0,spread)),len=rng.uniform(.8,1.3),
                lift=rng.uniform(.85,1.2),tone=rng.gauss(1,.07 if layer=='locks' else .04),
                curl=rng.uniform(-.35,.35)*(1.7 if layer=='wisps' else 1),pull=rng.uniform(.45,.75))

def lay_strand(coat,layer,p,n,lock,kind,group,rng,guide=None):
    cfg=LAYERS[layer]
    scale,cap,tall=part_scale(p,kind,group)
    if not tall and layer!='under':return
    f=lock['f']-n*lock['f'].dot(n)
    f=f.normalized() if f.length>.05 else coat_flow(p,n,kind)
    jitter=guide is not None or layer!='locks'
    if jitter:f=turn(f,n,rng.gauss(0,.16 if layer=='locks' else .12))
    across=n.cross(f).normalized()
    length=min(cap,rng.uniform(*cfg['length'])*lock['len']*scale*rng.uniform(.88,1.12))
    lift=lock['lift'] if tall else .5
    pts=strand_curve(p,n,f,across,length,cfg['lift'][0]*lift,cfg['lift'][1]*lift,lock['curl'],cfg['segments'])
    if guide is not None and guide['pts'] is not None:
        # Pull the middle and tip toward the lock's own guide strand.
        offset=p-guide['p']
        for k in range(cfg['segments']):
            last=k==cfg['segments']-1
            target=guide['pts'][k]+offset*(.30 if last else .65)
            amount=lock['pull']*(1 if last else .6)
            pts[k]=pts[k]*(1-amount)+target*amount
    root=p-n*cfg['embed']
    angle=max(-1.3,min(1.3,rng.gauss(0,.7)))
    axis=(across*math.cos(angle)+n*math.sin(angle)).normalized()
    width=rng.uniform(*cfg['width'])*(.6+.4*min(1,scale))
    tone=lock['tone']*rng.gauss(1,.03)*(.94+.12*(.5+.5*math.sin(p.x*5.1+p.z*4.3+p.y*3.7)))
    coat.add(layer,root,n,pts,axis,width,tone)

def surface_samples(ob,count,rng,kind):
    # Sample triangles by surface area, using barycentric interpolated normals.
    # These parts are unparented, so their own transform is their world transform.
    # matrix_world is evaluated lazily and can still be stale here, which would
    # sample the fur from an unrotated tail.
    assert ob.parent is None
    world=ob.matrix_basis.copy()
    # Fan-triangulate canonical polygons in a fixed order. Blender's loop triangles,
    # polygon order and each polygon's first corner can change from run to run.
    vertices=ob.data.vertices;triangles=[];cumulative=[];area=0
    rings=[]
    for poly in ob.data.polygons:
        ring=list(poly.vertices);start=ring.index(min(ring))
        rings.append(ring[start:]+ring[:start])
    for ring in sorted(rings):
        for k in range(1,len(ring)-1):
            tri=(ring[0],ring[k],ring[k+1]);triangles.append(tri)
            area+=(vertices[tri[1]].co-vertices[tri[0]].co).cross(vertices[tri[2]].co-vertices[tri[0]].co).length/2
            cumulative.append(area)
    # Vertex normals from the same triangles: the cached ones go stale after vertices are edited.
    normals=[Vector((0,0,0)) for _ in vertices]
    for tri in triangles:
        face=(vertices[tri[1]].co-vertices[tri[0]].co).cross(vertices[tri[2]].co-vertices[tri[0]].co)
        for k in tri:normals[k]+=face
    samples=[]
    for _ in range(count):
        tri=triangles[min(len(triangles)-1,bisect_left(cumulative,rng.random()*area))]
        a,b,c=[vertices[k] for k in tri]
        u,v=rng.random(),rng.random()
        if u+v>1:u,v=1-u,1-v
        p=world@(a.co*(1-u-v)+b.co*u+c.co*v)
        n=(world.to_3x3()@(normals[tri[0]].normalized()*(1-u-v)+normals[tri[1]].normalized()*u+normals[tri[2]].normalized()*v)).normalized()
        if kind=='foot' and (p.z<.07 or n.z<-.25):continue
        samples.append((p+n*.001,n,'all'))
    return samples

def body_frame(theta,phi,displacement=0):
    p=body_surface(theta,phi)
    dt=body_surface(theta+.0001,phi)-body_surface(theta-.0001,phi)
    dp=body_surface(theta,phi+.0001)-body_surface(theta,phi-.0001)
    c=dt.cross(dp);n=c.normalized()
    return p+n*displacement,n,c.length/4e-8

_scan=[body_frame(math.acos(c/20),2*math.pi*j/48)[2]/math.sin(math.acos(c/20)) for c in range(-19,20) for j in range(48)]
AREA_MAX=max(_scan)*1.05

def torso_samples(count,rng):
    # Uniform in cos(theta) and phi is denser at the head; accept by area element.
    out=[]
    while len(out)<count:
        theta=math.acos(rng.uniform(-.99,.99));phi=rng.random()*2*math.pi
        p,n,a=body_frame(theta,phi,.002)
        if rng.random()*AREA_MAX<a/math.sin(theta):out.append((p,n))
    return out

def inside_polygon(x,z,polygon):
    inside=False
    for i,(ax,az) in enumerate(polygon):
        bx,bz=polygon[i-1]
        if (az>z)!=(bz>z) and x<(bx-ax)*(z-az)/(bz-az)+ax: inside=not inside
    return inside

def torso_group(p):
    belly_z=(p.z-1.62)/1.155
    is_belly=(p.y<0 and (p.x/(1.205*(1-.065*belly_z)))**2+belly_z**2<1)
    if p.y<0 and p.z>2.78 and abs(p.x)<1.10:
        eyes=any(((p.x-side*.65)/.17)**2+((p.z-3.55)/.18)**2<1 for side in [-1,1])
        nose=abs(p.x)<.32 and 3.33<p.z<3.51
        bottom,top=smile_bounds(p.x)
        mouth=abs(p.x)<1.025 and bottom-.035<p.z<top+.045
        return None if (eyes or nose or mouth) else 'face'
    if is_belly:
        marked=any(inside_polygon(p.x,p.z,polygon) for polygon in chevron_outlines)
        r=math.sqrt((p.x/(1.205*(1-.065*belly_z)))**2+belly_z**2)
        offset=.010*(1-min(1,max(0,(r-.95)/.05)))+.003
        p.y=front(p.x,p.z,.015 if marked else offset)
        return 'mark' if marked else 'belly'
    return 'grey'

def lay_layer(kind,layer,samples,coats,rng):
    """Lay one layer over (p, n, group) samples. Locks are clumped around random guides."""
    if not samples:return
    if layer=='locks':
        guides=[i for i in range(len(samples)) if rng.random()<1/CLUMP] or [0]
        tree=KDTree(len(guides))
        for j,i in enumerate(guides):tree.insert(samples[i][0],j)
        tree.balance()
        radius=math.sqrt(CLUMP/(math.pi*max(1,len(samples)/max(1e-6,sample_area[kind]))))
        records=[]
        for i in guides:
            p,n,group=samples[i];lock=new_lock(p,n,kind,rng,layer)
            scale,cap,tall=part_scale(p,kind,group)
            guide=dict(p=p,pts=None)
            # The guide's own strand defines where the clump converges.
            f=lock['f']-n*lock['f'].dot(n);f=f.normalized() if f.length>.05 else coat_flow(p,n,kind)
            across=n.cross(f).normalized()
            cfg=LAYERS['locks']
            length=min(cap,sum(cfg['length'])/2*lock['len']*scale)
            guide['pts']=strand_curve(p,n,f,across,length,cfg['lift'][0]*lock['lift'],cfg['lift'][1]*lock['lift'],lock['curl'],cfg['segments'])
            records.append((lock,guide))
        for p,n,group in samples:
            co,j,dist=tree.find(p)
            if dist>2.5*radius:
                lock=new_lock(p,n,kind,rng,layer);guide=None
            else:lock,guide=records[j]
            lay_strand(coats[group],layer,p,n,lock,kind,group,rng,guide)
    else:
        for p,n,group in samples:
            lay_strand(coats[group],layer,p,n,new_lock(p,n,kind,rng,layer),kind,group,rng)

sample_area={}
def coat_part(kind,label,area,roots,coats):
    """roots: function(count, rng) -> list of (p, n, group)."""
    sample_area[kind]=area
    for layer,per_area in zip(['under','locks','wisps'],DENSITY[kind]):
        count=int(per_area*area)
        if count<=0:continue
        rng=rng_for('coat',label,layer)
        lay_layer(kind,layer,roots(count,rng),coats,rng)

# Torso: grey coat, short face fur, ivory belly and the seven dark chevrons.
torso_coats={'grey':Coat('Fine grey fibers',fur),'face':Coat('Face fibers',fur),
             'belly':Coat('Fine ivory fibers',belly),'mark':Coat('Chevron fibers',markings)}
def torso_roots(count,rng):
    out=[]
    for p,n in torso_samples(count,rng):
        group=torso_group(p)
        if group:out.append((p,n,group))
    return out
# Area of the analytic surface, not the noisy Body mesh, so strand counts never change.
body_area=sum(body_frame(math.pi*(j+.5)/120,2*math.pi*(i+.5)/160)[2]*(math.pi/120)*(2*math.pi/160) for j in range(120) for i in range(160))
coat_part('torso','torso',body_area,torso_roots,torso_coats)
for coat in torso_coats.values():coat.build()

# Larger tapered locks interrupt the outline at cheeks and shoulders. Roots sit
# inside the body; the locks point with the fur flow instead of radiating spikes.
tuft_rng=rng_for('coat','cheek tufts')
tuft_verts,tuft_faces=[],[]
for side in [-1,1]:
    for k in range(18):
        z=2.77+k*.050
        theta=math.acos((z-2.11)/1.955)
        phi=(-.28 if side>0 else math.pi+.28)+tuft_rng.uniform(-.12,.12)
        p,n=body_point(theta,phi,-.020)
        tangent=Vector((0,0,1));w=tuft_rng.uniform(.018,.030)
        tip=p+Vector((side*tuft_rng.uniform(.040,.060),-.012,-.04))
        a=len(tuft_verts)
        tuft_verts.extend([tuple(p-tangent*w),tuple(p+tangent*w),tuple(p+n*.023),tuple(tip)])
        tuft_faces.extend([(a,a+2,a+3),(a+2,a+1,a+3)])
mesh_object('Cheek fur tufts',tuft_verts,tuft_faces,fur)

# Appendages sample their own triangles, then follow the same recipe.
for name,kind in [('Arm_L','arm'),('Arm_R','arm'),('Ear_L','ear'),('Ear_R','ear'),('Tail','tail'),('Foot_L','foot'),('Foot_R','foot')]:
    ob=bpy.data.objects[name];bpy.context.view_layer.update()
    area=sum(poly.area for poly in ob.data.polygons)
    coat=Coat(name+' fibers',fur)
    coat_part(kind,name,area,lambda count,rng,ob=ob,kind=kind:surface_samples(ob,count,rng,kind),{'all':coat})
    attach(coat.build(),ob)


# Convert curves once; export only the sculpture, not the render stage.
bpy.ops.object.select_all(action='DESELECT')
for ob in list(character.objects):
    if ob.type=='CURVE':
        ob.select_set(True);bpy.context.view_layer.objects.active=ob
        bpy.ops.object.convert(target='MESH');ob.select_set(False)

# Join repeated static details by material, preserving animated parts.
for prefix in ['Whisker','Belly chevron','Toe_L_claw','Toe_R_claw','Hand_L_claw','Hand_R_claw','Eye catchlight','Leaf vein','Whisker follicle']:
    # Follicles remain fur; never merge them into the whisker material batch.
    items=[o for o in character.objects if o.type=='MESH' and o.name.startswith(prefix) and (prefix=='Whisker follicle' or not o.name.startswith('Whisker follicle'))]
    if len(items)>1:
        bpy.ops.object.select_all(action='DESELECT')
        for o in items:o.select_set(True)
        bpy.context.view_layer.objects.active=items[0];bpy.ops.object.join()
        items[0].name=prefix+'s'

import runpy
runpy.run_path(str(ROOT/'scripts'/'totoro_rig.py'))['build_rig'](character)

for ob in character.objects:
    if ob.type=='MESH':
        # Export shaders are deliberately small; runtime adds procedural micro-normal.
        ob.data.calc_loop_triangles()

bpy.ops.object.select_all(action='DESELECT')
for ob in character.objects:ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(SOURCE/'totoro-raw.glb'),export_format='GLB',use_selection=True,export_apply=False,export_yup=True,export_animations=False,export_morph=True,export_morph_normal=True,export_cameras=False,export_lights=False,export_vertex_color='ACTIVE',export_all_vertex_colors=False)
# Exporters may evaluate the last morph for normals; always save/render the rest pose.
for ob in character.objects:
    if ob.type=='MESH' and ob.data.shape_keys:
        for key in ob.data.shape_keys.key_blocks:key.value=0

# A studio remains in the editable .blend for high-resolution offline rendering.
studio=bpy.data.collections.new('STUDIO • render only');bpy.context.scene.collection.children.link(studio)
def studio_obj(ob):
    for col in list(ob.users_collection):col.objects.unlink(ob)
    studio.objects.link(ob)
    return ob
stage_mat=material('Stage • porcelain',(.69,.72,.64),.84)
bpy.ops.mesh.primitive_plane_add(size=200, location=(0,0,-.015))
ground=studio_obj(bpy.context.object);ground.data.materials.append(stage_mat);ground.is_shadow_catcher=True

def area(name,loc,power,color,size):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.color=color;data.shape='DISK';data.size=size
    ob=bpy.data.objects.new(name,data);studio.objects.link(ob);ob.location=loc
    ob.rotation_euler=(Vector((0,0,2))-ob.location).to_track_quat('-Z','Y').to_euler()
area('Large window',(-4,-5,8),850,(1,.92,.79),5)
area('Cool fill',(4,-1,5),260,(.82,.90,1),4)
area('Soft rim',(2,4,6),950,(.95,1,.88),3)
bpy.ops.object.camera_add(location=(4.4,-14.6,5.7))
camera=studio_obj(bpy.context.object);camera.name='Portrait camera'
camera.rotation_euler=(Vector((0,0,2.48))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO';camera.data.ortho_scale=6.50;bpy.context.scene.camera=camera
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=int(os.environ.get('TOTORO_SAMPLES','48'))
scene.cycles.use_denoising=True
scene.world.color=(.20,.20,.20)
scene.view_settings.view_transform='AgX'
scene.render.resolution_x=1100;scene.render.resolution_y=1100;scene.render.resolution_percentage=int(os.environ.get('TOTORO_RESOLUTION','100'))
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.film_transparent=True
scene.render.filepath=str(SOURCE/'totoro-render.png')
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'totoro.blend'))
stats={'triangles':sum(len(o.data.loop_triangles) for o in character.objects if o.type=='MESH'),'objects':len(character.objects),'materials':len({m.name for o in character.objects if o.type=='MESH' for m in o.data.materials}),'file_bytes':(SOURCE/'totoro-raw.glb').stat().st_size}
(SOURCE/'model-stats.json').write_text(json.dumps(stats,indent=2))
print('MODEL_STATS',json.dumps(stats),flush=True)
if os.environ.get('TOTORO_SKIP_RENDER')!='1': bpy.ops.render.render(write_still=True)
print('TOTORO_DONE',flush=True)
