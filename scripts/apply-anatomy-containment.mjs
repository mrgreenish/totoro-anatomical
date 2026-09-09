// Apply world-space corrections measured against the actual exported coat.
// Coordinate tuples in the report use Blender's Z-up convention.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { Matrix4, Vector3, BufferGeometry, BufferAttribute } from 'three';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import validator from 'gltf-validator';
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder,
});
const path = 'public/models/totoro-anatomy.glb';
const doc = await io.read(path);
const fixes = JSON.parse(await readFile('artwork/anatomy/containment-fixes.json', 'utf8'));
let corrected = 0;
for (const row of fixes) {
  const node = doc.getRoot().listNodes()[row.ni];
  assert.equal(node.getExtras().partId ?? node.getName(), row.name, 'Correction must match its original part');
  const primitive = node.getMesh().listPrimitives()[row.pi];
  const old = primitive.getAttribute('POSITION');
  // Float coordinates prevent the old quantized bounding box from clamping an inset.
  const positions = new Float32Array(old.getCount() * 3);
  for (let i = 0; i < old.getCount(); i++) positions.set(old.getElement(i, []), i * 3);
  const inverse = new Matrix4().fromArray(node.getWorldMatrix()).invert();
  for (const [index, x, y, z] of row.fixes) {
    const p = new Vector3(x, z, -y).applyMatrix4(inverse);
    positions.set(p.toArray(), index * 3); corrected++;
  }
  const position = doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(old.getBuffer());
  primitive.setAttribute('POSITION', position);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(Array.from(primitive.getIndices().getArray()));
  geometry.computeVertexNormals();
  primitive.setAttribute('NORMAL', doc.createAccessor().setType('VEC3')
    .setArray(geometry.attributes.normal.array).setBuffer(old.getBuffer()));
  const uv = primitive.getAttribute('TEXCOORD_0');
  if (uv) {
    const values = new Float32Array(uv.getCount() * 2);
    for (let i = 0; i < uv.getCount(); i++) values.set(uv.getElement(i, []), i * 2);
    geometry.setAttribute('uv', new BufferAttribute(values, 2));
    geometry.computeTangents();
    primitive.setAttribute('TANGENT', doc.createAccessor().setType('VEC4')
      .setArray(geometry.attributes.tangent.array).setBuffer(old.getBuffer()));
  }
  node.setExtras({ ...node.getExtras(), runtimeEnvelopeFit: 1 });
  geometry.dispose();
}
const bytes = await io.writeBinary(doc);
const validation = await validator.validateBytes(bytes);
assert.equal(validation.issues.numErrors, 0, JSON.stringify(validation.issues.messages));
await writeFile(path, bytes);
await writeFile('artwork/anatomy/containment-verification.json', JSON.stringify({
  correctedVertices: corrected, correctedPrimitives: fixes.length, errors: validation.issues.numErrors,
  clearance: .035, source: 'Actual exported exterior, closest-surface inset; ocular openings excluded',
}, null, 2));
console.log(`Inset ${corrected} vertices across ${fixes.length} primitives; glTF validation passed.`);
