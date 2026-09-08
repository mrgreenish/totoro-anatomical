"""Bake muscle-aligned fibers, collagen, and cortical bone onto existing meshes.

Run against the saved anatomy .blend. Only UVs and materials change; topology,
part identities, cavity walls and assembly transforms remain intact.
"""
import bpy
import numpy as np
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artwork/anatomy'
scene = bpy.context.scene
collection = bpy.data.collections['ANATOMY']
scene.render.engine = 'CYCLES'
scene.cycles.samples = 8
scene.render.bake.use_selected_to_active = False
scene.render.bake.margin = 12
scene.render.bake.use_clear = True

for kind in ['muscle', 'cortical_bone', 'tendon']:
    material = bpy.data.materials['Anatomy_' + kind]
    vertices, faces, sources, coordinates = [], [], [], []
    for ob in list(collection.objects):
        if ob.type != 'MESH' or material not in list(ob.data.materials):
            continue
        offset = len(vertices)
        points = np.array([tuple(ob.matrix_world @ v.co) for v in ob.data.vertices])
        slots = [i for i, m in enumerate(ob.data.materials) if m == material]
        used = sorted({v for p in ob.data.polygons if p.material_index in slots for v in p.vertices})
        center = points[used].mean(axis=0)
        _, axes = np.linalg.eigh(np.cov((points[used] - center).T))
        # The long principal axis follows each individual muscle belly, rather
        # than projecting the same horizontal bands across the entire body.
        local = (points - center) @ axes
        vertices.extend(points.tolist())
        coordinates.extend(local.tolist())
        uv = ob.data.uv_layers.active or ob.data.uv_layers.new(name='UVMap')
        for face in ob.data.polygons:
            if face.material_index in slots:
                faces.append(tuple(offset + i for i in face.vertices))
                sources.extend((uv, i) for i in face.loop_indices)
    mesh = bpy.data.meshes.new('Structural_atlas_' + kind)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    proxy = bpy.data.objects.new(mesh.name, mesh)
    scene.collection.objects.link(proxy)
    attr = mesh.attributes.new('TissueCoordinate', 'FLOAT_VECTOR', 'POINT')
    attr.data.foreach_set('vector', np.asarray(coordinates).ravel())
    for face in mesh.polygons:
        face.use_smooth = True
    bpy.ops.object.select_all(action='DESELECT')
    proxy.select_set(True)
    bpy.context.view_layer.objects.active = proxy
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.2, island_margin=.012)
    bpy.ops.object.mode_set(mode='OBJECT')
    for i, (uv, loop) in enumerate(sources):
        uv.data[loop].uv = mesh.uv_layers.active.data[i].uv

    bake = bpy.data.materials.new('Bake_structural_' + kind)
    bake.use_nodes = True
    mesh.materials.append(bake)
    n, links = bake.node_tree.nodes, bake.node_tree.links
    n.clear()
    def node(name): return n.new(name)
    def link(a, b): links.new(a, b)
    output = node('ShaderNodeOutputMaterial')
    emission = node('ShaderNodeEmission')
    link(emission.outputs[0], output.inputs[0])
    coord = node('ShaderNodeAttribute')
    coord.attribute_name = 'TissueCoordinate'
    def noise(scale, detail=3):
        mapping = node('ShaderNodeVectorMath')
        mapping.operation = 'MULTIPLY'
        mapping.inputs[1].default_value = scale
        link(coord.outputs['Vector'], mapping.inputs[0])
        value = node('ShaderNodeTexNoise')
        value.inputs['Scale'].default_value = 1
        value.inputs['Detail'].default_value = detail
        value.inputs['Roughness'].default_value = .65
        link(mapping.outputs[0], value.inputs['Vector'])
        return value.outputs['Fac']
    def ramp(value, dark, light, low=.15, high=.85):
        r = node('ShaderNodeValToRGB')
        r.color_ramp.elements[0].position = low
        r.color_ramp.elements[0].color = (*dark, 1)
        r.color_ramp.elements[1].position = high
        r.color_ramp.elements[1].color = (*light, 1)
        link(value, r.inputs[0])
        return r.outputs[0]
    macro = noise((7, 7, 7))
    is_bone = kind == 'cortical_bone'
    is_tendon = kind == 'tendon'
    grain = noise((70, 70, 70) if is_bone else (100, 100, 3))
    bundles = noise((32, 32, 2) if not is_bone else (22, 22, 22))
    if not is_bone:
        separate = node('ShaderNodeSeparateXYZ')
        link(coord.outputs['Vector'], separate.inputs[0])
        angle = node('ShaderNodeMath')
        angle.operation = 'ARCTAN2'
        link(separate.outputs['Y'], angle.inputs[0])
        link(separate.outputs['X'], angle.inputs[1])
        phase = node('ShaderNodeMath')
        phase.operation = 'MULTIPLY_ADD'
        phase.inputs[1].default_value = 38
        link(angle.outputs[0], phase.inputs[0])
        link(bundles, phase.inputs[2])
        wave = node('ShaderNodeMath')
        wave.operation = 'SINE'
        link(phase.outputs[0], wave.inputs[0])
        normalize = node('ShaderNodeMath')
        normalize.operation = 'MULTIPLY_ADD'
        normalize.inputs[1].default_value = .5
        normalize.inputs[2].default_value = .5
        link(wave.outputs[0], normalize.inputs[0])
        fiber_mix = node('ShaderNodeMixRGB')
        fiber_mix.inputs[0].default_value = .40
        link(grain, fiber_mix.inputs[1])
        link(normalize.outputs[0], fiber_mix.inputs[2])
        grain = fiber_mix.outputs[0]
    if is_bone:
        color = ramp(macro, (.48, .395, .27), (.79, .73, .59))
        detail = ramp(grain, (.57, .51, .41), (1, 1, 1), .25, .68)
        roughness = (.54, .75)
    elif is_tendon:
        color = ramp(macro, (.55, .48, .37), (.84, .79, .65))
        detail = ramp(bundles, (.77, .75, .70), (1, 1, 1))
        roughness = (.36, .53)
    else:
        color = ramp(macro, (.19, .028, .026), (.37, .082, .065))
        detail = ramp(grain, (.64, .50, .47), (1.16, 1.07, 1.02))
        roughness = (.46, .64)
    multiply = node('ShaderNodeMixRGB')
    multiply.blend_type = 'MULTIPLY'
    multiply.inputs[0].default_value = 1
    link(color, multiply.inputs[1])
    link(detail, multiply.inputs[2])
    ao = node('ShaderNodeAmbientOcclusion')
    ao.samples = 8
    ao.only_local = True
    ao.inputs['Distance'].default_value = .055 if is_bone else .025
    shade = node('ShaderNodeMixRGB')
    shade.blend_type = 'MULTIPLY'
    shade.inputs[0].default_value = .32
    link(multiply.outputs[0], shade.inputs[1])
    link(ao.outputs['AO'], shade.inputs[2])
    link(shade.outputs[0], emission.inputs[0])
    target = node('ShaderNodeTexImage')
    def bake_map(suffix, mode, size):
        image = bpy.data.images.new(kind + '-structural-' + suffix, size, size, alpha=False)
        if suffix != 'albedo': image.colorspace_settings.name = 'Non-Color'
        target.image = image
        n.active = target
        bpy.ops.object.bake(type=mode)
        image.filepath_raw = str(OUT / 'textures' / (kind + '-' + suffix + '.png'))
        image.file_format = 'PNG'
        image.save()
        image.pack()
        return image
    size = 512 if is_tendon else 1024
    albedo = bake_map('albedo', 'EMIT', size)
    rr = ramp(grain, (roughness[0],)*3, (roughness[1],)*3)
    link(rr, emission.inputs[0])
    rough = bake_map('roughness', 'EMIT', 512)
    bsdf = node('ShaderNodeBsdfPrincipled')
    bump = node('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .45
    bump.inputs['Distance'].default_value = .005 if is_bone else .006
    link(grain, bump.inputs['Height'])
    link(bump.outputs[0], bsdf.inputs['Normal'])
    link(bsdf.outputs[0], output.inputs[0])
    normal = bake_map('normal', 'NORMAL', size)
    bpy.data.objects.remove(proxy, do_unlink=True)
    bpy.data.meshes.remove(mesh)
    bpy.data.materials.remove(bake)

    n, links = material.node_tree.nodes, material.node_tree.links
    n.clear()
    output = node('ShaderNodeOutputMaterial')
    p = node('ShaderNodeBsdfPrincipled')
    p.name = 'Principled BSDF'
    link(p.outputs[0], output.inputs[0])
    tex = node('ShaderNodeTexImage')
    tex.image = albedo
    tint = node('ShaderNodeMixRGB')
    tint.blend_type = 'MULTIPLY'
    tint.inputs[0].default_value = 1
    tint.inputs[2].default_value = (1, 1, 1, 1)
    link(tex.outputs[0], tint.inputs[1])
    link(tint.outputs[0], p.inputs['Base Color'])
    rt = node('ShaderNodeTexImage')
    rt.image = rough
    link(rt.outputs[0], p.inputs['Roughness'])
    nt = node('ShaderNodeTexImage')
    nt.image = normal
    nm = node('ShaderNodeNormalMap')
    nm.inputs['Strength'].default_value = .65
    link(nt.outputs[0], nm.inputs['Color'])
    link(nm.outputs[0], p.inputs['Normal'])
    p.inputs['IOR'].default_value = 1.46 if is_bone else 1.38
    p.inputs['Coat Weight'].default_value = .025 if is_bone else .055
    p.inputs['Coat Roughness'].default_value = .48 if is_bone else .34
    p.inputs['Subsurface Weight'].default_value = .025 if is_bone else .09
    p.inputs['Subsurface Radius'].default_value = (1, .35, .2)
    p.inputs['Subsurface Scale'].default_value = .012
    material['tint'] = [1, 1, 1]
    material['textureSource'] = kind + '-albedo.png'
    material['realismRevision'] = 4
    print('STRUCTURAL_TISSUE_BAKED', kind, flush=True)

for img in list(bpy.data.images):
    if img.users == 0: bpy.data.images.remove(img)
helper = ROOT / 'scripts/build_anatomy.py'
scope = {'__file__': str(helper), 'ANATOMY_PHASE': 'refinement'}
exec(compile(helper.read_text().split("passes={'skeleton'")[0], str(helper), 'exec'), scope)
scope['finish']()
