"""Small deforming rig shared by the editable sculpture and its glTF export."""
import bpy
import math
from mathutils import Matrix, Vector


def smooth(a,b,value):
    t=min(1,max(0,(value-a)/(b-a)))
    return t*t*(3-2*t)


def build_rig(collection):
    data=bpy.data.armatures.new('Totoro deformation')
    rig=bpy.data.objects.new('Totoro_Rig',data)
    collection.objects.link(rig)
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True);bpy.context.view_layer.objects.active=rig
    bpy.ops.object.mode_set(mode='EDIT')
    definitions=[('MotionRoot',(0,0,.3),(0,0,1.3),None),
                 ('Breath',(0,0,1.65),(0,0,2.65),'MotionRoot'),
                 ('TailSway',(0,.64,.78),(0,1.50,.90),'MotionRoot')]
    for side,label in [(-1,'L'),(1,'R')]:
        definitions.extend([
            ('ArmSwing_'+label,(side*1.20,.015,2.60),(side*1.20,.015,1.60),'MotionRoot'),
            ('EarBend_'+label,(side*.72,.045,3.83),(side*.72,.045,4.83),'MotionRoot')])
    for name,head,tail,parent in definitions:
        bone=data.edit_bones.new(name);bone.head=head;bone.tail=tail
        if parent:bone.parent=data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    rig.show_in_front=True;data.display_type='STICK'
    for bone in rig.pose.bones:bone.rotation_mode='XYZ'
    torso_names={'Body','Cream belly','Belly chevrons','Fine grey fibers','Fine ivory fibers','Chevron fibers','Face fibers','Cheek fur tufts'}
    bpy.context.view_layer.update()
    rest_world={ob.name:ob.matrix_world.copy() for ob in collection.objects}
    for ob in list(collection.objects):
        if ob.type!='MESH':continue
        name=ob.name;kind=None;label=None
        if name in torso_names:kind='torso';bone_name='Breath'
        for candidate in ['L','R']:
            if name.startswith('Arm_'+candidate) or name.startswith('Hand_'+candidate):
                kind='arm';label=candidate;bone_name='ArmSwing_'+candidate
            if name.startswith('Ear_'+candidate):
                kind='ear';label=candidate;bone_name='EarBend_'+candidate
        if name.startswith('Tail'):kind='tail';bone_name='TailSway'
        if not kind:continue
        bpy.context.view_layer.update()
        world=rest_world[name]
        # Bake only rest transforms; all controlled surfaces use the rig's space.
        ob.data.transform(world)
        # glTF skinned meshes must be scene roots; skeleton transforms carry motion.
        ob.parent=None;ob.matrix_parent_inverse=Matrix.Identity(4);ob.matrix_basis=Matrix.Identity(4)
        base=ob.vertex_groups.new(name='MotionRoot')
        moving=ob.vertex_groups.new(name=bone_name)
        for vertex in ob.data.vertices:
            p=vertex.co
            if kind=='torso':
                weight=smooth(.20,1.05,p.z)*(1-smooth(2.25,3.08,p.z))
            elif kind=='arm':weight=1-smooth(2.28,2.80,p.z)
            elif kind=='ear':weight=smooth(3.93,4.60,p.z)
            else:weight=smooth(.60,1.35,p.y)
            # Quantized bands reduce weight entropy without visible stepping.
            weight=round(weight*255)/255
            if weight<1:base.add([vertex.index],1-weight,'REPLACE')
            if weight>0:moving.add([vertex.index],weight,'REPLACE')
        modifier=ob.modifiers.new('Soft tissue and attached coat','ARMATURE');modifier.object=rig
        # Cylindrical coordinates keep the source ready for surface-map baking.
        if not ob.data.uv_layers and 'fibers' not in name:
            uv=ob.data.uv_layers.new(name='Surface UV')
            bounds=[v.co.z for v in ob.data.vertices];lo,hi=min(bounds),max(bounds)
            for face in ob.data.polygons:
                coords=[]
                for loop_index in face.loop_indices:
                    p=ob.data.vertices[ob.data.loops[loop_index].vertex_index].co
                    center=(1 if label=='R' else -1)*1.35 if kind=='arm' else (1 if label=='R' else -1)*.80 if kind=='ear' else 0
                    u=(math.atan2(p.y,p.x-center)+math.pi)/(2*math.pi)
                    coords.append((loop_index,u,(p.z-lo)/max(.001,hi-lo)))
                seam=max(c[1] for c in coords)-min(c[1] for c in coords)>.5
                for loop_index,u,v in coords:uv.data[loop_index].uv=(u+1 if seam and u<.5 else u,v)
    bpy.context.view_layer.update()
    return rig
