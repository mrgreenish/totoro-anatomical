import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { readFile, writeFile, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';

const art='artwork/anatomy/brain-detail', out='public/models/brain-detail';
await Promise.all([MeshoptDecoder.ready,MeshoptEncoder.ready]);
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const doc=await io.read(`${art}/brain-detail-raw.glb`);
await doc.transform(prune({keepAttributes:true}),meshopt({encoder:MeshoptEncoder,level:'high'}));
await io.write(`${out}/brain-detail.glb`,doc);
for(const size of [2048,4096]) {
  await sharp(`${art}/basecolor-${size}.png`).removeAlpha().webp({quality:94,effort:6}).toFile(`${out}/basecolor-${size}.webp`);
  await sharp(`${art}/normal-${size}.png`).removeAlpha().webp({lossless:true,effort:6}).toFile(`${out}/normal-${size}.webp`);
}
const channel=async name=>sharp(`${art}/${name}.png`).removeAlpha().extractChannel(0).raw().toBuffer();
const [ao,rough,wet,thick]=await Promise.all(['ao','roughness','wetness','thickness'].map(channel));
const size=2048*2048, surface=Buffer.alloc(size*3),membrane=Buffer.alloc(size*3);
for(let i=0;i<size;i++) {
  surface[i*3]=ao[i];surface[i*3+1]=rough[i];surface[i*3+2]=0;
  membrane[i*3]=wet[i];membrane[i*3+1]=thick[i];membrane[i*3+2]=0;
}
await sharp(surface,{raw:{width:2048,height:2048,channels:3}}).webp({lossless:true,effort:6}).toFile(`${out}/surface.webp`);
await sharp(membrane,{raw:{width:2048,height:2048,channels:3}}).webp({lossless:true,effort:6}).toFile(`${out}/membrane.webp`);
// Preserve the full source height bake. Browser PNG decoders upload 8-bit
// samples, so the runtime copy is explicitly 8-bit rather than claiming a
// higher GPU precision than HTML image decoding actually provides.
await sharp(`${art}/height.png`).removeAlpha().extractChannel(0).png().toFile(`${out}/height.png`);
let triangles=0;
for(const mesh of doc.getRoot().listMeshes()) for(const primitive of mesh.listPrimitives()) {
  triangles+=primitive.getIndices().getCount()/3;
  assert.ok(primitive.getAttribute('NORMAL'),'Normals required');
  if(!/artery|vein/.test(primitive.getMaterial().getName())) {
    assert.ok(primitive.getAttribute('TEXCOORD_0'),'Runtime tissue maps require UVs even though the GLB stores no images');
  }
  const positions=primitive.getAttribute('POSITION').getArray();
  assert.ok(positions.every(Number.isFinite),'Finite positions');
}
const sizes={};
for(const file of ['brain-detail.glb','basecolor-4096.webp','normal-4096.webp','basecolor-2048.webp','normal-2048.webp','surface.webp','membrane.webp','height.png','neural-paths.json']) {
  sizes[file]=(await stat(`${out}/${file}`)).size;
  assert.ok(sizes[file]<25*1024*1024,`${file} exceeds the individual static asset limit`);
}
const paths=JSON.parse(await readFile(`${out}/neural-paths.json`,'utf8'));
assert.ok(paths.length>=12,'Branching neural paths');
assert.ok(triangles>250000&&triangles<350000,`Triangle budget: ${triangles}`);
await writeFile(`${art}/asset-verification.json`,JSON.stringify({triangles,meshes:doc.getRoot().listMeshes().length,sizes,neuralPaths:paths.length,textureSizes:[2048,4096],generatedColorSource:'tissue-source.png',bakeMethod:'Analytical surface-coordinate bakes from the authored cortical field; all data maps use the geometry UVs.'},null,2));
console.log(JSON.stringify({triangles,sizes,neuralPaths:paths.length}));
