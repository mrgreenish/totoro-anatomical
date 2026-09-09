// Apply world-space corrections measured against the actual exported coat.
// Coordinate tuples in the report use Blender's Z-up convention.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { Matrix4, Matrix3, Vector3, BufferGeometry, BufferAttribute } from 'three';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as validator from 'gltf-validator';
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder,
});
const path = 'public/models/totoro-anatomy.glb';
const doc = await io.read(path);
const authored = await io.read('artwork/anatomy/anatomy-raw.glb');
const fixes = JSON.parse(await readFile('artwork/anatomy/containment-fixes.json', 'utf8'));
let corrected = 0;
for (const row of fixes) {
  const node = doc.getRoot().listNodes()[row.ni];
  assert.equal(node.getExtras().partId ?? node.getName(), row.name, 'Correction must match its original part');
  const primitive = node.getMesh().listPrimitives()[row.pi];
  // Start each affected primitive from its authored geometry. Repeated runs
  // remain stable even when compression has reordered the runtime vertices.
  const sourceNode = authored.getRoot().listNodes().find(n => n.getExtras().partId === row.name);
  const source = sourceNode.getMesh().listPrimitives()[row.pi];
  assert.equal(source.getMaterial().getName(), primitive.getMaterial().getName());
  const transform = new Matrix4().fromArray(node.getWorldMatrix()).invert()
    .multiply(new Matrix4().fromArray(sourceNode.getWorldMatrix()));
  const normalTransform = new Matrix3().getNormalMatrix(transform);
  const buffer = doc.getRoot().listBuffers()[0];
  for (const semantic of source.listSemantics()) {
    const a = source.getAttribute(semantic), size = a.getElementSize();
    const values = new Float32Array(a.getCount() * size);
    for (let i = 0; i < a.getCount(); i++) {
      const element = a.getElement(i, []);
      if (semantic === 'POSITION') new Vector3().fromArray(element).applyMatrix4(transform).toArray(element);
      if (semantic === 'NORMAL') new Vector3().fromArray(element).applyNormalMatrix(normalTransform).toArray(element);
      values.set(element, i * size);
    }
    primitive.setAttribute(semantic, doc.createAccessor().setType(a.getType()).setArray(values).setBuffer(buffer));
  }
  primitive.setIndices(doc.createAccessor().setType('SCALAR')
    .setArray(new Uint32Array(source.getIndices().getArray())).setBuffer(buffer));
  const old = primitive.getAttribute('POSITION');
  // Float coordinates prevent the old quantized bounding box from clamping an inset.
  const positions = new Float32Array(old.getCount() * 3);
  for (let i = 0; i < old.getCount(); i++) positions.set(old.getElement(i, []), i * 3);
  const inverse = new Matrix4().fromArray(node.getWorldMatrix()).invert();
  const world = new Matrix4().fromArray(node.getWorldMatrix());
  // Compression may reorder vertices. Match source positions, never stale indices.
  const targets = row.fixes.map(([, x, y, z, sx, sy, sz]) => ({
    source: new Vector3(sx, sz, -sy), target: new Vector3(x, z, -y).applyMatrix4(inverse),
  }));
  for (let index = 0; index < positions.length / 3; index++) {
    const original = new Vector3().fromArray(positions, index * 3).applyMatrix4(world);
    const match = targets.find(f => original.distanceToSquared(f.source) < 1e-8);
    if (match) { positions.set(match.target.toArray(), index * 3); corrected++; }
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
await doc.transform(prune({ keepExtras: true }));
const bytes = await io.writeBinary(doc);
const validation = await validator.validateBytes(bytes);
assert.equal(validation.issues.numErrors, 0, JSON.stringify(validation.issues.messages));
await writeFile(path, bytes);
await writeFile('artwork/anatomy/containment-verification.json', JSON.stringify({
  correctedVertices: corrected, correctedPrimitives: fixes.length, errors: validation.issues.numErrors,
  clearance: .035, source: 'Actual exported exterior, closest-surface inset; ocular openings excluded',
}, null, 2));
console.log(`Inset ${corrected} vertices across ${fixes.length} primitives; glTF validation passed.`);
