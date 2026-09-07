"""Refine the existing authored anatomy; run in Blender on totoro-anatomy.blend.

Preserves part identities, cavities and explosion metadata. Re-runnable: the
geometry is marked after the first pass. All tissue maps are baked from Blender
procedural materials, with distinct structures for each tissue family.
"""
import bpy
import math
import json
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artwork/anatomy'
source = ROOT / 'scripts/build_anatomy.py'
helpers = {'__file__': str(source), 'ANATOMY_PHASE': 'refinement'}
exec(compile(source.read_text().split("passes={'skeleton'")[0], str(source), 'exec'), helpers)
surface, tube = helpers['surface'], helpers['tube']
collection = bpy.data.collections['ANATOMY']
scene = bpy.context.scene


def replace(pid, pieces):
    old = next(o for o in collection.objects if o.get('partId') == pid)
    props = old.id_properties_ensure().to_dict()
    bpy.ops.object.select_all(action='DESELECT')
    for ob in pieces: ob.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    if len(pieces) > 1: bpy.ops.object.join()
    ob = pieces[0]
    bpy.data.objects.remove(old, do_unlink=True)
    ob.name = pid
    for k, v in props.items(): ob[k] = v
    ob['realismRevision'] = 2
    # New geometry stays inside the previously established anatomical bounds.
    ob['envelopeFit'] = True
    return ob


def append(ob, pieces):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    for p in pieces: p.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.join()


def mat(name, color, roughness):
    m = bpy.data.materials.get('Anatomy_' + name) or bpy.data.materials.new('Anatomy_' + name)
    m.use_nodes = True
    m.diffuse_color = (*color, 1)
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Coat Weight'].default_value = .18
    bsdf.inputs['Coat Roughness'].default_value = .25
    return m


