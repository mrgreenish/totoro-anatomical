"""Add repeatable human-inspired pelvic variants to the refined Blender source.

blender -b artwork/anatomy/totoro-anatomy.blend --python scripts/build_reproductive.py
node scripts/optimize-reproductive.mjs

Blender Z up, anterior -Y. Outer genital envelopes belong only to ANATOMY.
References: OpenStax Anatomy & Physiology, sections 27.1 and 27.2.
"""
import bpy
import bmesh
import json
import math
import numpy as np
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artwork/anatomy'
source = ROOT / 'scripts/build_anatomy.py'
h = {'__file__': str(source), 'ANATOMY_PHASE': 'reproductive_helpers'}
exec(compile(source.read_text().split("passes={'skeleton'")[0], str(source), 'exec'), h)
surface, tube, join = h['surface'], h['tube'], h['join']
collection = bpy.data.collections['ANATOMY']
for ob in list(collection.objects):
    if ob.get('variant') or ob.get('partId') == 'urethra':
        bpy.data.objects.remove(ob, do_unlink=True)

# Make the anterior bladder / posterior reproductive tract separation explicit.
# Only these shared pelvic structures change; all other refinements stay intact.
shared = []
for pid in ['bladder', 'ureter_L', 'ureter_R']:
    ob = next(o for o in collection.objects if o.get('partId') == pid)
    if not ob.get('pelvicRevision'):
        for v in ob.data.vertices:
            p = ob.matrix_world @ v.co
            weight = 1 if pid == 'bladder' else max(0, min(1, (.95-p.z)/.46))
            p.y -= .22 * weight
            v.co = ob.matrix_world.inverted() @ p
        ob.data.update()
        ob['pelvicRevision'] = 1
    shared.append(ob)

SKIN = bpy.data.materials['Anatomy_dermis']
MUCOSA = bpy.data.materials['Anatomy_stomach']
GLAND = bpy.data.materials['Anatomy_glands']
TISSUE = bpy.data.materials['Anatomy_myocardium']
created = []
paths = {}
variant = 'male'

def add(pid, label, pieces, description, offset=(0, -.35, 3.3), envelope='pelvis', cavity=False):
    ob = join(pieces, variant+'_'+pid, label, 'reproductive', offset, cavity, description)
    ob['variant'] = variant
    ob['anatomicalEnvelope'] = envelope
    ob['externalSurface'] = pid in ('penis', 'scrotum', 'labia_majora', 'labia_minora', 'vestibule', 'mons_pubis', 'clitoral_glans')
    # These volumes are fitted to the pelvis and their genital envelopes below,
    # rather than crushed into the original, deliberately featureless coat.
    ob['envelopeFit'] = True
    ob['reproductiveRevision'] = 1
    created.append(ob)
    return ob

def bulb(pid, label, center, scale, mat, description, offset=(0, -.35, 3.3), envelope='pelvis', wall=0, n=16, rings=10, shape=None):
    n=min(n,16);rings=min(rings,12)
    return add(pid,label,[surface(pid,center,scale,mat,shape,n=n,rings=rings,wall=wall)],description,offset,envelope,bool(wall))

def duct(pid,label,points,radius,description,offset=(0,-.35,3.3),envelope='pelvis',mat=MUCOSA,sides=8,steps=3,wall=.3):
    steps=min(steps,2)
    paths[variant+'_'+pid] = [list(p) for p in points]
    return add(pid,label,[tube(pid,points,radius,mat,sides,steps,wall=wall)],description,offset,envelope,bool(wall))

penis_path = [(0,-.32,.255),(0,-.40,.235),(0,-.50,.19),(0,-.575,.145)]
duct('penis','Penis · skin and prepuce',penis_path,[.071,.072,.065,.056],
     'Outer skin of the relaxed penis, with a preputial opening around the glans. Shown only in anatomical views.',
     (0,-.40,3.55),'penis',SKIN,16,4,.14)
bulb('scrotum','Scrotum',(0,-.235,.145),(.20,.14,.109),SKIN,
     'A thin outer sac surrounding the paired testes and epididymides.',(0,-.72,3.65),'scrotum',.13,n=20,rings=12,
     shape=lambda q,t,p:(q.x,q.y*(.95+.05*math.cos(p*2)),q.z*(1-.10*math.exp(-(q.x/.16)**2))))
duct('corpora_cavernosa','Penis · paired corpora cavernosa',[(0,-.31,.267),(0,-.41,.253),(0,-.50,.208),(0,-.55,.167)],.022,
     'Paired dorsal erectile bodies, shown in the relaxed anatomical state.',(0,.05,3.55),'penis',TISSUE,8,3,0)
