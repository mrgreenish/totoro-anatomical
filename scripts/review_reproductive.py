"""Offline geometry reviews; does not alter the saved source or exterior."""
import bpy
import os
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artwork/anatomy/reviews/reproductive'
OUT.mkdir(parents=True,exist_ok=True)
scene=bpy.context.scene
for col in bpy.data.collections:col.hide_render=False
scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True
scene.render.resolution_x=1000;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.render.film_transparent=False;scene.render.image_settings.file_format='PNG'
scene.world.use_nodes=True
background=scene.world.node_tree.nodes.get('Background')
background.inputs['Color'].default_value=(.08,.09,.08,1);background.inputs['Strength'].default_value=.65
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
camera=scene.camera;camera.data.type='ORTHO'
for ob in scene.objects:
    if ob.type=='LIGHT':ob.hide_render=True
for location,power,size in [((-2,-3,4),160,2),((3,-1,2),110,2),((0,3,2),100,2),((0,-2,-2),90,2)]:
    data=bpy.data.lights.new('Pelvic review softbox','AREA');data.energy=power;data.shape='DISK';data.size=size
    light=bpy.data.objects.new(data.name,data);scene.collection.objects.link(light);light.location=location
    light.rotation_euler=(Vector((0,0,.4))-light.location).to_track_quat('-Z','Y').to_euler()
objects=[o for o in scene.objects if o.type=='MESH']
positions={o:o.location.copy() for o in objects}
for variant in ['male','female']:
    for view in os.environ.get('REPRODUCTIVE_VIEWS','front,side,underside,cutaway,exploded').split(','):
        temporary=[]
        for ob in objects:
            ob.location=positions[ob]
            matching=ob.get('variant')==variant
            shared=ob.get('partId') in ('bladder','large_intestine')
            ob.hide_render=not(matching or shared)
            if view=='underside':ob.hide_render=not(matching or ob.name=='Body')
            if view=='exploded' and matching:
                dx,dy,dz=ob['explodeOffset'];ob.location+=Vector((dx,-dz,dy))*.65
        if view=='cutaway':
            bpy.ops.mesh.primitive_cube_add(size=10,location=(5,0,0))
            cutter=bpy.context.object;cutter.hide_render=True;temporary.append(cutter)
            for ob in objects:
                if ob.hide_render:continue
                ob.hide_render=True
                copy=ob.copy();copy.data=ob.data.copy();scene.collection.objects.link(copy);copy.hide_render=False;temporary.append(copy)
                bpy.context.view_layer.objects.active=copy
                mod=copy.modifiers.new('Review section','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
                bpy.ops.object.modifier_apply(modifier=mod.name)
                for i,mat in enumerate(copy.data.materials):
                    if mat is None:copy.data.materials[i]=copy.data.materials[0]
        target=Vector((0,-.16,.46));camera.data.ortho_scale=1.36
        position={'front':(0,-4,1.1),'side':(4,-.2,.9),'underside':(0,-1.3,-2),'cutaway':(3,-1.7,1.1),'exploded':(2.2,-7,2.8)}[view]
        if view=='underside':target=Vector((0,-.24,.19));camera.data.ortho_scale=.86
        if view=='exploded':target=Vector((0,-1.5,.45));camera.data.ortho_scale=3.9
        camera.location=position;camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
        scene.render.filepath=str(OUT/f'{variant}-{view}.png')
        bpy.ops.render.render(write_still=True)
        for ob in temporary:
            data=ob.data;bpy.data.objects.remove(ob,do_unlink=True)
            if data.users==0:bpy.data.meshes.remove(data)
        print('REVIEW_COMPLETE',variant,view,flush=True)
