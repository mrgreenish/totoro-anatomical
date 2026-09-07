"""Bake seamless object-space PBR tissue atlases onto the actual organ meshes.

Each tissue's surfaces share a UV atlas. Baking evaluates continuous 3D noise
and cavity shading in model space; UV islands never become color patches.
"""
import bpy
import math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artwork/anatomy'
collection=bpy.data.collections['ANATOMY']
scene=bpy.context.scene
# Round off cortical ridges and increase samples across the narrow sulci.
helper_file=ROOT/'scripts/build_anatomy.py'
h={'__file__':str(helper_file),'ANATOMY_PHASE':'refinement'}
exec(compile(helper_file.read_text().split("passes={'skeleton'")[0],str(helper_file),'exec'),h)
old=bpy.data.objects['brain'];props=old.id_properties_ensure().to_dict();pieces=[]
for s in [-1,1]:
    def cortex(q,t,p):
        a=p*8+1.45*math.sin(t*6)+.42*math.sin(p*3-t*5)
        b=t*11+.65*math.sin(p*5)+.18*math.sin(t*17+p*3)
        r=1-.055*math.exp(-math.sin(a)**2/.16)-.025*math.exp(-math.sin(b)**2/.10)
        return(q.x*(.83 if s*q.x<0 else 1)*r,q.y*r,q.z*r)
    pieces.append(h['surface']('rounded_cortex',(s*.318,.08,3.56),(.37,.475,.35),h['BRAIN'],cortex,n=140,rings=86))
bpy.ops.object.select_all(action='DESELECT')
for p in pieces:p.select_set(True)
bpy.context.view_layer.objects.active=pieces[0];bpy.ops.object.join();brain=pieces[0]
bpy.data.objects.remove(old,do_unlink=True);brain.name='brain'
for k,v in props.items():brain[k]=v
brain['realismRevision']=3

