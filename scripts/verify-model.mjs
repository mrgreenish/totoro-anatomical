// Verify the actual compressed model with the same decoder used by the gallery.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Box3, Group, PerspectiveCamera, Raycaster, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const bytes = await readFile('public/models/totoro.glb');
const { scene } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  .parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
scene.updateMatrixWorld(true);
const required = ['Body', 'Cream_belly', 'Nose', 'Mouth_inset', 'Belly_chevrons',
  'Whiskers', 'Ear_L', 'Ear_R', 'Arm_L', 'Arm_R', 'Foot_L', 'Foot_R', 'Tail',
  'Leaf', 'Eye_L', 'Eye_R', 'Pupil_L', 'Pupil_R', 'Eye_catchlights',
  ...Array.from({ length: 10 }, (_, i) => `Tooth_${String(i + 1).padStart(2, '0')}`)];
for (const name of required) assert(scene.getObjectByName(name), `Missing part: ${name}`);

let triangles = 0, meshDraws = 0;
const parts = [];
scene.traverse(object => {
  if (!object.isMesh) return;
  meshDraws++;
  const positions = object.geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    assert([positions.getX(i), positions.getY(i), positions.getZ(i)].every(Number.isFinite), `Invalid vertex: ${object.name}`);
  }
  const count = (object.geometry.index?.count ?? positions.count) / 3;
  triangles += count;
  parts.push({ name: object.name, parent: object.parent.name, triangles: count });
});
// The denser opaque groom trades geometry for fur detail without alpha overdraw.
assert(triangles < 500000, 'Model exceeds the intended real-time geometry budget');
assert(bytes.length < 6800000, 'Compressed model exceeds its transfer budget');

const bodyColor = scene.getObjectByName('Body').material.color;
const bellyColor = scene.getObjectByName('Cream_belly').material.color;
assert(bellyColor.r > bodyColor.r * 3 && bellyColor.b > bodyColor.b * 2, 'Ivory belly has lost its contrast');
let fiberTriangles = 0;
scene.traverse(object => {
  if (!object.isMesh || !object.name.includes('fibers')) return;
  assert(object.geometry.hasAttribute('color'), `Missing strand colors: ${object.name}`);
  fiberTriangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
});
assert(fiberTriangles > 150000, 'Dense groom was lost during export');

const bounds = new Box3().setFromObject(scene);
const size = bounds.getSize(new Vector3());
assert(size.x > 3.7 && size.x < 4.2 && size.y > 4.8 && size.y < 5.2 && size.z > 2.5 && size.z < 3.4, 'Unexpected sculpture bounds');

// Teeth must actually be exposed on the front surface, not buried in the body.
const rays = new Raycaster();
const teeth = [];
for (let i = 1; i <= 10; i++) {
  const tooth = scene.getObjectByName(`Tooth_${String(i).padStart(2, '0')}`);
  const toothBounds = new Box3().setFromObject(tooth);
  const center = toothBounds.getCenter(new Vector3());
  rays.set(new Vector3(center.x, center.y, 6), new Vector3(0, 0, -1));
  const hit = rays.intersectObject(scene, true)[0];
  assert.equal(hit?.object, tooth, `Tooth ${i} is occluded from the front`);
  const toothSize = toothBounds.getSize(new Vector3());
  assert(toothSize.z > .025, `Tooth ${i} has no curved depth`);
  if (i === 5 || i === 6) assert(toothSize.y > .30, 'Central teeth are too small');
  teeth.push({ name: tooth.name, dimensions: toothSize.toArray(), exposed: true });
}

