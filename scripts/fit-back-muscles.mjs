// Keep both latissimus muscles beneath the rigged coat in its resting pose.
// The exported coat puts the right muscle up to 0.148 units outside its back.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import assert from 'node:assert/strict';
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder,
});
const path = 'public/models/totoro-anatomy.glb';
const doc = await io.read(path);
for (const id of ['latissimus_L', 'latissimus_R']) {
  const node = doc.getRoot().listNodes().find(n => n.getExtras().partId === id);
  assert(node, `Missing ${id}`);
  const extras = node.getExtras();
  const inset = .19;
  const translation = node.getTranslation();
  translation[2] += inset - (extras.backCoatInset ?? 0);
  node.setTranslation(translation).setExtras({...extras, backCoatInset: inset});
}
await io.write(path, doc);
console.log('Both latissimus muscles inset beneath the back of the coat.');
