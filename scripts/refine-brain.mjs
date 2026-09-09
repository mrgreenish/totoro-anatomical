import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { writeFile } from 'node:fs/promises';

// Rebuild only the cerebral cortex; the rest of the anatomical asset stays intact.
// Cartesian fields avoid the pinched poles of latitude/longitude-based folds.
const fract = x => x - Math.floor(x);
function hash(x,y,z) {
  x=fract(x*.3183099+.13)*17; y=fract(y*.3183099+.27)*17; z=fract(z*.3183099+.41)*17;
  return fract(x*y*z*(x+y+z));
}
const mix=(a,b,t)=>a+(b-a)*t;
function noise(x,y,z) {
  const i=Math.floor(x),j=Math.floor(y),k=Math.floor(z);
  x=fract(x); y=fract(y); z=fract(z);
  x=x*x*(3-2*x); y=y*y*(3-2*y); z=z*z*(3-2*z);
  return mix(mix(mix(hash(i,j,k),hash(i+1,j,k),x),mix(hash(i,j+1,k),hash(i+1,j+1,k),x),y),
    mix(mix(hash(i,j,k+1),hash(i+1,j,k+1),x),mix(hash(i,j+1,k+1),hash(i+1,j+1,k+1),x),y),z);
}
await Promise.all([MeshoptDecoder.ready,MeshoptEncoder.ready]);
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const doc=await io.read('public/models/totoro-anatomy.glb');
const node=doc.getRoot().listNodes().find(n=>n.getName()==='brain');
if(!node)throw new Error('Cerebral cortex not found');
const oldMesh=node.getMesh(), oldMaterial=oldMesh.listPrimitives()[0].getMaterial();
const scale=node.getScale(), geometries=[];
for(const side of [-1,1]) {
  const geometry=new THREE.SphereGeometry(1,144,96);
  const position=geometry.getAttribute('position');
  const colors=new Float32Array(position.count*3);
  for(let i=0;i<position.count;i++) {
    const x=position.getX(i), y=position.getY(i), z=position.getZ(i);
    const offset=side<0?0:13.7;
    const warp=noise(x*2.2+offset,y*2.2,z*2.2)*1.4;
    const field=noise(x*5.6+warp+offset,y*5.6+warp*.7,z*5.6-warp*.6);
    // Broad gyri separated by narrow, deep sulci, independent of UV poles.
    const valley=Math.exp(-(((field-.50)/.070)**2));
    const secondary=noise(x*6.1+17,y*6.1+offset,z*6.1);
    const crease=valley*(.82+.18*secondary);
    const radius=1-.115*crease+.008*(secondary-.5);
    const medial=side*x<0?.83:1;
    position.setXYZ(i,(side*.318+x*.37*medial*radius)/scale[0],y*.35*radius/scale[1],z*.475*radius/scale[2]);
    const shade=1-.38*crease;
    colors.set([shade,shade,shade],i*3);
  }
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  geometry.computeVertexNormals();
  geometries.push(geometry);
}
const merged=mergeGeometries(geometries);
await writeFile('work/brain-surface.json',JSON.stringify({
  positions:Array.from(merged.attributes.position.array),
  colors:Array.from(merged.attributes.color.array),
  indices:Array.from(merged.index.array),scale,
}));
const buffer=doc.getRoot().listBuffers()[0];
const accessor=(name,type,array)=>doc.createAccessor(name).setType(type).setArray(array).setBuffer(buffer);
const material=oldMaterial.clone().setName('Anatomy_brain_cortex');
// Cortex texture now comes from the continuous runtime tissue shader; remove
// the old radial fold atlas rather than projecting its shadows onto new folds.
material.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null)
  .setBaseColorFactor([1,1,1,1]).setRoughnessFactor(.24).setMetallicFactor(0);
const primitive=doc.createPrimitive().setMaterial(material)
  .setAttribute('POSITION',accessor('cortex-position','VEC3',merged.attributes.position.array))
  .setAttribute('NORMAL',accessor('cortex-normal','VEC3',merged.attributes.normal.array))
  .setAttribute('COLOR_0',accessor('cortex-cavity','VEC3',merged.attributes.color.array))
  .setAttribute('TEXCOORD_0',accessor('cortex-uv','VEC2',merged.attributes.uv.array))
  .setIndices(accessor('cortex-index','SCALAR',merged.index.array));
node.setMesh(doc.createMesh('Cerebral_cortex').addPrimitive(primitive));
node.setExtras({...node.getExtras(),realismRevision:6});
oldMesh.dispose();
await doc.transform(prune({keepExtras:true}),meshopt({encoder:MeshoptEncoder,level:'medium'}));
await io.write('public/models/totoro-anatomy.glb',doc);
console.log(`Rebuilt cortex: ${merged.index.count/3} triangles, rounded gyri, nonradial sulci, baked cavity colors.`);
