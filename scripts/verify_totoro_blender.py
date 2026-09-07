"""Check the authored mesh and coat in the rest pose and an exaggerated motion pose."""
import bpy
import bmesh
import json
from pathlib import Path
from mathutils.bvhtree import BVHTree

root=Path(__file__).resolve().parents[1]
report={'passed':True,'closedSurfaces':{},'coatAttachments':[]}
for name in ['Body','Ear_L','Ear_R','Arm_L','Arm_R','Foot_L','Foot_R','Tail']:
    ob=bpy.data.objects[name];bm=bmesh.new();bm.from_mesh(ob.data)
    open_edges=sum(e.is_boundary for e in bm.edges)
    report['closedSurfaces'][name]=open_edges;bm.free()
    assert open_edges==0, name+' has an unintended opening'

pairs=[('Fine grey fibers','Body'),('Face fibers','Body'),('Fine ivory fibers','Cream belly'),('Chevron fibers','Belly chevrons')]
pairs.extend((name+' fibers',name) for name in ['Arm_L','Arm_R','Ear_L','Ear_R','Tail','Foot_L','Foot_R'])
rig=bpy.data.objects['Totoro_Rig']
for pose in ['rest','motion']:
    if pose=='motion':
        rig.pose.bones['Breath'].scale=(1.013,1.004,1.016)
        for name,value in [('ArmSwing_L',.08),('ArmSwing_R',-.08),('EarBend_L',.10),('EarBend_R',-.10),('TailSway',.10)]:
            rig.pose.bones[name].rotation_euler.z=value
    bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get()
    for fiber_name,surface_name in pairs:
        fiber=bpy.data.objects[fiber_name];surface=bpy.data.objects[surface_name]
        evaluated=fiber.evaluated_get(deps);mesh=evaluated.to_mesh()
        tree=BVHTree.FromObject(surface,deps)
        distances=[]
        for index in range(0,len(mesh.vertices)-4,5*53):
            world=evaluated.matrix_world@((mesh.vertices[index].co+mesh.vertices[index+1].co)/2)
            local=surface.matrix_world.inverted()@world
            hit=tree.find_nearest(local)
            if hit[0] is not None:distances.append(hit[3])
        evaluated.to_mesh_clear()
        worst=max(distances,default=0)
        report['coatAttachments'].append({'pose':pose,'surface':surface_name,'samples':len(distances),'maxRootDistance':worst})
        assert worst<.030, f'{fiber_name} detaches in {pose}: {worst}'
for bone in rig.pose.bones:bone.rotation_euler=(0,0,0);bone.scale=(1,1,1)
(root/'artwork'/'blender-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'passed':True,'maximumCoatGap':max(r['maxRootDistance'] for r in report['coatAttachments']),'closedSurfaces':report['closedSurfaces']},indent=2))
