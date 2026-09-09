import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {dedup,join,prune,weld,simplify,meshopt} from '@gltf-transform/functions';
import {MeshoptDecoder,MeshoptEncoder,MeshoptSimplifier} from 'meshoptimizer';
import sharp from 'sharp';
import {readFile,writeFile,stat} from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as validator from 'gltf-validator';

const art='artwork/anatomy/heart-detail',out='public/models/heart-detail';
await Promise.all([MeshoptDecoder.ready,MeshoptEncoder.ready,MeshoptSimplifier.ready]);
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const reports=[];
for(const mobile of [false,true]) {
  const doc=await io.read(`${art}/heart-detail-raw.glb`);
  // Keep each moving leaflet and its center metadata; batch static tissue.
  await doc.transform(dedup(),weld(),join({filter:node=>!node.getExtras().valve}),prune({keepAttributes:true,keepExtras:true}));
  await doc.transform(simplify({simplifier:MeshoptSimplifier,ratio:mobile?.48:.82,error:mobile?.0012:.00025,lockBorder:true}));
  await doc.transform(meshopt({encoder:MeshoptEncoder,level:'high'}));
  const name=mobile?'heart-detail-mobile.glb':'heart-detail.glb';
  await io.write(`${out}/${name}`,doc);
  let triangles=0,draws=0;
  for(const mesh of doc.getRoot().listMeshes())for(const primitive of mesh.listPrimitives()) {
    triangles+=primitive.getIndices().getCount()/3;draws++;
    assert.ok(primitive.getAttribute('NORMAL'));assert.ok(primitive.getAttribute('TEXCOORD_0'));
    assert.ok(primitive.getAttribute('POSITION').getArray().every(Number.isFinite));
  }
  const bytes=await readFile(`${out}/${name}`);
  const valid=await validator.validateBytes(new Uint8Array(bytes),{uri:name});
  assert.equal(valid.issues.numErrors,0);assert.ok(triangles<340000);assert.ok(draws<=24);
  const leaflets=doc.getRoot().listNodes().filter(n=>n.getExtras().valve);
  assert.equal(leaflets.length,11,'Two mitral and three leaflets in the other valves');
  reports.push({name,triangles,draws,bytes:bytes.length,leaflets:leaflets.length,validation:valid.issues});
}
for(const size of [2048,4096]) {
  await sharp(`${art}/basecolor-${size}.png`).removeAlpha().webp({quality:93,effort:6}).toFile(`${out}/basecolor-${size}.webp`);
  await sharp(`${art}/normal-${size}.png`).removeAlpha().webp({quality:95,effort:6}).toFile(`${out}/normal-${size}.webp`);
}
await sharp(`${art}/surface.png`).removeAlpha().webp({lossless:true,effort:6}).toFile(`${out}/surface.webp`);
const sizes={};
for(const name of ['heart-detail.glb','heart-detail-mobile.glb','basecolor-2048.webp','basecolor-4096.webp','normal-2048.webp','normal-4096.webp','surface.webp','anatomy.json']) {
  sizes[name]=(await stat(`${out}/${name}`)).size;assert.ok(sizes[name]<25*1024*1024);
}
await writeFile(`${art}/asset-verification.json`,JSON.stringify({models:reports,sizes,textureChannels:{surface:'R: occlusion, G: roughness, B: optical thickness'},mobileCells:240,desktopCells:560},null,2));
console.log(JSON.stringify({models:reports.map(({validation:_validation,...r})=>r),sizes},null,2));
