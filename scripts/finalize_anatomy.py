"""Export, validate, and leave an editable source with the anatomy collection."""
from pathlib import Path
import bpy
root=Path(__file__).parent
for filename,phase in [('build_anatomy.py','finish'),('verify_anatomy_blender.py','all')]:
    script=root/filename
    exec(compile(script.read_text(),str(script),'exec'),{'__file__':str(script),'ANATOMY_PHASE':phase})
# Blender-only cuts are made on temporary duplicates for review.
script=root/'review_anatomy.py'
for view in ['skin','split-x','split-y','split-z','exploded']:
    exec(compile(script.read_text(),str(script),'exec'),{'__file__':str(script),'ANATOMY_PHASE':view})
