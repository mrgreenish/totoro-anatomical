"""Render reproducible tissue and silhouette studies from the refined source."""
import bpy
from pathlib import Path
from mathutils import Vector
OUT=Path(__file__).resolve().parents[1]/'artwork/anatomy/reviews'
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=48;scene.cycles.use_denoising=True
scene.render.resolution_percentage=100;scene.render.film_transparent=False
scene.world.color=(.025,.025,.025)
if scene.world.use_nodes:
    scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.018,.021,.026,1)
    scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.35
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
camera=scene.camera;camera.data.type='ORTHO'
studies=[
 ('organs-realistic',None,(4,-12,4.8),(0,0,2.1),4.1,1000,1200),
 ('heart-realistic',['heart'],(1,-8,4),(-.13,-.3,2.47),1.08,1000,1000),
 ('brain-realistic',['brain','cerebellum','brainstem'],(2,-7,7),(0,.08,3.51),1.55,1000,1000),
 ('abdomen-realistic',['liver','gallbladder','stomach','small_intestine','large_intestine','pancreas','kidney_L','kidney_R','spleen'],(3,-10,4),(0,0,1.2),2.6,1100,1000),
]
for name,ids,position,target,scale,width,height in studies:
    for ob in scene.objects:
        if ob.type=='MESH':ob.hide_render=not(ob.get('partId') in ids if ids else 'organs' in ob.get('systems',[]))
    camera.location=position;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=scale
    scene.render.resolution_x=width;scene.render.resolution_y=height;scene.render.filepath=str(OUT/(name+'.png'))
    bpy.ops.render.render(write_still=True)
    print('STUDY_RENDERED',name,flush=True)
