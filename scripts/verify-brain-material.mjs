import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import * as THREE from 'three';

// Exercise the actual material factory against the installed Three.js shader
// chunks. Standard-to-physical promotion must retain maps and PHYSICAL defines.
const source = await readFile('lib/totoro-anatomy.ts', 'utf8');
const factory = source.slice(source.indexOf('function brainTissueMaterial('), source.indexOf('export function createAnatomyExplorer'));
const code = ts.transpileModule(factory + '\nexport { brainTissueMaterial };', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const tissueCode = ts.transpileModule(await readFile('lib/tissue-materials.ts','utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace(/from ['"]([^'"]+)['"]/g, (_, name) => `from ${JSON.stringify(import.meta.resolve(name))}`);
const tissueURL = 'data:text/javascript;base64,' + Buffer.from(tissueCode).toString('base64');
const { brainTissueMaterial } = await import('data:text/javascript;base64,' + Buffer.from(
  `import * as THREE from ${JSON.stringify(import.meta.resolve('three'))};\nimport { applyTissuePreset, BRAIN_SURFACE } from ${JSON.stringify(tissueURL)};\n${code}`,
).toString('base64'));
for (const sourceMaterial of [new THREE.MeshStandardMaterial(), new THREE.MeshPhysicalMaterial()]) {
  sourceMaterial.name = 'Anatomy_brain';
  sourceMaterial.map = new THREE.Texture();
  sourceMaterial.normalMap = new THREE.Texture();
  sourceMaterial.roughnessMap = new THREE.Texture();
  const material = brainTissueMaterial(sourceMaterial);
  assert.equal(material.defines.PHYSICAL, '');
  assert.equal(material.map, sourceMaterial.map);
  assert.equal(material.normalMap, sourceMaterial.normalMap);
  assert.equal(material.roughnessMap, sourceMaterial.roughnessMap);
  assert.equal(material.name, 'Anatomy_brain');
  assert.ok(material.clearcoat >= .75 && material.clearcoat <= 1);
  assert.ok(material.roughness < .3 && material.clearcoatRoughness < .13);
  const shader = { vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(shader);
  for (const detail of ['vBrainPosition = position', 'tissueColor * tissueShade', 'dFdx(microRelief)', 'material.clearcoat = mix']) {
    assert.ok((shader.vertexShader + shader.fragmentShader).includes(detail), `Shader hook missing: ${detail}`);
  }
  assert.ok(shader.fragmentShader.includes('#include <clipping_planes_fragment>'));
  assert.ok(shader.fragmentShader.indexOf('float tissueFine') < shader.fragmentShader.indexOf('float microRelief'));
  material.dispose();
  sourceMaterial.map.dispose(); sourceMaterial.normalMap.dispose(); sourceMaterial.roughnessMap.dispose(); sourceMaterial.dispose();
}
console.log('Brain material: standard/physical inputs, retained textures, physical shader defines, shader hooks, and clipping passed.');
