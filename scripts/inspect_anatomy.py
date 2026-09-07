import bpy,json
from mathutils import Vector
c=bpy.data.collections.get('ANATOMY')
print('SCENE',bpy.data.filepath,'PARTS',len(c.objects))
for ob in list(c.objects)[:14]+[o for o in c.objects if o.name.startswith(('rib_L_01','humerus','femur','dermis','vertebra_01'))]:
    coords=[ob.matrix_world@Vector(p) for p in ob.bound_box]
    print(ob.name,dict(ob.items()),'verts',len(ob.data.vertices),'faces',len(ob.data.polygons),'bounds',[tuple(min(p[i] for p in coords) for i in range(3)),tuple(max(p[i] for p in coords) for i in range(3))],'hidden',ob.hide_render,'parent',ob.parent)
