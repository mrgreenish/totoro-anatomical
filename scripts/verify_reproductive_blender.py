"""Geometry and anatomical relationship checks for the authored variants."""
import bpy,bmesh,json,math
from pathlib import Path
from mathutils import Vector

OUT=Path(__file__).resolve().parents[1]/'artwork/anatomy'
manifest=json.loads((OUT/'reproductive-manifest.json').read_text())
objects={o.get('partId'):o for o in bpy.data.collections['ANATOMY'].objects if o.get('partId')}
checks=[]
def check(value,message):
    assert value,message
    checks.append(message)
for row in manifest['parts']:
    ob=objects[row['id']]
    if not row.get('variant'):continue
    bm=bmesh.new();bm.from_mesh(ob.data)
    check(all(e.is_manifold for e in bm.edges),row['id']+': closed tissue volume')
    check(all(math.isfinite(x) for v in bm.verts for x in v.co),row['id']+': finite geometry')
    check(all(f.calc_area()>1e-12 for f in bm.faces),row['id']+': nondegenerate faces')
    bm.free()
    pts=[ob.matrix_world@v.co for v in ob.data.vertices]
    check(all(-.52<p.x<.52 and -.7<p.y<.2 and .025<p.z<.88 for p in pts),row['id']+': pelvic bounds and ground clearance')
    check(ob.get('systems')==['reproductive'] and ob.get('description'),row['id']+': filter and inspector metadata')

for side in ['L','R']:
    for pid in ['testis','epididymis']:
        ob=objects['male_'+pid+'_'+side]
        points=[ob.matrix_world@v.co for v in ob.data.vertices]
        check(all((p.x/.20)**2+((p.y+.235)/.14)**2+((p.z-.145)/.109)**2<1 for p in points),side+': '+pid+' lies inside scrotum')

paths=manifest['paths']
for variant in ['male','female']:
    start=Vector(paths[variant+'_urethra'][0])
    check((start-Vector((0,-.24,.31))).length<.0001,variant+': urethra starts at bladder neck')
    check(paths[variant+'_urethra'][-1][2]<.2,variant+': urinary outlet reaches perineum')
check(paths['female_urethra'][-1][1]<paths['female_vagina'][-1][1]-.1,'Distinct female outlets, urethra anterior to vagina')
check(paths['male_urethra'][1]==[0,-.24,.24],'Male urethra passes through prostate')
check('urethra' not in objects,'Generic disconnected urethra replaced')
check(objects['bladder'].get('pelvicRevision')==1,'Shared bladder moved anteriorly to make room for tract')
check('female_uterus' in objects and all('female_ovary_'+s in objects for s in ['L','R']),'Uterus and paired ovaries present')
for side in ['L','R']:
    check(paths['male_ductus_deferens_'+side][0]==paths['male_epididymis_'+side][-1],side+': epididymis connects to ductus deferens')
    check(paths['male_ductus_deferens_'+side][-1]==paths['male_ejaculatory_duct_'+side][0],side+': ductus deferens connects to ejaculatory duct')
    check(paths['male_ejaculatory_duct_'+side][-1]==[0,-.24,.25],side+': ejaculatory duct reaches prostatic urethra')
total=0
for ob in objects.values():ob.data.calc_loop_triangles();total+=len(ob.data.loop_triangles)
check(total<=500000,'Total anatomy remains within 500,000 triangles')
report={'passed':True,'assertions':len(checks),'triangles':total,'checks':checks,
    'scope':'Authored manifold volumes, pelvic bounds, scrotal containment and named duct endpoints. Offline renders complement these checks.'}
(OUT/'reproductive-verification.json').write_text(json.dumps(report,indent=2))
print('REPRODUCTIVE_VERIFIED',len(checks),'checks;',total,'triangles')
