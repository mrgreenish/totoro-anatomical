// Additive replacement preserves the current coat containment and tissue work.
// Re-running replaces the same stable IDs, never appends duplicate variants.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, unpartition, prune, dedup, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import * as validator from 'gltf-validator';
import { Vector3 } from 'three';

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder,
});
const addition = await io.read('artwork/anatomy/reproductive-raw.glb');
const changes = JSON.parse(await readFile('artwork/anatomy/reproductive-manifest.json', 'utf8'));
const replaced = new Set(['urethra', ...changes.parts.map(p => p.id)]);
const manifest = JSON.parse(await readFile('artwork/anatomy/manifest.json', 'utf8'));
manifest.parts = [...manifest.parts.filter(p => !replaced.has(p.id) && !p.variant), ...changes.parts];
manifest.triangles = manifest.parts.reduce((sum, p) => sum + p.triangles, 0);
manifest.version = 2;
assert(manifest.triangles <= 500_000, `${manifest.triangles} triangles exceed the existing budget`);
const outputs=[];
for (const path of ['artwork/anatomy/anatomy-raw.glb', 'public/models/totoro-anatomy.glb']) {
  const target = await io.read(path);
  const existingMaterials = new Map(target.getRoot().listMaterials().map(m => [m.getName(), m]));
  for (const node of target.getRoot().listNodes()) {
    if (replaced.has(node.getExtras().partId) || node.getExtras().variant) node.dispose();
  }
  const scene = target.getRoot().listScenes()[0];
  const map = mergeDocuments(target, addition);
  for (const sourceScene of addition.getRoot().listScenes()) {
    const added = map.get(sourceScene);
    for (const node of added.listChildren()) scene.addChild(node);
    added.dispose();
  }
  for (const sourceMesh of addition.getRoot().listMeshes()) {
    for (const p of map.get(sourceMesh).listPrimitives()) {
      const material = existingMaterials.get(p.getMaterial().getName());
      assert(material, `Expected existing tissue material ${p.getMaterial().getName()}`);
      p.setMaterial(material);
    }
  }
  // keepExtras deliberately retains metadata-bearing resources. Dispose the
  // unused imported atlas copies explicitly after binding the existing ones.
  for (const material of addition.getRoot().listMaterials()) map.get(material).dispose();
  for (const texture of addition.getRoot().listTextures()) map.get(texture).dispose();
  await target.transform(unpartition(), dedup(), prune({ keepExtras: true }));
  // UV poles on older authored parts may contain zero-length tangents. Give
  // these singularities a stable frame perpendicular to the surface normal.
  for (const mesh of target.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const tangent=p.getAttribute('TANGENT'), normal=p.getAttribute('NORMAL');
    if (!tangent || !normal) continue;
    for (let i=0;i<tangent.getCount();i++) {
      const value=tangent.getElement(i,[]);
      const t=new Vector3().fromArray(value);
      if (t.lengthSq()<.5) {
        const n=new Vector3().fromArray(normal.getElement(i,[])).normalize();
        t.crossVectors(n,Math.abs(n.y)<.9?new Vector3(0,1,0):new Vector3(1,0,0)).normalize();
        tangent.setElement(i,[t.x,t.y,t.z,value[3]||1]);
      }
    }
  }
  if (path.startsWith('public/')) await target.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const bytes = await io.writeBinary(target);
  const report = await validator.validateBytes(bytes);
  assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues.messages));
  if (path.startsWith('public/')) assert(bytes.length <= 12_000_000, `Existing transfer budget exceeded: ${bytes.length} bytes`);
  outputs.push([path,bytes]);
  console.log(`${path}: ${bytes.length} bytes; ${manifest.triangles} triangles; no glTF errors`);
}
for (const [path,bytes] of outputs) await writeFile(path,bytes);
await writeFile('artwork/anatomy/manifest.json', JSON.stringify(manifest, null, 2));
