"""Offline geometry/material study; runtime adds the capillary and wetness shader."""
import bpy,json
from pathlib import Path
from mathutils import Vector
root=Path(__file__).resolve().parents[1]
data=json.loads((root/'work/brain-surface.json').read_text())
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
p=data['positions'];s=data['scale'];idx=data['indices']
verts=[(p[i]*s[0],-p[i+2]*s[2],p[i+1]*s[1]) for i in range(0,len(p),3)]
mesh=bpy.data.meshes.new('Cortex');mesh.from_pydata(verts,[],[idx[i:i+3] for i in range(0,len(idx),3)]);mesh.update()
ob=bpy.data.objects.new('Cortex',mesh);bpy.context.collection.objects.link(ob)
for f in mesh.polygons:f.use_smooth=True
attr=mesh.color_attributes.new(name='Cavity',type='FLOAT_COLOR',domain='POINT')
for i,c in enumerate(attr.data):c.color=(*data['colors'][i*3:i*3+3],1)
m=bpy.data.materials.new('Wet cortex');m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;bs=n.get('Principled BSDF')
bs.inputs['Roughness'].default_value=.23;bs.inputs['Coat Weight'].default_value=1;bs.inputs['Coat Roughness'].default_value=.075
bs.inputs['Subsurface Weight'].default_value=.08;bs.inputs['Subsurface Radius'].default_value=(.06,.025,.018)
tex=n.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=24
coord=n.new('ShaderNodeTexCoord');l.new(coord.outputs['Object'],tex.inputs['Vector'])
r=n.new('ShaderNodeValToRGB');r.color_ramp.elements[0].color=(.39,.19,.18,1);r.color_ramp.elements[1].color=(.70,.43,.37,1);l.new(tex.outputs['Fac'],r.inputs[0])
c=n.new('ShaderNodeVertexColor');c.layer_name='Cavity'
mix=n.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;l.new(r.outputs['Color'],mix.inputs[1]);l.new(c.outputs['Color'],mix.inputs[2]);l.new(mix.outputs[0],bs.inputs['Base Color']);ob.data.materials.append(m)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.world.color=(.12,.12,.12)
for name,pos,power,size in [('Key',(-2,-2,3),180,2),('Strip',(2,0,1.5),120,.7),('Fill',(0,2,1),90,1.5)]:
    light=bpy.data.lights.new(name,'AREA');light.energy=power;light.shape='DISK';light.size=size
    obj=bpy.data.objects.new(name,light);bpy.context.collection.objects.link(obj);obj.location=pos;obj.rotation_euler=(-obj.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(1.3,-2.3,2.1));cam=bpy.context.object;cam.rotation_euler=(-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=1.85;scene.camera=cam
scene.render.resolution_x=1000;scene.render.resolution_y=850;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX';scene.render.filepath=str(root/'artwork/anatomy/reviews/brain-wet-cortex.png')
bpy.ops.render.render(write_still=True)
