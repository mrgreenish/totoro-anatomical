import assert from 'node:assert/strict';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import {readFile,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
const doc=await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read('public/models/totoro-anatomy.glb');
const manifest=JSON.parse(await readFile('artwork/anatomy/manifest.json','utf8'));
const nodes=doc.getRoot().listNodes().filter(n=>n.getExtras().partId);
const ids=nodes.map(n=>n.getExtras().partId);
const reproductive=JSON.parse(await readFile('artwork/anatomy/reproductive-manifest.json','utf8'));
assert(!ids.includes('urethra'),'Generic urethra must be replaced');
for(const p of reproductive.parts.filter(p=>p.variant)){
  const node=nodes.find(n=>n.getExtras().partId===p.id);
  assert(node,`Missing reproductive part ${p.id}`);
  assert.equal(node.getExtras().variant,p.variant);
  assert.deepEqual(node.getExtras().systems,['reproductive']);
  assert(node.getExtras().description&&node.getExtras().anatomicalEnvelope);
}
assert.equal(ids.length,new Set(ids).size);
const byId=(a,b)=>a.localeCompare(b);
assert.deepEqual([...ids].sort(byId),manifest.parts.map(p=>p.id).sort(byId));
let triangles=0;
for(const node of nodes){
  const e=node.getExtras();assert(e.label&&e.assemblyGroup&&e.systems.length&&e.explodeOffset.length===3);
  assert(e.explodeOffset.every(Number.isFinite));
  for(const primitive of node.getMesh().listPrimitives()){
    triangles+=primitive.getIndices().getCount()/3;
    assert(primitive.getAttribute('POSITION').getArray().every(Number.isFinite));
    if(primitive.getMaterial().getNormalTexture())assert(primitive.getAttribute('TANGENT'));
  }
}
assert(triangles<=500_000);
const textures=[];
for(const t of doc.getRoot().listTextures()){
  const m=await sharp(t.getImage()).metadata();assert(m.width&&m.height);
  textures.push({name:t.getName(),width:m.width,height:m.height,format:m.format});
}
const materials=doc.getRoot().listMaterials();assert(materials.some(m=>m.getNormalTexture()));assert(materials.some(m=>m.getMetallicRoughnessTexture()));
const tissueNames=['brain','myocardium','lungs','liver','stomach','intestine','kidney','spleen','glands','muscle','cortical_bone','tendon'];
const tissueAlbedos=new Set();
for(const name of tissueNames){
  const m=materials.find(m=>m.getName()===`Anatomy_${name}`);
  assert(m,`Missing tissue material: ${name}`);
  assert(m.getBaseColorTexture()&&m.getNormalTexture()&&m.getMetallicRoughnessTexture(),`Incomplete PBR channels: ${name}`);
  assert(m.getExtension('KHR_materials_clearcoat')?.getClearcoatFactor()>0,`Missing tissue surface coat: ${name}`);
  tissueAlbedos.add(m.getBaseColorTexture());
}
assert.equal(tissueAlbedos.size,tissueNames.length,'Each tissue must retain its own baked albedo atlas');
const bytes=(await readFile('public/models/totoro-anatomy.glb')).length;assert(bytes<=12_000_000);
const report={passed:true,parts:ids.length,triangles,bytes,textures,tissueAtlases:tissueNames,physicalCoatsPresent:true,metadataPreserved:true,tangentsPresent:true};
await writeFile('artwork/anatomy/asset-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
