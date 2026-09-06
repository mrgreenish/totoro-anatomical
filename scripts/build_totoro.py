"""Create an editable Totoro sculpture and a browser-ready glTF in Blender.

Run: blender -b --python scripts/build_totoro.py
Coordinates: Z up, face toward -Y. The glTF exporter converts to Y up.
"""
import bpy
import math
import random
import json
from pathlib import Path
from mathutils import Vector
from mathutils.noise import noise_vector

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
        tex.inputs['Scale'].default_value = 145
        tex.inputs['Detail'].default_value = 2
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = .17
        bump.inputs['Distance'].default_value = .014
        mat.node_tree.links.new(tex.outputs['Fac'], bump.inputs['Height'])
        mat.node_tree.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return mat

fur = material('Fur • warm slate', (.145, .175, .169), .88, .5, True)
belly = material('Belly • warm ivory', (.76, .715, .54), .93, .7, True)
markings = material('Seven chevrons', (.103, .131, .12), .91, .3)
inner_ear = material('Inner ears', (.20, .234, .216), .88, .4)
white = material('Eyes • ivory', (.94, .935, .845), .3)
black = material('Eyes and nose • obsidian', (.011, .016, .014), .27)
whisker_mat = material('Whiskers', (.027, .034, .026), .8)
claw_mat = material('Claws • bone', (.62, .57, .41), .65)
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
    curve.resolution_u = 10
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

def body_point(theta, phi, displacement=0):
    c, s = math.cos(theta), math.sin(theta)
    rx = 1.455 * s * (1 - .245*c)
    ry = .975 * s * (1 - .13*c)
    p = Vector((rx*math.cos(phi), ry*math.sin(phi), 2.11 + 1.955*c))
    n = Vector((p.x/1.455**2, p.y/.975**2, (p.z-2.11)/1.955**2)).normalized()
    return p+n*displacement, n

def front(x, z, extra=0):
    c = max(-.998, min(.998, (z-2.11)/1.955))
    s = math.sqrt(1-c*c)
    rx = 1.455*s*(1-.245*c)
    ry = .975*s*(1-.13*c)
    return -ry*math.sqrt(max(.02, 1-(x/rx)**2))-extra

verts, faces = [], []
RINGS, SEGMENTS = 64, 112
for j in range(RINGS+1):
    theta = .002 + (math.pi-.004)*j/RINGS
    for i in range(SEGMENTS):
        p, n = body_point(theta, 2*math.pi*i/SEGMENTS)
        p += n * noise_vector(p*23).x * .0015
        verts.append(tuple(p))
for j in range(RINGS):
    for i in range(SEGMENTS):
        a=j*SEGMENTS+i; b=j*SEGMENTS+(i+1)%SEGMENTS
        faces.append((a, a+SEGMENTS, b+SEGMENTS, b))
body = mesh_object('Body', verts, faces, fur)

# A thin patch follows the pear surface exactly, with an irregular soft boundary.
verts, faces = [], []
PATCH_RINGS, PATCH_SEGMENTS = 30, 112
for j in range(PATCH_RINGS+1):
    r = max(.0001, j/PATCH_RINGS)
    for i in range(PATCH_SEGMENTS):
        a = 2*math.pi*i/PATCH_SEGMENTS
        z = 1.85 + 1.285*r*math.cos(a)
        x = 1.095*r*math.sin(a)*(1-.045*math.cos(a))
        if j==PATCH_RINGS:
            z += .003*math.sin(a*39)
        verts.append((x, front(x,z,.014), z))
for j in range(PATCH_RINGS):
    for i in range(PATCH_SEGMENTS):
        a=j*PATCH_SEGMENTS+i; b=j*PATCH_SEGMENTS+(i+1)%PATCH_SEGMENTS
        faces.append((a,b,b+PATCH_SEGMENTS,a+PATCH_SEGMENTS))
mesh_object('Cream belly', verts, faces, belly)

# Ears taper from a narrow root, through a wide middle, into gently curved tips.
def ear(side):
    verts, faces = [], []
    profile=[(0,.14),(.13,.19),(.33,.245),(.58,.19),(.80,.10),(1,.006)]
    for z,r in profile:
        for i in range(32):
            a=i/32*2*math.pi
            verts.append((side*(.69+.14*z)+r*math.cos(a), .015+r*.58*math.sin(a), 3.78+1.25*z))
    for j in range(len(profile)-1):
        for i in range(32):
            a=j*32+i; b=j*32+(i+1)%32
            faces.append((a,b,b+32,a+32))
    ob=mesh_object('Ear_L' if side<0 else 'Ear_R',verts,faces,fur)
    mod=ob.modifiers.new('Soft ear contours','SUBSURF'); mod.levels=2
    bpy.context.view_layer.objects.active=ob
    bpy.ops.object.modifier_apply(modifier=mod.name)
    # Recenter origins at the roots for browser secondary animation.
    pivot=Vector((side*.69,.015,3.78))
    for v in ob.data.vertices: v.co -= pivot
    ob.location=pivot
    return ob
ear(-1); ear(1)

