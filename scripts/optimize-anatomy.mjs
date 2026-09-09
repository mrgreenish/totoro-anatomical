import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, meshopt, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { readFile, writeFile } from 'node:fs/promises';
import validator from 'gltf-validator';

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});
const manifest = JSON.parse(await readFile('artwork/anatomy/manifest.json', 'utf8'));
const doc = await io.read('artwork/anatomy/anatomy-raw.glb');
for (const material of doc.getRoot().listMaterials()) {
  const data = manifest.materials[material.getName()];
  if (data?.texture) material.setBaseColorFactor([...data.tint, 1]);
}
await doc.transform(
  textureCompress({ encoder: sharp, slots: /^baseColorTexture$/, targetFormat: 'webp', resize: [1024, 1024], quality: 90 }),
  // Lossless WebP keeps every normal and roughness texel while making room
  // for the higher-resolution structural maps in the original 12 MB budget.
  textureCompress({ encoder: sharp, slots: /^(normalTexture|metallicRoughnessTexture)$/, targetFormat: 'webp', lossless: true }),
  dedup(), weld(), prune({ keepExtras: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write('public/models/totoro-anatomy.glb', doc);
const bytes = await readFile('public/models/totoro-anatomy.glb');
const validation = await validator.validateBytes(new Uint8Array(bytes), { uri: 'totoro-anatomy.glb' });
const report = { bytes: bytes.length, triangles: manifest.triangles, parts: manifest.parts.length,
  errors: validation.issues.numErrors, warnings: validation.issues.numWarnings, messages: validation.issues.messages };
await writeFile('artwork/anatomy/gltf-validation.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.errors || report.bytes > 12_000_000 || report.triangles > 500_000) process.exitCode = 1;
