"""Reproducible offline material studies; does not modify the saved source."""
import bpy
from pathlib import Path
from mathutils import Vector

OUT = Path(__file__).resolve().parents[1] / 'artwork/anatomy/reviews'
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 40
scene.cycles.use_denoising = True
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'
scene.world.use_nodes = True
background = scene.world.node_tree.nodes.get('Background')
background.inputs['Color'].default_value = (.032, .04, .052, 1)
background.inputs['Strength'].default_value = .4
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
for ob in list(scene.objects):
    if ob.type == 'LIGHT': bpy.data.objects.remove(ob, do_unlink=True)
for name, position, energy, size, color in [
    ('Key', (-3, -5, 7), 650, 4, (1, .94, .87)),
    ('Fill', (4, -3, 4), 180, 3, (.80, .88, 1)),
    ('Edge', (2, 3, 5), 700, 3, (.88, .93, 1)),
]:
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.shape, data.size, data.color = energy, 'DISK', size, color
    light = bpy.data.objects.new(name, data)
    scene.collection.objects.link(light)
    light.location = position
    light.rotation_euler = (Vector((0, 0, 2)) - light.location).to_track_quat('-Z', 'Y').to_euler()
camera = scene.camera
camera.data.type = 'ORTHO'
studies = [
    ('muscles-realistic', 'muscles', None, (0, -13, 3.3), (0, 0, 1.9), 4.3),
    ('muscles-three-quarter', 'muscles', None, (3, -12, 4.4), (0, 0, 1.9), 4.3),
    ('muscles-profile', 'muscles', None, (10, -2, 3.0), (0, 0, 1.9), 4.3),
    ('muscles-shoulder-close', 'muscles', None, (2.5, -8, 3.35), (.95, -.24, 2.45), 2.0),
    ('muscles-thigh-close', 'muscles', None, (2.5, -8, 1.65), (.78, -.20, .56), 2.0),
    ('bones-realistic', 'bones', None, (3, -12, 4.8), (0, 0, 2.1), 4.8),
    ('bone-detail-realistic', None, ['skull', 'mandible'], (2, -9, 5), (0, -.05, 3.4), 2.5),
]
for name, system, ids, position, target, scale in studies:
    for ob in scene.objects:
        if ob.type == 'MESH':
            ob.hide_render = not (ob.get('partId') in ids if ids else system in ob.get('systems', []))
    camera.location = position
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.ortho_scale = scale
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 1100
    scene.render.filepath = str(OUT / (name + '.png'))
    bpy.ops.render.render(write_still=True)
    print('STRUCTURAL_STUDY_RENDERED', name, flush=True)
