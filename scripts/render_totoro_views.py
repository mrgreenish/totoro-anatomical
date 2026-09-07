"""Render fixed review views from the current editable sculpture.
Run: blender -b artwork/totoro.blend --python scripts/render_totoro_views.py
"""
import bpy
from pathlib import Path
from mathutils import Vector

root=Path(__file__).resolve().parents[1]
out=root/'.img2threejs'/'reviews'
out.mkdir(parents=True,exist_ok=True)
scene=bpy.context.scene
scene.cycles.samples=32
scene.render.resolution_x=900
scene.render.resolution_y=900
scene.render.resolution_percentage=100
scene.camera.data.ortho_scale=6.4
for name,position in [('front',(0,-15,4.2)),('three-quarter',(7,-13,5.7)),('profile',(15,0,4.2)),('rear',(8,13,5.7))]:
    scene.camera.location=position
    scene.camera.rotation_euler=(Vector((0,0,2.48))-scene.camera.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(out/(name+'.png'))
    bpy.ops.render.render(write_still=True)
    print('REVIEW_VIEW',name,flush=True)
