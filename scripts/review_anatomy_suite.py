"""Reproducible multi-view review, dispatched once through Blender MCP."""
from pathlib import Path
script=Path(__file__).with_name('review_anatomy.py')
views=['bones','muscles','arteries','veins','nerves','all','profile','split-x','split-y','split-z','exploded']
for view in views:
    exec(compile(script.read_text(),str(script),'exec'),{'__file__':str(script),'ANATOMY_PHASE':view})
print('REVIEW_SUITE_COMPLETE',len(views))