// The animated nodes must carry their detail geometry when the gallery pivots them.
const attachments = [];
const paws = [];
for (const side of ['L', 'R']) {
  const foot = scene.getObjectByName(`Foot_${side}`);
  const toe = scene.getObjectByName(`Toe_${side}_claws`);
  assert.equal(toe?.parent, foot, 'Toe claws must belong to their paw');
  assert.equal(scene.getObjectByName(`Foot_${side}_fibers`)?.parent, foot, 'Paw fur is detached');
  const footBounds = new Box3().setFromObject(foot);
  const footSize = footBounds.getSize(new Vector3());
  assert(footBounds.min.y > .018 && footBounds.min.y < .032, 'Paw sole is not planted');
  assert(footSize.x > .70 && footSize.x < .86, 'Paw reverted to a wide slipper');
  assert(footSize.y > .48 && footSize.y < .65, 'Missing raised instep');
  assert(new Box3().setFromObject(toe).intersectsBox(footBounds), 'Toes float ahead of paws');
  paws.push({ side, dimensions: footSize.toArray(), soleHeight: footBounds.min.y, attachedClaws: true });
  const arm = scene.getObjectByName(`Arm_${side}`);
  const claw = scene.getObjectByName(`Hand_${side}_claws`);
  const fibers = scene.getObjectByName(`Arm_${side}_fibers`);
  assert.equal(claw.parent, arm, 'Hand claws detach from animated arm');
  assert.equal(fibers.parent, arm, 'Arm fur detaches during animation');
  const before = claw.getWorldPosition(new Vector3());
  const rotation = arm.rotation.z;
  arm.rotation.z += .08;
  scene.updateMatrixWorld(true);
  assert(claw.getWorldPosition(new Vector3()).distanceTo(before) > .01, 'Claws do not follow arm rotation');
  arm.rotation.z = rotation;
  assert.equal(scene.getObjectByName(`Ear_${side}_fibers`).parent, scene.getObjectByName(`Ear_${side}`));
  attachments.push({ side, clawsFollowArm: true, furFollowsAppendages: true });
}
scene.updateMatrixWorld(true);

// Reproduce the viewer's stationary paw hierarchy at the largest spring lean.
const stage = new Group(); stage.add(scene); stage.updateMatrixWorld(true);
const fixedPaws = ['L', 'R'].map(side => scene.getObjectByName(`Foot_${side}`));
for (const foot of fixedPaws) stage.attach(foot);
const restingPaws = fixedPaws.map(foot => new Box3().setFromObject(foot));
scene.rotation.set(.035, .17, .045); stage.updateMatrixWorld(true);
for (const [index, foot] of fixedPaws.entries()) {
  const moved = new Box3().setFromObject(foot);
  assert(moved.min.distanceTo(restingPaws[index].min) < .000001 && moved.max.distanceTo(restingPaws[index].max) < .000001,
    'Body inertia moves a planted paw');
  assert(moved.intersectsBox(new Box3().setFromObject(scene.getObjectByName('Body'))), 'Body inertia detaches the haunch from a paw');
}
scene.rotation.set(0, 0, 0);
for (const foot of fixedPaws) scene.attach(foot);
scene.updateMatrixWorld(true);

// Initial gallery framing must include the silhouette at desktop and mobile aspects.
for (const aspect of [1.8, .9]) {
  const camera = new PerspectiveCamera(30, aspect, .1, 60);
  camera.position.set(3.5, 4.0, 12.4);
  camera.lookAt(0, 2.3, 0);
  camera.updateMatrixWorld(true);
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const projected = new Vector3(x, y, z).project(camera);
        assert(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1, `Initial view clips at aspect ${aspect}`);
      }
    }
  }
}

const report = { passed: true, sha256: createHash('sha256').update(bytes).digest('hex'),
  compressedBytes: bytes.length, triangles, meshDraws, bounds: size.toArray(),
  requiredParts: required, teeth, attachments, paws, fiberTriangles, parts,
  scope: 'Compressed glTF decoding, finite geometry, exposed curved teeth, animation attachment transforms and initial camera framing. GPU browser interaction is not covered.' };
await writeFile('artwork/model-verification.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, triangles, meshDraws, compressedBytes: bytes.length, visibleTeeth: teeth.length, attachments }, null, 2));