# Replace the single center tube with the actual paired bodies while retaining one label.
corpora = created[-1]
for v in corpora.data.vertices: v.co.x -= .025
other = corpora.copy(); other.data = corpora.data.copy(); collection.objects.link(other)
for v in other.data.vertices: v.co.x += .05
bpy.ops.object.select_all(action='DESELECT'); corpora.select_set(True); other.select_set(True)
bpy.context.view_layer.objects.active=corpora; bpy.ops.object.join()
duct('corpus_spongiosum','Penis · corpus spongiosum',[(0,-.32,.23),(0,-.41,.214),(0,-.51,.167),(0,-.572,.145)],[.031,.026,.026,.041],
     'Ventral erectile tissue surrounding the penile urethra and expanding into the glans.',(0,-.12,3.55),'penis',TISSUE,12,3,.58)
duct('glans','Penis · glans',[(0,-.554,.158),(0,-.581,.143),(0,-.592,.138)],[.044,.042,.018],
     'Expanded end of the corpus spongiosum around the narrow external urethral opening.',(0,-.12,3.55),'penis',MUCOSA,12,2,.5)
duct('urethra','Male urethra',[(0,-.24,.31),(0,-.24,.24),(0,-.29,.225),(0,-.41,.214),(0,-.51,.167),(0,-.59,.137)],[.018,.016,.014,.012],
     'Continuous urinary route from the bladder through the prostate and corpus spongiosum to the external meatus.',
     (0,-.35,3.3),'penis',MUCOSA,8,3)
bulb('prostate','Prostate',(0,-.24,.249),(.082,.063,.059),GLAND,
     'Gland immediately below the bladder, surrounding the prostatic urethra.',wall=.36,n=16,rings=10)
# A true through-channel in the gland wall preserves the urethral lumen.
prostate = created[-1]
bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=.021,depth=.20,location=(0,-.24,.249))
h['boolean'](prostate,bpy.context.object)
for s, side in [(-1,'L'),(1,'R')]:
    off=(s*.42,-.36,3.40)
    bulb('testis_'+side,side+' testis',(s*.087,-.237,.136),(.060,.082,.061),GLAND,
         'Testis within the scrotal envelope; the epididymis follows its posterior border.',off,'scrotum',n=16,rings=10)
    duct('epididymis_'+side,side+' epididymis',[(s*.095,-.218,.19),(s*.12,-.166,.175),(s*.12,-.161,.124),(s*.098,-.197,.087)],[.023,.019,.016],
         'Curved duct along the back of the testis, continuing into the ductus deferens.',off,'scrotum',GLAND,8,3)
    duct('ductus_deferens_'+side,side+' ductus deferens',[(s*.098,-.197,.087),(s*.17,-.13,.23),(s*.33,-.08,.53),(s*.27,-.09,.73),(s*.17,.0,.65),(s*.082,-.019,.43)],[.013,.012,.010],
         'Duct ascending from the epididymis, looping over the bladder and meeting the seminal-vesicle duct.',off,sides=6,steps=3)
    bulb('seminal_vesicle_'+side,side+' seminal vesicle',(s*.095,-.014,.472),(.048,.036,.092),GLAND,
         'Paired lobulated gland behind the bladder; its duct joins the ductus deferens.',off,n=12,rings=10,
         shape=lambda q,t,p:(q.x*(1+.12*math.cos(t*14)),q.y*(1+.10*math.cos(t*14)),q.z))
    duct('ejaculatory_duct_'+side,side+' ejaculatory duct',[(s*.082,-.019,.43),(s*.055,-.11,.34),(s*.025,-.22,.267),(0,-.24,.25)],.010,
         'Short duct from the seminal vesicle and ductus deferens into the prostatic urethra.',off,sides=6,steps=2)
    bulb('bulbourethral_gland_'+side,side+' bulbourethral gland',(s*.046,-.28,.211),(.021,.019,.020),GLAND,
         'Small gland below the prostate, draining into the proximal penile urethra.',off,n=10,rings=6)
    duct('bulbourethral_duct_'+side,side+' bulbourethral duct',[(s*.046,-.28,.211),(s*.025,-.32,.224),(0,-.35,.221)],.007,
         'Outlet from the bulbourethral gland into the urethra.',off,sides=6,steps=2)

variant='female'
bulb('mons_pubis','Mons pubis',(0,-.428,.256),(.12,.09,.029),SKIN,
     'Soft tissue over the pubic region, continuous with the outer labial folds.',(0,-.60,3.6),'vulva',n=16,rings=8)