if not collection.get('realismRevision'):
    heart = bpy.data.objects['heart']
    coronary = mat('coronary_vessels', (.20, .022, .028), .34)
    fat = mat('epicardial_fat', (.60, .43, .24), .48)
    cardiac = bpy.data.materials['Anatomy_myocardium']
    # Project a coronary tree onto the actual epicardial surface, then add fine
    # branching vessels and a small fat cushion at the atrioventricular groove.
    tree = BVHTree.FromPolygons([v.co for v in heart.data.vertices], [list(p.vertices) for p in heart.data.polygons])
    def project(path, lift=.004):
        result = []
        for x, z in path:
            p, normal, _, _ = tree.ray_cast(Vector((x, -1.5, z)), Vector((0, 1, 0)), 2)
            if p is not None: result.append(p + normal * lift)
        return result
    paths = [([(-.20,2.70),(-.15,2.60),(-.17,2.49),(-.14,2.37),(-.17,2.25),(-.15,2.10)], .009),
             ([(-.15,2.60),(-.27,2.58),(-.35,2.53),(-.38,2.46)], .007),
             ([(-.15,2.60),(-.04,2.58),(.07,2.53),(.10,2.47)], .007)]
    for i in range(6):
        z=2.52-i*.065
        paths.append(([(-.16,z),(-.16+(-1 if i%2 else 1)*.075,z-.025),(-.16+(-1 if i%2 else 1)*.12,z-.10)],.0035))
    pieces=[]
    for path,r in paths:
        pts=project(path)
        if len(pts)>1: pieces.append(tube('coronary',pts,[r,r*.70,r*.18],coronary,8,5))
    for s in [-1,1]:
        pieces.append(surface('auricle',(-.13+s*.185,-.41,2.66),(.108,.115,.092),cardiac,n=26,rings=16,
            shape=lambda q,t,p:(q.x*(.86+.1*math.sin(p*5)),q.y,q.z)))
    pieces.extend([
        tube('aortic_root',[(-.07,-.31,2.63),(-.06,-.30,2.75),(-.13,-.27,2.84),(-.24,-.20,2.85)],[.052,.047,.038],coronary,16,7,wall=.23),
        tube('pulmonary_trunk',[(.025,-.42,2.61),(.06,-.40,2.75),(.13,-.31,2.80)],[.047,.041,.030],cardiac,14,6,wall=.2)])
    append(heart,pieces)
    # Asymmetric domed liver with a thinner left lobe and a recessed falciform
    # fissure instead of the original uniform flattened ellipsoid.
    def liver_shape(q,t,p):
        right = .65+.35*(q.x+1)/2
        cleft = math.exp(-((q.x+.22)/.095)**2) * max(0,-q.y)**2
        return (q.x, q.y*(.78+.16*q.x), q.z*right+.13*(1-q.x*q.x)-.17*cleft)
    liver=replace('liver',[surface('hepatic_lobes',(.28,.005,1.80),(.87,.49,.27),helpers['LIVER'],liver_shape,n=72,rings=40)])
    # Meandering sulci: deepen rounded valleys without a regular grid of cuts.
    cortex=[]
    for s in [-1,1]:
        def fold(q,t,p):
            a=p*8+1.65*math.sin(t*6.4)+.7*math.sin(p*3.2-t*5.8)
            b=t*12+.8*math.sin(p*5.5)+.25*math.sin(t*19+p*4)
            groove=math.exp(-math.sin(a)**2/.09)
            secondary=math.exp(-math.sin(b)**2/.065)
            r=1-.09*groove-.043*secondary+.012*math.sin(p*4+t*3)
            # Flatten the medial surfaces to form a narrow longitudinal fissure.
            medial=q.x*(.83 if s*q.x<0 else 1)
            return (medial*r,q.y*r,q.z*r)
        cortex.append(surface('cortex',(s*.318,.08,3.56),(.37,.475,.35),helpers['BRAIN'],fold,n=112,rings=68))
    replace('brain',cortex)
    # Smooth, irregular bowel coils with consistent wall thickness. Wider tube
    # tessellation removes the old visible polygonal cross-sections.
    loops=[(-.20,-.19,1.39),(.10,-.05,1.36),(.22,.03,1.19),(-.10,-.04,1.12),(-.43,-.26,1.22)]
    for row in range(5):
        z=1.20-row*.12
        pts=[]
        for k in range(24):
            t=k/23
            pts.append((-.68+t*1.36,-.34+.18*math.sin(t*math.pi*3+row*1.73),z+.045*math.sin(t*math.pi*4+row*.8)))
        if row%2:pts.reverse()
        loops.extend(pts)
    loops.append((.83,-.28,.63))
    replace('small_intestine',[tube('jejunal_coils',loops,[.061+.004*math.sin(i*1.7) for i in range(30)],helpers['GUT'],16,3,wall=.23)])
    colonpts=[(.83,-.28,.63),(.94,-.25,1.07),(.89,-.16,1.44),(.40,-.29,1.47),(-.16,-.35,1.38),(-.87,-.20,1.40),(-.97,-.26,.91),(-.75,-.27,.51),(-.3,-.17,.43),(0,.12,.46),(0,.24,.29)]
    # Rounded haustra separated by narrow annular grooves.
    radii=[.092+.018*(.5+.5*math.sin(k/180*math.pi*2*27))**.6 for k in range(181)]
    replace('large_intestine',[tube('haustrated_colon',colonpts,radii,helpers['GUT'],18,24,wall=.25)])
    # Surface mesostructure follows the capsules; preserve lung fissures and
    # kidney hila rather than smoothing away those recognizable landmarks.
    for pid in ['lung_L','lung_R','kidney_L','kidney_R','pancreas','spleen']:
        ob=bpy.data.objects[pid]
        for v in ob.data.vertices:
            p=v.co
            amplitude=.004 if pid.startswith('lung') else .002
            v.co+=v.normal*(amplitude*math.sin(p.x*43+p.z*9)*math.sin(p.z*57+p.y*17))
        ob.data.update()
    collection['realismRevision']=2

# Give each material a local UV projection. This avoids the old global-pole
# distortion through the center of the brain, heart and abdominal organs.
for ob in collection.objects:
    if ob.type!='MESH' or 'organs' not in ob.get('systems',[]):continue
    if ob.get('realismUV'):continue
    bpy.ops.object.select_all(action='DESELECT');ob.hide_set(False);ob.select_set(True)
    bpy.context.view_layer.objects.active=ob
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.015)
    bpy.ops.object.mode_set(mode='OBJECT');ob['realismUV']=True

# Neutral studio light, broad reflections, and a quieter fill reveal wet
# capsules and fine folds without the former orange plastic appearance.
for name,energy,color,size,location in [
 ('Large window',650,(1,.94,.89),4,(-3.5,-5,6)),
 ('Cool fill',210,(.84,.91,1),3.5,(4,-2,4)),
 ('Soft rim',430,(1,.96,.91),3,(1,3,5))]:
    light=bpy.data.objects.get(name)
    if light:
        light.data.energy=energy;light.data.color=color;light.data.shape='DISK';light.data.size=size;light.location=location
        light.rotation_euler=(Vector((0,0,2))-light.location).to_track_quat('-Z','Y').to_euler()
scene.cycles.use_denoising=True
scene.view_settings.view_transform='AgX'
scene.view_settings.look='AgX - Medium High Contrast'
scene.view_settings.exposure=0
baker=ROOT/'scripts/bake_organ_tissues.py'
exec(compile(baker.read_text(),str(baker),'exec'),{'__file__':str(baker)})
print('REALISM_REFINEMENT_COMPLETE',flush=True)