for side in [-1,1]:
    arm=sphere('Arm_L' if side<0 else 'Arm_R',(side*1.25,.01,1.97),(.32,.40,.86),fur,40,28)
    arm.rotation_euler.y=side*-.19
    pivot=Vector((side*1.20,.015,2.6))
    delta=arm.location-pivot
    for v in arm.data.vertices: v.co += arm.rotation_euler.to_matrix().inverted()@delta
    arm.location=pivot
    sphere('Foot_L' if side<0 else 'Foot_R',(side*.68,-.26,.235),(.43,.63,.235),fur,40,20)
    for c in range(3):
        sphere('Toe claw',(side*.68+(c-1)*.16,-.79,.18),(.046,.14,.06),claw_mat,16,10)
    for c in range(3):
        sphere('Hand claw',(side*(1.45+(c-1)*.055),-.27-(c%2)*.035,1.16+(c-1)*.027),(.033,.08,.095),claw_mat,12,8)

tail=sphere('Tail',(0,.91,.75),(.57,.77,.49),fur,40,24)
tail.rotation_euler.x=-.30

for side in [-1,1]:
    x,z=side*.53,3.39
    y=front(x,z,.02)
    eye=sphere('Eye_L' if side<0 else 'Eye_R',(x,y,z),(.163,.060,.17),white,32,20)
    eye.rotation_euler.z=side*-.22
    pupil=sphere('Pupil_L' if side<0 else 'Pupil_R',(x-side*.018,y-.059,z+.003),(.068,.025,.077),black,24,16)
    sphere('Eye catchlight',(x-side*.018-.019,y-.085,z+.030),(.016,.006,.018),white,12,8)

# Broad, gently triangular nose, rounded with subdivision.
verts=[(-.195,-.884,3.30),(.195,-.884,3.30),(0,-.91,3.157),(-.13,-1.00,3.286),(.13,-1.00,3.286),(0,-1.012,3.205),(0,-.855,3.26)]
faces=[(0,1,4,3),(3,4,5),(0,3,5,2),(1,2,5,4),(0,6,1),(1,6,2),(2,6,0)]
nose=mesh_object('Nose',verts,faces,black)
sub=nose.modifiers.new('Rounded nose','SUBSURF');sub.levels=2
bpy.context.view_layer.objects.active=nose;bpy.ops.object.modifier_apply(modifier=sub.name)

mouth_pts=[]
for i in range(9):
    x=-.32+i*.08
    z=3.09-.045*(1-(x/.32)**2)
    mouth_pts.append((x,front(x,z,.026),z))
tube('Quiet smile',mouth_pts,.012,whisker_mat,2,False)

# Seven softly raised herringbone belly markings.
for row,(zs,xs) in enumerate([(2.70,[-.56,0,.56]),(2.20,[-.79,-.265,.265,.79])]):
    for k,x0 in enumerate(xs):
        w=.30 if row==0 else .32
        outline=[(-.5,-.04),(-.40,.015),(-.10,.13),(0,.15),(.13,.12),(.48,-.03),(.5,-.05),(.30,-.03),(.015,.070),(-.29,-.025)]
        v=[(x0+u*w,front(x0+u*w,zs+v,.030),zs+v) for u,v in outline]
        center=Vector((x0,front(x0,zs+.075,.034),zs+.075));v.append(tuple(center))
        f=[(len(v)-1,i,(i+1)%len(outline)) for i in range(len(outline))]
        ob=mesh_object('Belly chevron',v,f,markings)
        sol=ob.modifiers.new('Marking edge','SOLIDIFY');sol.thickness=.008
        bpy.context.view_layer.objects.active=ob;bpy.ops.object.modifier_apply(modifier=sol.name)

for side in [-1,1]:
    for k in range(3):
        z=3.19-k*.11
        tube('Whisker',[(side*.91,front(side*.91,z,.02),z),(side*1.20,-.64,z+.03),(side*(1.69-.08*k),-.67,z+.18-.15*k)],.013,whisker_mat,2)

# A slightly cupped, asymmetrical leaf with sculpted veins.
leaf_verts, leaf_faces=[],[]
def leaf_point(t,u):
    width=.65*math.sin(math.pi*t)**.72
    return Vector((-.58+1.56*t, -.25+u*width+.1*math.sin(t*math.pi), 4.12+.14*math.sin(t*math.pi)+.10*u*u+.06*t+.065*math.sin(u*3+t*4)))
for j in range(25):
    for i in range(17):
        leaf_verts.append(tuple(leaf_point(.001+.998*j/24,-1+2*i/16)))
for j in range(24):
    for i in range(16):
        a=j*17+i;leaf_faces.append((a,a+17,a+18,a+1))