for pid,label,x,radius,mat,off in [
    ('labia_majora','Vulva · labia majora',.083,.034,SKIN,(0,-.62,3.62)),
    ('labia_minora','Vulva · labia minora',.038,.016,MUCOSA,(0,-.44,3.42))]:
    pieces=[]
    for s in [-1,1]:
        points=[(s*.014,-.418,.227),(s*x,-.335,.175),(s*x,-.18,.14),(s*x*.7,-.025,.164),(s*.01,.03,.195)]
        pieces.append(tube(pid,points,[radius*.35,radius,radius,radius*.3],mat,10,3))
    add(pid,label,pieces,'Paired folds framing the vestibule. The urethral and vaginal openings remain distinct.',off,'vulva')
bulb('clitoral_glans','Clitoris · glans',(0,-.389,.185),(.025,.027,.022),MUCOSA,
     'External glans beneath the anterior labial hood, continuous with the internal clitoral body.',(0,-.30,3.5),'vulva',n=12,rings=8)
bulb('vestibule','Vulva · vestibule',(0,-.222,.169),(.048,.196,.016),MUCOSA,
     'Mucosal surface between the labia minora, pierced by separate urinary and vaginal openings.',(0,-.35,3.3),'vulva',n=16,rings=8)
vestibule=created[-1]
for y,r in [(-.314,.012),(-.095,.030)]:
    bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=r,depth=.14,location=(0,y,.17))
    bpy.context.object.data.materials.append(MUCOSA)
    h['boolean'](vestibule,bpy.context.object)
pieces=[tube('clitoral_body',[(0,-.39,.19),(0,-.365,.236),(0,-.30,.29)],[.02,.027,.022],TISSUE,8,3)]
for s in [-1,1]:
    pieces.append(tube('clitoral_crus',[(0,-.30,.29),(s*.075,-.21,.29),(s*.13,-.05,.28)],[.022,.027,.016],TISSUE,8,3))
add('clitoral_body','Clitoris · body and crura',pieces,'Internal erectile body with paired crura extending alongside the pubic arch.',(0,.0,3.5),'vulva')
bulb('uterus','Uterus',(0,-.045,.701),(.156,.075,.143),TISSUE,
     'Hollow muscular organ behind and above the bladder, narrowing inferiorly toward the cervix.',wall=.28,n=20,rings=14,
     shape=lambda q,t,p:(q.x*(.70+.30*q.z),q.y,q.z))
uterus=created[-1]
bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=.032,depth=.15,location=(0,-.045,.55))
h['boolean'](uterus,bpy.context.object)
duct('cervix','Cervix',[(0,-.045,.59),(0,-.048,.535),(0,-.068,.485)],[.05,.058,.049],
     'Lower neck of the uterus, with a cervical canal opening into the vagina.',wall=.42,sides=12,steps=3,mat=TISSUE)
duct('vagina','Vagina',[(0,-.061,.516),(0,-.078,.443),(0,-.087,.30),(0,-.095,.157)],[.058,.048,.044,.038],
     'Muscular canal posterior to the urethra and bladder, connecting the cervix to the vaginal opening.',
     (0,-.35,3.3),'vulva',MUCOSA,12,3,.25)
duct('urethra','Female urethra',[(0,-.24,.31),(0,-.277,.255),(0,-.314,.187)],.016,
     'Short urinary route from the bladder to its own opening, anterior to the vaginal opening.',
     (0,-.35,3.3),'vulva',MUCOSA,8,3)
for s,side in [(-1,'L'),(1,'R')]:
    off=(s*.52,-.20,3.4)
    bulb('ovary_'+side,side+' ovary',(s*.31,-.027,.698),(.073,.044,.047),GLAND,
         'Paired gonad lateral to the uterus, close to the fimbrial end of the uterine tube.',off,n=16,rings=10)
    duct('uterine_tube_'+side,side+' uterine tube',[(s*.102,-.045,.765),(s*.18,-.047,.797),(s*.31,-.028,.795),(s*.382,-.028,.777),(s*.374,-.027,.748)],[.014,.018,.021,.030],
         'Hollow tube from the uterine horn to a fimbrial funnel beside the ovary. The funnel is open, not fused to the ovary.',off,sides=8,steps=3)
    fimbriae=[]
    for j in range(5):
        a=j*math.tau/5
        fimbriae.append(tube('fimbria',[(s*.374+.024*math.cos(a),-.027+.024*math.sin(a),.748),
            (s*.361+.036*math.cos(a),-.027+.038*math.sin(a),.732)],[.009,.003],MUCOSA,6,2))
    add('fimbriae_'+side,side+' fimbriae',fimbriae,'Fingerlike folds around the open ovarian end of the uterine tube.',off)
    bulb('vestibular_bulb_'+side,side+' vestibular bulb',(s*.058,-.142,.224),(.025,.079,.026),TISSUE,
         'Paired internal erectile tissue alongside the vaginal entrance.',off,'vulva',n=12,rings=8)
    bulb('vestibular_gland_'+side,side+' greater vestibular gland',(s*.062,-.018,.219),(.023,.025,.022),GLAND,
         'Gland beside the posterior vaginal entrance, with a short duct into the vestibule.',off,'vulva',n=10,rings=6)
    duct('vestibular_duct_'+side,side+' vestibular duct',[(s*.062,-.018,.219),(s*.04,-.065,.176),(s*.028,-.09,.159)],.007,
         'Outlet of the greater vestibular gland beside the vaginal opening.',off,'vulva',sides=6,steps=2)

