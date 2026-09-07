"""Bake independent normal and roughness channels from Blender materials."""
import bpy
from pathlib import Path
OUT=Path(__file__).resolve().parents[1]/'artwork'/'anatomy'/'textures'
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=4
scene.render.bake.use_selected_to_active=False;scene.render.bake.margin=8
for kind in ['muscle','organ','bone']:
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.mesh.primitive_plane_add(size=2)
    ob=bpy.context.object;ob.name='Anatomy_bake_proxy'
    m=bpy.data.materials.new('Bake_'+kind);m.use_nodes=True;ob.data.materials.append(m)
    n=m.node_tree.nodes;l=m.node_tree.links
    bsdf=n.get('Principled BSDF');output=n.get('Material Output')
    coord=n.new('ShaderNodeTexCoord');mapping=n.new('ShaderNodeVectorMath');mapping.operation='MULTIPLY'
    mapping.inputs[1].default_value=(18,210,25) if kind=='muscle' else ((125,125,125) if kind=='organ' else (165,165,165))
    l.new(coord.outputs['UV'],mapping.inputs[0])
    noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=1;noise.inputs['Detail'].default_value=2
    l.new(mapping.outputs['Vector'],noise.inputs['Vector'])
    bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.12;bump.inputs['Distance'].default_value=.007
    l.new(noise.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs['Normal'],bsdf.inputs['Normal'])
    normal=bpy.data.images.new(kind+'-normal',512,512,alpha=False);normal.colorspace_settings.name='Non-Color'
    target=n.new('ShaderNodeTexImage');target.image=normal;n.active=target
    bpy.ops.object.bake(type='NORMAL')
    normal.filepath_raw=str(OUT/(kind+'-normal.png'));normal.file_format='PNG';normal.save();normal.pack()
    ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(.38,.38,.38,1);ramp.color_ramp.elements[1].color=(.68,.68,.68,1)
    l.new(noise.outputs['Fac'],ramp.inputs['Fac'])
    emission=n.new('ShaderNodeEmission');l.new(ramp.outputs['Color'],emission.inputs['Color']);l.new(emission.outputs[0],output.inputs['Surface'])
    rough=bpy.data.images.new(kind+'-roughness',512,512,alpha=False);rough.colorspace_settings.name='Non-Color'
    target.image=rough
    bpy.ops.object.bake(type='EMIT')
    rough.filepath_raw=str(OUT/(kind+'-roughness.png'));rough.file_format='PNG';rough.save();rough.pack()
    bpy.data.objects.remove(ob,do_unlink=True);bpy.data.materials.remove(m)
    for mat in list(bpy.data.materials):
        if not mat.name.startswith('Anatomy_'):continue
        matches=mat.get('textureSource')==kind+'-albedo.png' if kind!='bone' else mat.name=='Anatomy_cortical_bone'
        if not matches:continue
        shader=mat.node_tree.nodes.get('Principled BSDF');nodes=mat.node_tree.nodes;links=mat.node_tree.links
        tex=nodes.new('ShaderNodeTexImage');tex.image=normal
        nm=nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.55
        links.new(tex.outputs['Color'],nm.inputs['Color']);links.new(nm.outputs['Normal'],shader.inputs['Normal'])
        roughtex=nodes.new('ShaderNodeTexImage');roughtex.image=rough;links.new(roughtex.outputs['Color'],shader.inputs['Roughness'])
print('BAKED_PBR_CHANNELS muscle organ bone')
