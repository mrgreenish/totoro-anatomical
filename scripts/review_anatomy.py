"""Render an isolated system, assembly, section, or exploded review through MCP.

Pass: bones, organs, muscles, arteries, veins, nerves, all, profile,
split-x, split-y, split-z, exploded. Temporary sections never alter source meshes.
"""
import bpy
from pathlib import Path
from mathutils import Vector
OUT=Path(__file__).resolve().parents[1]/'artwork'/'anatomy'/'reviews'
OUT.mkdir(exist_ok=True)
view=globals().get('ANATOMY_PHASE','bones')
scene=bpy.context.scene
anatomy=bpy.data.collections['ANATOMY']
originals=list(anatomy.all_objects)
visibility={ob:ob.hide_render for ob in list(scene.objects)}
positions={ob:ob.location.copy() for ob in originals}
camera=scene.camera;camera_matrix=camera.matrix_world.copy();camera_type=camera.data.type
camera_scale=camera.data.ortho_scale
temporary=[]
section=view.startswith('split-')
try:
    for ob in list(scene.objects):
        if ob.type=='MESH':ob.hide_render=True
    for ob in originals:
        systems=list(ob.get('systems',[]))
        ob.hide_render=not (view in systems or view in ['all','profile','exploded'] and 'skin' not in systems and 'muscles' not in systems or section)
        if view=='exploded':
            offset=ob.get('explodeOffset',[0,0,0]);ob.location+=Vector((offset[0],-offset[2],offset[1]))*.65
    if section:
        axis={'x':0,'y':2,'z':1}[view[-1]]
        cut=0 if axis!=2 else 2.4
        center=Vector((0,0,2.5));center[axis]=cut+10
        bpy.ops.mesh.primitive_cube_add(size=20,location=center)
        cutter=bpy.context.object;temporary.append(cutter);cutter.hide_render=True
        for source in originals:
            if source.hide_render:continue
            source.hide_render=True
            ob=source.copy();ob.data=source.data.copy();scene.collection.objects.link(ob);temporary.append(ob);ob.hide_render=False
            bpy.context.view_layer.objects.active=ob
            mod=ob.modifiers.new('Temporary section','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
            bpy.ops.object.modifier_apply(modifier=mod.name)
    camera.location=(6,-11,5)
    if view=='profile':camera.location=(12,-3,4.5)
    if view=='split-x':camera.location=(12,-8,4.8)
    if view=='split-z':camera.location=(5,12,4.8)
    if view=='split-y':camera.location=(5,-7,14)
    target=Vector((0,0,2.5));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type='ORTHO';camera.data.ortho_scale=6 if view!='exploded' else 9
    scene.render.engine='CYCLES';scene.cycles.samples=12
    scene.render.resolution_x=800;scene.render.resolution_y=850;scene.render.resolution_percentage=100
    scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    scene.render.filepath=str(OUT/(view+'.png'))
    bpy.ops.render.render(write_still=True)
    print('REVIEW_RENDER',scene.render.filepath)
finally:
    for ob in temporary:
        data=ob.data;bpy.data.objects.remove(ob,do_unlink=True)
        if data.users==0:bpy.data.meshes.remove(data)
    for ob,pos in positions.items():ob.location=pos
    for ob,hidden in visibility.items():ob.hide_render=hidden
    camera.matrix_world=camera_matrix;camera.data.type=camera_type;camera.data.ortho_scale=camera_scale