leaf=mesh_object('Leaf_hat',leaf_verts,leaf_faces,leaf_mat)
sol=leaf.modifiers.new('Delicate leaf edge','SOLIDIFY');sol.thickness=.018
bpy.context.view_layer.objects.active=leaf;bpy.ops.object.modifier_apply(modifier=sol.name)
leaf_parts=[leaf]
leaf_parts.append(tube('Leaf midrib',[tuple(leaf_point(t,0)+Vector((0,0,.016))) for t in [0,.2,.4,.6,.8,1]],.013,vein_mat,2))
for t in [.20,.35,.50,.65,.80]:
    for side in [-1,1]:
        leaf_parts.append(tube('Leaf vein',[tuple(leaf_point(t,0)+Vector((0,0,.016))),tuple(leaf_point(min(.99,t+.08),side*.5)+Vector((0,0,.016))),tuple(leaf_point(min(.99,t+.1),side*.9)+Vector((0,0,.017)))],.007,vein_mat,1))
leaf_parts.append(tube('Leaf stem',[(-.59,-.25,4.16),(-.73,-.18,4.25),(-.81,-.13,4.43)],.023,vein_mat,2))
leaf_rig=bpy.data.objects.new('Leaf',None);character.objects.link(leaf_rig);leaf_rig.location=(0,0,4.1)
bpy.context.view_layer.update()
for ob in leaf_parts:
    ob.parent=leaf_rig;ob.matrix_parent_inverse=leaf_rig.matrix_world.inverted()

# Short tapered triangular fibers provide a fuzzy silhouette without hair systems.
# One merged mesh per color; 22k triangles total, no alpha overdraw.
def fibers(name, points, mat):
    verts,faces=[],[]
    for p,n in points:
        length=random.uniform(.014,.030)
        tangent=n.cross(Vector((0,0,1)))
        if tangent.length<.01:tangent=Vector((1,0,0))
        tangent.normalize()
        tangent=tangent*math.cos(random.random()*6.28)+n.cross(tangent)*math.sin(random.random()*6.28)
        width=random.uniform(.002,.0045)
        lean=Vector((0,0,-.008))
        a=len(verts)
        verts.extend([tuple(p-tangent*width),tuple(p+tangent*width),tuple(p+n*length+lean)])
        faces.append((a,a+1,a+2))
    return mesh_object(name,verts,faces,mat)
grey_points=[];cream_points=[]
for _ in range(19000):
    theta=math.acos(random.uniform(-.98,.98));phi=random.random()*2*math.pi
    p,n=body_point(theta,phi,.002)
    is_belly=(p.y<0 and (p.x/1.095)**2+((p.z-1.85)/1.285)**2<1)
    # Keep eyes, nose and smile free of protruding strands.
    if p.y<0 and p.z>3.06 and abs(p.x)<.90: continue
    if is_belly:
        p.y=front(p.x,p.z,.017)
        cream_points.append((p,n))
    else: grey_points.append((p,n))
fibers('Fine grey fibers',grey_points,fur)
fibers('Fine ivory fibers',cream_points,belly)

# Convert curves once; export only the sculpture, not the render stage.
bpy.ops.object.select_all(action='DESELECT')
for ob in list(character.objects):
    if ob.type=='CURVE':
        ob.select_set(True);bpy.context.view_layer.objects.active=ob
        bpy.ops.object.convert(target='MESH');ob.select_set(False)

# Join repeated static details by material, preserving animated parts.
for prefix in ['Whisker','Belly chevron','Toe claw','Hand claw','Eye catchlight']:
    items=[o for o in character.objects if o.type=='MESH' and o.name.startswith(prefix)]
    if len(items)>1:
        bpy.ops.object.select_all(action='DESELECT')
        for o in items:o.select_set(True)
        bpy.context.view_layer.objects.active=items[0];bpy.ops.object.join()
        items[0].name=prefix+'s'

for ob in character.objects:
    if ob.type=='MESH':
        # Export shaders are deliberately small; runtime adds procedural micro-normal.
        ob.data.calc_loop_triangles()

bpy.ops.object.select_all(action='DESELECT')
for ob in character.objects:ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(SOURCE/'totoro-raw.glb'),export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_animations=False,export_cameras=False,export_lights=False)

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
area('Cool fill',(4,-1,5),450,(.78,.88,1),4)
area('Soft rim',(2,4,6),1100,(.93,1,.79),3)
bpy.ops.object.camera_add(location=(6.8,-13.6,6.7))
camera=studio_obj(bpy.context.object);camera.name='Portrait camera'
camera.rotation_euler=(Vector((0,0,2.48))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO';camera.data.ortho_scale=6.50;bpy.context.scene.camera=camera
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=48
scene.cycles.use_denoising=True
scene.world.color=(.30,.30,.30)
scene.view_settings.view_transform='AgX'
scene.render.resolution_x=1100;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.film_transparent=True
scene.render.filepath=str(SOURCE/'totoro-render.png')
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'totoro.blend'))
stats={'triangles':sum(len(o.data.loop_triangles) for o in character.objects if o.type=='MESH'),'objects':len(character.objects),'materials':len({m.name for o in character.objects if o.type=='MESH' for m in o.data.materials}),'file_bytes':(SOURCE/'totoro-raw.glb').stat().st_size}
(SOURCE/'model-stats.json').write_text(json.dumps(stats,indent=2))
print('MODEL_STATS',json.dumps(stats),flush=True)
bpy.ops.render.render(write_still=True)
print('TOTORO_DONE',flush=True)