profiles={
 'brain':((.48,.28,.22),(.70,.49,.38),.48,100,.018),
 'myocardium':((.16,.023,.026),(.31,.065,.053),.39,130,.038),
 'lungs':((.35,.13,.15),(.59,.29,.29),.48,165,.085),
 'liver':((.105,.021,.024),(.245,.056,.042),.34,235,.025),
 'stomach':((.46,.225,.20),(.68,.40,.32),.43,135,.048),
 'intestine':((.44,.20,.19),(.70,.39,.32),.42,170,.055),
 'kidney':((.14,.025,.025),(.30,.066,.055),.35,210,.020),
 'spleen':((.095,.023,.042),(.235,.061,.085),.40,180,.030),
 'glands':((.44,.26,.14),(.65,.44,.26),.53,160,.022),
}
scene.render.engine='CYCLES';scene.cycles.samples=8
scene.render.bake.use_selected_to_active=False;scene.render.bake.margin=12
scene.render.bake.use_clear=True
for kind,(dark,light,rough,frequency,vascular) in profiles.items():
    if globals().get('TISSUE_ONLY') and kind!=globals()['TISSUE_ONLY']:continue
    m=bpy.data.materials['Anatomy_'+kind]
    verts=[];faces=[];loop_sources=[]
    # Use one bake proxy per material, preserving a mapping back to every
    # source face corner. Other materials and their UV layers remain intact.
    for ob in list(collection.objects):
        if ob.type!='MESH' or m not in list(ob.data.materials):continue
        offset=len(verts);verts.extend([ob.matrix_world@v.co for v in ob.data.vertices])
        slots=[i for i,slot in enumerate(ob.data.materials) if slot==m]
        uv=ob.data.uv_layers.active or ob.data.uv_layers.new(name='UVMap')
        for p in ob.data.polygons:
            if p.material_index not in slots:continue
            faces.append(tuple(offset+i for i in p.vertices))
            loop_sources.extend([(uv,loop,ob.name,ob.data.loops[loop].vertex_index) for loop in p.loop_indices])
    data=bpy.data.meshes.new('Tissue_atlas_'+kind);data.from_pydata(verts,[],faces);data.update()
    proxy=bpy.data.objects.new('Tissue_atlas_'+kind,data);scene.collection.objects.link(proxy)
    for p in data.polygons:p.use_smooth=True
    bpy.ops.object.select_all(action='DESELECT');proxy.select_set(True);bpy.context.view_layer.objects.active=proxy
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.018);bpy.ops.object.mode_set(mode='OBJECT')
    if kind=='brain':
        # A spherical atlas keeps narrow cortical valleys above texel size.
        # Generic angle-based islands can collapse those valleys into black
        # specks at mip levels, even with generous bake dilation.
        uv=data.uv_layers.active
        per_hemisphere=2+140*85
        for face in data.polygons:
            source_loops=[loop_sources[i] for i in face.loop_indices]
            if source_loops[0][2]!='brain':
                for li in face.loop_indices:
                    p=uv.data[li].uv;p.y=.83+p.y*.16
                continue
            coords=[]
            for _,_,_,vi in source_loops:
                side=vi//per_hemisphere;vi%=per_hemisphere
                pole=vi in (0,per_hemisphere-1)
                u=0 if pole else ((vi-1)%140)/140
                v=0 if vi==0 else 1 if pole else ((vi-1)//140+1)/86
                coords.append([u,v,side,pole])
            nonpoles=[c[0] for c in coords if not c[3]]
            if max(nonpoles)-min(nonpoles)>.5:
                for c in coords:
                    if c[0]<.5:c[0]+=1
                nonpoles=[c[0] for c in coords if not c[3]]
            for li,c in zip(face.loop_indices,coords):
                u,v,side,pole=c
                if pole:u=sum(nonpoles)/len(nonpoles)
                uv.data[li].uv=(.012+side*.5+u*.476,.012+v*.80)
    for i,(uv,li,_,__) in enumerate(loop_sources):uv.data[li].uv=data.uv_layers.active.data[i].uv
    bake=bpy.data.materials.new('Bake_3D_'+kind);bake.use_nodes=True;data.materials.append(bake)
    n=bake.node_tree.nodes;l=bake.node_tree.links;n.clear()
    out=n.new('ShaderNodeOutputMaterial');emission=n.new('ShaderNodeEmission');l.new(emission.outputs[0],out.inputs[0])
    geometry=n.new('ShaderNodeNewGeometry')
    def noise(scale,detail=3):
        v=n.new('ShaderNodeTexNoise');v.inputs['Scale'].default_value=scale;v.inputs['Detail'].default_value=detail;v.inputs['Roughness'].default_value=.64;l.new(geometry.outputs['Position'],v.inputs['Vector']);return v
    macro=noise(9);fine=noise(frequency);micro=noise(460,2)
    mix=n.new('ShaderNodeMixRGB');mix.inputs[0].default_value=.30;l.new(macro.outputs['Fac'],mix.inputs[1]);l.new(fine.outputs['Fac'],mix.inputs[2])
    ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].position=.10;ramp.color_ramp.elements[0].color=(*dark,1);ramp.color_ramp.elements[1].position=.9;ramp.color_ramp.elements[1].color=(*light,1);l.new(mix.outputs[0],ramp.inputs[0])
    warp=n.new('ShaderNodeVectorMath');warp.operation='SCALE';warp.inputs[3].default_value=.018;l.new(macro.outputs['Color'],warp.inputs[0])
    add=n.new('ShaderNodeVectorMath');add.operation='ADD';l.new(warp.outputs[0],add.inputs[0]);l.new(geometry.outputs['Position'],add.inputs[1])
    vein=n.new('ShaderNodeTexVoronoi');vein.feature='DISTANCE_TO_EDGE';vein.inputs['Scale'].default_value=frequency*.48;l.new(add.outputs[0],vein.inputs['Vector'])
    vr=n.new('ShaderNodeValToRGB');vr.color_ramp.elements[0].position=.012;vr.color_ramp.elements[0].color=(1-vascular,1-vascular*1.5,1-vascular*1.15,1);vr.color_ramp.elements[1].position=.065;vr.color_ramp.elements[1].color=(1,1,1,1);l.new(vein.outputs['Distance'],vr.inputs[0])
    mult=n.new('ShaderNodeMixRGB');mult.blend_type='MULTIPLY';mult.inputs[0].default_value=1;l.new(ramp.outputs[0],mult.inputs[1]);l.new(vr.outputs[0],mult.inputs[2])
    ao=n.new('ShaderNodeAmbientOcclusion');ao.samples=8;ao.inputs['Distance'].default_value=.035;ao.only_local=True
    shade=n.new('ShaderNodeMixRGB');shade.blend_type='MULTIPLY';shade.inputs[0].default_value=.28;l.new(mult.outputs[0],shade.inputs[1]);l.new(ao.outputs['AO'],shade.inputs[2]);l.new(shade.outputs[0],emission.inputs[0])
    target=n.new('ShaderNodeTexImage');n.active=target
    def bake_map(suffix,channel,size):
        img=bpy.data.images.new(kind+'-atlas-'+suffix,width=size,height=size,alpha=False)
        if suffix!='albedo':img.colorspace_settings.name='Non-Color'
        target.image=img;n.active=target;bpy.ops.object.bake(type=channel)
        img.filepath_raw=str(OUT/'textures'/(kind+'-'+suffix+'.png'));img.file_format='PNG';img.save();img.pack();return img
    albedo=bake_map('albedo','EMIT',1024)
    rr=n.new('ShaderNodeMapRange');rr.inputs['To Min'].default_value=rough-.055;rr.inputs['To Max'].default_value=rough+.075;l.new(fine.outputs['Fac'],rr.inputs[0]);l.new(rr.outputs[0],emission.inputs[0])
    roughmap=bake_map('roughness','EMIT',512)
    p=n.new('ShaderNodeBsdfPrincipled');bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.18;bump.inputs['Distance'].default_value=.00035 if kind!='lungs' else .0008;l.new(micro.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs[0],p.inputs['Normal']);l.new(p.outputs[0],out.inputs[0])
    normal=bake_map('normal','NORMAL',512)
    bpy.data.objects.remove(proxy,do_unlink=True);bpy.data.meshes.remove(data);bpy.data.materials.remove(bake)
    nodes=m.node_tree.nodes;links=m.node_tree.links;nodes.clear()
    output=nodes.new('ShaderNodeOutputMaterial');p=nodes.new('ShaderNodeBsdfPrincipled');p.name='Principled BSDF';links.new(p.outputs[0],output.inputs[0])
    tex=nodes.new('ShaderNodeTexImage');tex.image=albedo;links.new(tex.outputs[0],p.inputs['Base Color'])
    tint=nodes.new('ShaderNodeMixRGB');tint.blend_type='MULTIPLY';tint.inputs[0].default_value=1;tint.inputs[2].default_value=(1,1,1,1);links.new(tex.outputs[0],tint.inputs[1]);links.new(tint.outputs[0],p.inputs['Base Color'])
    rt=nodes.new('ShaderNodeTexImage');rt.image=roughmap;links.new(rt.outputs[0],p.inputs['Roughness'])
    nt=nodes.new('ShaderNodeTexImage');nt.image=normal;nm=nodes.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.45;links.new(nt.outputs[0],nm.inputs['Color']);links.new(nm.outputs[0],p.inputs['Normal'])
    p.inputs['IOR'].default_value=1.38;p.inputs['Coat Weight'].default_value=.09;p.inputs['Coat Roughness'].default_value=.36
    p.inputs['Subsurface Weight'].default_value=.06;p.inputs['Subsurface Radius'].default_value=(1,.35,.20);p.inputs['Subsurface Scale'].default_value=.018
    m['tint']=[1,1,1];m['textureSource']=kind+'-albedo.png';m['realismRevision']=3
    print('SEAMLESS_TISSUE_BAKED',kind,flush=True)
# Remove unreferenced bake maps before packing the editable source.
for img in list(bpy.data.images):
    if img.users==0:bpy.data.images.remove(img)
h['finish']()
check=ROOT/'scripts/verify_anatomy_blender.py'
exec(compile(check.read_text(),str(check),'exec'),{'__file__':str(check)})