for ob in created:
    # Exact Boolean intersections at a pole can leave vanishing sliver faces.
    bm=bmesh.new();bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
    bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=.000001)
    bm.to_mesh(ob.data);bm.free();ob.data.update()
    for i,mat in enumerate(ob.data.materials):
        if mat is None:ob.data.materials[i]=ob.data.materials[0]

# Existing organ maps are UV atlases, not repeating tiles. Reuse a fully
# occupied patch rather than sampling empty atlas space on the new topology.
patches={}
for mat in {m for ob in created for m in ob.data.materials}:
    filename=mat.get('textureSource')
    if not filename:continue
    img=next((n.image for n in mat.node_tree.nodes if n.type=='TEX_IMAGE' and n.image and n.image.filepath.endswith(filename)),None)
    if img is None:continue
    w,hgt=img.size
    pixels=np.empty(w*hgt*4,dtype=np.float32);img.pixels.foreach_get(pixels)
    rgb=pixels.reshape(hgt,w,4)[:,:,:3]
    valid=np.min(rgb,axis=2)>.025
    # Coarse blocks, requiring every texel including the patch border to exist.
    block=16;mask=valid[:hgt//block*block,:w//block*block].reshape(hgt//block,block,w//block,block).all(axis=(1,3))
    dp=np.zeros_like(mask,dtype=np.int32);best=(0,0,0)
    for y in range(mask.shape[0]):
        for x in range(mask.shape[1]):
            if mask[y,x]:
                dp[y,x]=1+(min(dp[y-1,x],dp[y,x-1],dp[y-1,x-1]) if y and x else 0)
                if dp[y,x]>best[0]:best=(int(dp[y,x]),x,y)
    size,x,y=best
    assert size>=2,'No usable existing tissue patch for '+mat.name
    margin=2
    patches[mat.name]=((x-size+1)*block+margin,(y-size+1)*block+margin,size*block-margin*2,w,hgt)
for ob in created:
    for poly in ob.data.polygons:
        patch=patches.get(ob.data.materials[poly.material_index].name)
        if patch is None:continue
        x,y,size,w,hgt=patch
        for li in poly.loop_indices:
            uv=ob.data.uv_layers.active.data[li].uv
            uv.x=(x+(uv.x%1)*size)/w;uv.y=(y+(uv.y%1)*size)/hgt

if globals().get('REPRODUCTIVE_EXPORT', True):
    # Export only changed parts, allowing the merger to preserve the exact
    # existing runtime refinements and source materials on unrelated parts.
    bpy.ops.object.select_all(action='DESELECT')
    for ob in created+shared: ob.select_set(True)
    mods=[]
    for ob in created+shared:
        mod=ob.modifiers.new('Export tangent triangulation','TRIANGULATE');mods.append((ob,mod))
    bpy.ops.export_scene.gltf(filepath=str(OUT/'reproductive-raw.glb'),export_format='GLB',use_selection=True,
        export_apply=True,export_yup=True,export_extras=True,export_tangents=True,export_animations=False,
        export_cameras=False,export_lights=False)
    for ob,mod in mods: ob.modifiers.remove(mod)
    rows=[]
    for ob in created+shared:
        ob.data.calc_loop_triangles()
        rows.append({'id':ob['partId'],'label':ob['label'],'systems':list(ob['systems']),
            'variant':ob.get('variant'),'triangles':len(ob.data.loop_triangles),'cavity':bool(ob['cavity']),
            'anatomicalEnvelope':ob.get('anatomicalEnvelope'),'externalSurface':bool(ob.get('externalSurface'))})
    (OUT/'reproductive-manifest.json').write_text(json.dumps({'version':1,'parts':rows,'paths':paths,
        'references':['https://openstax.org/books/anatomy-and-physiology/pages/27-1-anatomy-and-physiology-of-the-male-reproductive-system',
        'https://openstax.org/books/anatomy-and-physiology/pages/27-2-anatomy-and-physiology-of-the-female-reproductive-system']},indent=2))
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'totoro-anatomy.blend'))
    print('REPRODUCTIVE_EXPORTED',len(created),'new parts',sum(r['triangles'] for r in rows if r['variant']),'triangles',flush=True)
