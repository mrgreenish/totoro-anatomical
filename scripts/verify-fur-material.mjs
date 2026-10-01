// The fur material patches three.js shader chunks by name. Run the patch against
// three's real standard-material shaders so a renamed or moved chunk fails here
// instead of silently shipping an unpatched coat.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { moduleURLFor } from './load-typescript.mjs';

const { createFurShading, furKindOf } = await import(await moduleURLFor('lib/fur-material.ts'));
let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; };

// Every coat mesh in the shipped model maps to its groom region.
const bytes = await readFile('public/models/totoro.glb');
const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
const expected = { Body: 'torso', Cream_belly: 'torso', Fine_grey_fibers: 'torso', Face_fibers: 'torso', Tail: 'tail', Tail_fibers: 'tail',
  Ear_L: 'ear', Ear_R_fibers: 'ear', Arm_L: 'limb', Arm_R_fibers: 'limb', Foot_L: 'limb', Foot_R_fibers: 'limb' };
const names = new Set(gltf.nodes.map(node => node.name?.replaceAll(' ', '_').replaceAll('.', '')));
for (const [name, kind] of Object.entries(expected)) {
  check(names.has(name), `${name} is in the model`);
  check(furKindOf(name) === kind, `${name} grooms as ${kind}`);
}

const fur = createFurShading();
const volume = fur.uniforms.furVolume.value;
check(volume.isData3DTexture && volume.image.width === 64 && volume.image.depth === 64, 'Noise volume is 64³');
check(volume.generateMipmaps && volume.minFilter === THREE.LinearMipmapLinearFilter, 'Noise volume is mipmapped, so the undercoat fades instead of crawling');
const data = volume.image.data;
const mean = data.reduce((sum, value) => sum + value, 0) / data.length;
check(Math.abs(mean - 127.5) < 1, `Noise is centred, so tone changes keep the coat's brightness (mean ${mean.toFixed(2)})`);
check(createFurShading().uniforms.furVolume.value.image.data.every((value, i) => value === data[i]), 'Noise volume is identical on every load');

const source = new THREE.MeshStandardMaterial({ name: 'Fur • warm slate', color: 0x667370 });
for (const fibers of [false, true]) for (const kind of ['torso', 'limb', 'tail', 'ear']) {
  const material = fur.create({ source, fibers, kind, vertexColors: fibers });
  check(material instanceof THREE.MeshStandardMaterial, 'Fur stays a standard material, so forest light and the section rim can patch it');
  check(material.side === (fibers ? THREE.DoubleSide : THREE.FrontSide), 'Strands are double sided, skin is not');
  const shader = { uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
    vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader);
  const { vertexShader: vs, fragmentShader: fs } = shader;
  // Each hook appends after its chunk; the chunk must still be there and the addition present.
  for (const [chunk, marker] of [['common', 'furFlowField'], ['beginnormal_vertex', 'furFlowObject = furFlowField'],
    ['skinnormal_vertex', 'skinMatrix * vec4( furFlowObject'], ['defaultnormal_vertex', 'vFurFlow = normalize'], ['begin_vertex', 'vFurPosition = position']]) {
    check(vs.includes(`#include <${chunk}>`) && vs.includes(marker), `Vertex hook after ${chunk}`);
  }
  for (const [chunk, marker] of [['lights_physical_pars_fragment', '#define RE_Direct RE_Direct_Fur'], ['color_fragment', 'furGloss ='],
    ['normal_fragment_maps', 'furT ='], ['aomap_fragment', 'reflectedLight.indirectDiffuse *= furOcclusion']]) {
    check(fs.includes(`#include <${chunk}>`) && fs.includes(marker), `Fragment hook after ${chunk}`);
  }
  check(fs.indexOf('#define RE_Direct RE_Direct_Fur') > fs.indexOf('#include <lights_physical_pars_fragment>'), 'Fur lighting overrides the physical BRDF after it is defined');
  check(fs.includes('texture( furVolume') === !fibers, 'Only the skin samples the undercoat');
  check(fs.includes('normal *= faceDirection;') === fibers, 'Strands keep their root normal on both faces');
  check(shader.uniforms.furKind.value === { torso: 0, limb: 1, tail: 2, ear: 3 }[kind], 'Groom region reaches the shader');
  for (const name of ['furVolume', 'furLobes', 'furStrength', 'furTone', 'furGrain', 'furRoughness']) {
    check(shader.uniforms[name] === fur.uniforms[name], `${name} is shared by every coat material`);
  }
  check(material.customProgramCacheKey() === `fur-v1-${fibers}`, 'Regions and colors share one program per strand or skin');
  material.dispose();
}
fur.dispose();
console.log(`Fur material verified: ${checks} checks — region mapping for the shipped model, a centred, mipmapped and deterministic noise volume, and every shader hook against three's own standard shaders.`);
