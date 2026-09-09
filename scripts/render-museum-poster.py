"""Render the existing sculpt with the browser's museum camera; never save over the .blend."""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

scene = bpy.context.scene
radius = math.hypot(3.5, 12.4)
angle = math.radians(25)
scene.camera.location = (math.sin(angle) * radius, -math.cos(angle) * radius, 4.0)
scene.camera.rotation_euler = (Vector((0, 0, 2.30)) - scene.camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera.data.type = 'PERSP'
scene.camera.data.sensor_fit = 'VERTICAL'
scene.camera.data.sensor_height = 36
scene.camera.data.lens = 36 / (2 * math.tan(math.radians(30) / 2))
scene.world.color = (.14, .14, .14)
background = scene.world.node_tree.nodes.get('Background') if scene.world.use_nodes else None
if background:
    # The browser's generated room environment supplies broad studio reflections.
    # World.color alone does not affect a node-based Blender world.
    background.inputs['Color'].default_value = (.55, .60, .53, 1)
    background.inputs['Strength'].default_value = .65
for name, power, color, position in [
    ('Large window', 850, (1, .92, .79), (-3.5, -5, 7)),
    ('Cool fill', 192, (.82, .90, 1), (5, -2, 4)),
    ('Soft rim', 1140, (.72, .82, .956), (2, 4, 5)),
]:
    light = bpy.data.objects.get(name)
    if light:
        light.data.energy = power * 3
        light.data.color = color
        light.location = position
        light.rotation_euler = (Vector((0, 0, 2)) - light.location).to_track_quat('-Z', 'Y').to_euler()

for ob in scene.objects:
    if ob.is_shadow_catcher:
        ob.hide_render = True

material = bpy.data.materials.new('Museum poster plinth')
material.diffuse_color = (.708, .738, .624, 1)
material.use_nodes = True
shader = material.node_tree.nodes.get('Principled BSDF')
shader.inputs['Base Color'].default_value = material.diffuse_color
shader.inputs['Roughness'].default_value = .82
bpy.ops.mesh.primitive_cylinder_add(vertices=112, radius=2.13, depth=.13, location=(0, 0, -.095))
bpy.context.object.data.materials.append(material)
bpy.ops.mesh.primitive_torus_add(major_radius=2.095, minor_radius=.036, major_segments=112, minor_segments=8, location=(0, 0, -.033))
bpy.context.object.data.materials.append(material)

scene.render.engine = 'CYCLES'
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.render.threads_mode = 'FIXED'
scene.render.threads = 4
scene.view_settings.view_transform = 'AgX'
scene.render.resolution_x = scene.render.resolution_y = 1100
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.film_transparent = True
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
scene.render.filepath = str(Path(args[0] if args else '/tmp/totoro-museum-poster.png').resolve())
bpy.ops.render.render(write_still=True)
