import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { readFile, writeFile, stat } from 'node:fs/promises';
import validator from 'gltf-validator';

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder,
  'meshopt.decoder': MeshoptDecoder,
});
const document = await io.read('artwork/totoro-raw.glb');
await document.transform(dedup(), weld(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write('public/models/totoro.glb', document);
const bytes = await readFile('public/models/totoro.glb');
const result = await validator.validateBytes(new Uint8Array(bytes), { uri: 'totoro.glb' });
const report = {
  originalBytes: (await stat('artwork/totoro-raw.glb')).size,
  optimizedBytes: bytes.length,
  errors: result.issues.numErrors,
  warnings: result.issues.numWarnings,
  messages: result.issues.messages,
};
await writeFile('artwork/gltf-validation.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.errors) process.exitCode = 1;
