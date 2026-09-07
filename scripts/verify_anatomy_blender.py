"""Validate the authored anatomy geometry and metadata in Blender via MCP."""
import bpy,bmesh,json,math
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
OUT=Path(__file__).resolve().parents[1]/'artwork'/'anatomy'
objects=list(bpy.data.collections['ANATOMY'].all_objects)
errors=[];rows=[];ids=set();systems=set();total=0
for ob in objects:
    if ob.type!='MESH':continue
    pid=ob.get('partId');ss=list(ob.get('systems',[]));systems.update(ss)
    if not pid or pid in ids:errors.append({'id':pid,'error':'Missing or duplicate stable identity'})
    ids.add(pid)
    if not ob.get('label') or len(ob.get('explodeOffset',[]))!=3 or not ss:errors.append({'id':pid,'error':'Incomplete metadata'})
    bm=bmesh.new();bm.from_mesh(ob.data)
    boundary=sum(1 for e in bm.edges if not e.is_manifold)
    invalid=sum(1 for v in bm.verts if not all(math.isfinite(c) for c in v.co))
    area_zero=sum(1 for face in bm.faces if face.calc_area()<1e-12)
    volume=bm.calc_volume(signed=True)
    if boundary or invalid:errors.append({'id':pid,'error':'Invalid closed volume','nonmanifoldEdges':boundary,'invalidVertices':invalid})
    # Count inward shells. A closed cavity disconnected from the exterior
    # requires the opposite winding; annular tubes have one connected wall.
    remaining=set(bm.faces);signed=[]
    while remaining:
        first=remaining.pop();stack=[first];component=[first]
        while stack:
            f=stack.pop()
            for edge in f.edges:
                for adjacent in edge.link_faces:
                    if adjacent in remaining:remaining.remove(adjacent);stack.append(adjacent);component.append(adjacent)
        v=0
        for f in component:
            a=f.verts[0].co
            for i in range(1,len(f.verts)-1):v+=a.dot(f.verts[i].co.cross(f.verts[i+1].co))/6
        signed.append(v)
    bm.free();ob.data.calc_loop_triangles();tri=len(ob.data.loop_triangles);total+=tri
    row={'id':pid,'systems':ss,'triangles':tri,'nonmanifoldEdges':boundary,'degenerateFaces':area_zero,'volume':round(volume,8),'components':len(signed),'inwardCavities':sum(v<-.00000001 for v in signed),'cavity':bool(ob.get('cavity'))}
    rows.append(row)
required=['skull','mandible','tooth_roots','sternum','sacrum','brain','brain_white_matter','cerebellum','brainstem','heart','lung_L','lung_R','airways','esophagus','stomach','small_intestine','large_intestine','liver','gallbladder','pancreas','spleen','kidney_L','kidney_R','bladder','pituitary','thyroid','parathyroids','pineal','thymus','diaphragm','arteries_network','veins_network','nervous_network']
missing=[p for p in required if p not in ids]
if missing:errors.append({'error':'Missing major part coverage','ids':missing})
if systems!=set(['skin','muscles','bones','organs','arteries','veins','nerves']):errors.append({'error':'Missing system coverage'})
# Cranial and abdominal placement checks use actual mesh bounds.
def bounds(pid):
    ob=next(o for o in objects if o.get('partId')==pid)
    pts=[ob.matrix_world@Vector(c) for c in ob.bound_box]
    return [min(v[i] for v in pts) for i in range(3)],[max(v[i] for v in pts) for i in range(3)]
for pid,zrange in [('brain',(3.15,3.95)),('heart',(1.95,2.9)),('lung_L',(1.9,3.05)),('lung_R',(1.9,3.05)),('stomach',(1.0,2.0)),('bladder',(.2,.8))]:
    lo,hi=bounds(pid)
    if lo[2]<zrange[0] or hi[2]>zrange[1]:errors.append({'id':pid,'error':'Outside intended cavity','z':[lo[2],hi[2]]})
report={'passed':not errors,'parts':len(rows),'triangles':total,'systems':sorted(systems),'errors':errors,'meshes':rows,'scope':'Manifold edges, finite vertices, connected-shell winding, required major parts, and cavity bounds. Intersections and recognizability are also reviewed visually.'}
(OUT/'blender-verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps({k:v for k,v in report.items() if k!='meshes'},indent=2))
