import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import * as THREE from 'three';

const moduleURL = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
async function loadModule(path) {
  const source = ts.transpileModule(await readFile(path, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/from ['"]([^'"]+)['"]/g, (_, name) => `from ${JSON.stringify(import.meta.resolve(name))}`);
  return import(moduleURL(source));
}
const presentation = await loadModule('lib/anatomy-presentation.ts');
const { applyTissuePreset, sectionTint } = await loadModule('lib/tissue-materials.ts');
const bytes = await readFile('public/models/totoro-anatomy.glb');
const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
const parts = new Map(gltf.nodes.filter(n => n.extras?.partId).map(n => [n.extras.partId, n.extras]));
const offset = id => {
  const part = parts.get(id);
  assert.ok(part, `Authored part ${id} exists`);
  return presentation.presentationOffset(id, part.assemblyGroup, part.explodeOffset);
};
assert.deepEqual(offset('heart'), offset('coronary_arteries'), 'Coronary vessels follow the heart');
for (const id of ['brain_white_matter', 'cerebellum', 'brainstem']) {
  assert.deepEqual(offset(id), offset('brain'), `${id} retains its spatial relationship with the brain`);
}
for (const part of parts.values()) {
  const result = presentation.presentationOffset(part.partId, part.assemblyGroup, part.explodeOffset);
  assert.ok(result.length === 3 && result.every(Number.isFinite), `${part.partId} has a finite presentation offset`);
  if (part.assemblyGroup === 'bones') assert.deepEqual(result, [0, 0, 0], 'Skeleton remains central');
  if (part.assemblyGroup === 'skin') assert.deepEqual(result, presentation.COAT_OFFSET, 'Dermis follows the exterior coat');
}
for (const id of ['arteries_network', 'veins_network', 'nervous_network']) assert.ok(offset(id)[2] < 0, 'Networks sit behind the organ presentation');
const legacy = [1, 2, 3];assert.equal(presentation.presentationOffset('heart', undefined, legacy), legacy, 'Legacy metadata keeps its original layout');
for (const Type of [THREE.MeshStandardMaterial, THREE.MeshPhysicalMaterial]) {
  for (const name of ['Anatomy_cortical_bone', 'Anatomy_muscle', 'Anatomy_tendon', 'Anatomy_liver', 'detail_cortex']) {
    const material = new Type({ name, color: 0xffffff, map: new THREE.Texture(), normalMap: new THREE.Texture(), roughnessMap: new THREE.Texture() });
    const maps = [material.map, material.normalMap, material.roughnessMap], type = material.type;
    const transmission = material.transmission;
    applyTissuePreset(material);
    assert.equal(material.type, type, 'Preset preserves material class');
    assert.deepEqual([material.map, material.normalMap, material.roughnessMap], maps, 'Preset retains original texture bindings');
    assert.equal(material.transmission, transmission, 'Preset does not enable another transmission pass');
    assert.ok(material.roughness >= 0 && material.roughness <= 1);
    if (name !== 'detail_cortex') assert.ok(material.color.equals(new THREE.Color(sectionTint(name))), 'Sections and surfaces share their tint');
    for (const map of maps) map.dispose();material.dispose();
  }
}
console.log('Presentation verified: real asset groups, attached structures, finite offsets, unchanged material classes/maps/transmission, and matching section tints.');
