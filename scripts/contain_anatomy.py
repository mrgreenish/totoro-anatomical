"""Fit visible anatomy beneath the original exterior envelope via Blender MCP."""
import bpy,json
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
OUT=Path(__file__).resolve().parents[1]/'artwork'/'anatomy'
deps=bpy.context.evaluated_depsgraph_get();trees=[]
envelopes=['Body','Arm_L','Arm_R','Foot_L','Foot_R','Ear_L','Ear_R','Tail']+[o.name for o in bpy.data.objects if o.name.startswith(('Hand_L_claw','Hand_R_claw','Toe_L_claw','Toe_R_claw'))]
for name in envelopes:
    source=bpy.data.objects.get(name)
    if not source:continue
    data=bpy.data.meshes.new_from_object(source.evaluated_get(deps))
    trees.append(BVHTree.FromPolygons([source.matrix_world@v.co for v in data.vertices],[list(p.vertices) for p in data.polygons]))
    bpy.data.meshes.remove(data)
rows=[]
for ob in list(bpy.data.collections['ANATOMY'].all_objects):
    if ob.type!='MESH' or ob.get('assemblyGroup')=='skin':continue
    # Genital tissue belongs to its authored penis/scrotum/vulva envelope,
    # including the internal tissues enclosed by those external surfaces.
    if ob.get('anatomicalEnvelope') in ('penis','scrotum','vulva'):continue
    if ob.get('envelopeFit'):continue
    pid=ob['partId'];applying=globals().get('ANATOMY_PHASE')=='fit'
    if applying:
        for v in ob.data.vertices:
            if pid.startswith(('carpals_','metacarpal_','finger_','cartilage_wrist_')):
                v.co.z+=.17;v.co.y-=.08
            elif pid.startswith(('radius_','ulna_')) or pid in ['arteries_network','veins_network','nervous_network']:
                if abs(v.co.x)>1.3 and v.co.z<1.85:
                    weight=min(1,max(0,(1.85-v.co.z)/.60));v.co.z+=.17*weight;v.co.y-=.08*weight
    # The ocular surface intentionally reaches the exterior eye opening.
    if pid.startswith(('eye_','lens_','retina_')):continue
    changed=0;maximum=0;inverse=ob.matrix_world.inverted()
    for v in ob.data.vertices:
        point=ob.matrix_world@v.co;closest=None;inside=False
        for tree in trees:
            position,normal,index,distance=tree.find_nearest(point)
            if (point-position).dot(normal)<-.012:inside=True;break
            if closest is None or distance<closest[2]:closest=(position,normal,distance)
        if not inside and closest:
            position,normal,distance=closest
            maximum=max(maximum,distance);changed+=1
            if globals().get('ANATOMY_PHASE')=='fit':v.co=inverse@(position-normal*.035)
    if applying:ob['envelopeFit']=True
    if changed:ob.data.update();rows.append({'id':ob['partId'],'verticesAdjusted':changed,'maximumDistance':round(maximum,4)})
(OUT/'containment-adjustments.json').write_text(json.dumps({'applied':globals().get('ANATOMY_PHASE')=='fit','method':'Hand alignment to the source paws, followed by closest exterior envelope with 0.035 inset. Ocular openings exempt. Connectivity retained.','parts':rows},indent=2))
print('CONTAINMENT_FIT',json.dumps(rows))
