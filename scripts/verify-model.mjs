// Verify the actual compressed model with the same decoder used by the gallery.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Box3, DoubleSide, FrontSide, Group, PerspectiveCamera, Quaternion, Raycaster, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const bytes = await readFile('public/models/totoro.glb');
const { scene } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  .parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
scene.updateMatrixWorld(true);
// Match the gallery's material-side policy; Blender renders both sides by default.
scene.traverse(object => {
  if (object.isMesh && /Fur|Belly|Seven chevrons/.test(object.material.name))
    object.material.side=object.name.includes('fibers') ? DoubleSide : FrontSide;
});
const required = ['Body', 'Cream_belly', 'Nose', 'Mouth_inset', 'Belly_chevrons',
  'Whiskers', 'Ear_L', 'Ear_R', 'Arm_L', 'Arm_R', 'Foot_L', 'Foot_R', 'Tail',
  'Leaf', 'Eye_L', 'Eye_R', 'Pupil_L', 'Pupil_R', 'Eye_catchlights',
  'Eyelids_L', 'Eyelids_R', 'MotionRoot', 'Breath', 'TailSway', 'ArmSwing_L', 'ArmSwing_R', 'EarBend_L', 'EarBend_R',
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
assert(triangles < 345000, 'Refinement lost its geometry reduction');
assert(bytes.length < 5300000, 'Refinement lost its transfer reduction');

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
const markings=scene.getObjectByName('Belly_chevrons');
for (const [x,y] of [[-.56,2.50],[0,2.50],[.56,2.50],[-.81,2.09],[-.275,2.09],[.275,2.09],[.81,2.09]]) {
  rays.set(new Vector3(x,y,6),new Vector3(0,0,-1));
  const hit=rays.intersectObject(scene,true).find(h=>!h.object.name.includes('fibers'));
  assert.equal(hit?.object.name,markings.name,'A belly marking is hidden or facing inward');
}
const teeth = [];
for (let i = 1; i <= 10; i++) {
  const tooth = scene.getObjectByName(`Tooth_${String(i).padStart(2, '0')}`);
  const toothBounds = new Box3().setFromObject(tooth);
  const center = toothBounds.getCenter(new Vector3());
  rays.set(new Vector3(center.x, center.y, 6), new Vector3(0, 0, -1));
  const hit = rays.intersectObject(scene, true)[0];
  assert.equal(hit?.object?.name, tooth.name, `Tooth ${i} is occluded from the front`);
  const toothSize = toothBounds.getSize(new Vector3());
  assert(toothSize.z > .025, `Tooth ${i} has no curved depth`);
  if (i === 5 || i === 6) assert(toothSize.y > .30, 'Central teeth are too small');
  teeth.push({ name: tooth.name, dimensions: toothSize.toArray(), exposed: true });
}

function updateSkeletons() {
  scene.updateMatrixWorld(true);
  scene.traverse(o => { if (o.isSkinnedMesh) { o.skeleton.update(); o.computeBoundingBox(); o.computeBoundingSphere(); } });
}
function vertexWorld(mesh, index) { return mesh.getVertexPosition(index, new Vector3()).applyMatrix4(mesh.matrixWorld); }
function assertUsesBone(mesh, bone) {
  assert(mesh?.isSkinnedMesh, `${mesh?.name} has no deformation skin`);
  const indices = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
  const joint = mesh.skeleton.bones.findIndex(b => b.name === bone);
  assert(joint >= 0, `Missing bone ${bone}`);
  let affected = 0;
  for (let i = 0; i < indices.count; i++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) { const w = weights.getComponent(i, k); sum += w; if (indices.getComponent(i,k) === joint && w > .01) affected++; }
    assert(Math.abs(sum - 1) < .002, `Unnormalized skin weights on ${mesh.name}`);
  }
  assert(affected > 0, `${mesh.name} is not driven by ${bone}`);
}
updateSkeletons();
// Skinning must deform claws and fur with their limb; parent pointers alone no longer prove this.
const attachments = [];
const paws = [];
for (const side of ['L', 'R']) {
  const foot = scene.getObjectByName(`Foot_${side}`);
  const toe = scene.getObjectByName(`Toe_${side}_claws`);
  assert.equal(toe?.parent?.name, foot.name, 'Toe claws must belong to their paw');
  assert.equal(scene.getObjectByName(`Foot_${side}_fibers`)?.parent?.name, foot.name, 'Paw fur is detached');
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
  for (const mesh of [arm,claw,fibers]) assertUsesBone(mesh, `ArmSwing_${side}`);
  const bone = scene.getObjectByName(`ArmSwing_${side}`), rest = bone.quaternion.clone();
  const before = vertexWorld(claw,0);
  bone.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),.08));
  updateSkeletons();
  assert(vertexWorld(claw,0).distanceTo(before) > .02, 'Claws do not follow the arm bone');
  bone.quaternion.copy(rest);updateSkeletons();
  for (const name of [`Ear_${side}`,`Ear_${side}_fibers`]) assertUsesBone(scene.getObjectByName(name),`EarBend_${side}`);
  attachments.push({ side, clawsFollowArm: true, furFollowsAppendages: true });
}
const lids = [];
// Front rays through a pupil must switch from the pupil to skin when it closes.
for (const side of ['L','R']) {
  const lid=scene.getObjectByName(`Eyelids_${side}`), pupil=scene.getObjectByName(`Pupil_${side}`);
  const index=lid.morphTargetDictionary?.Blink;
  assert(index !== undefined && lid.morphTargetInfluences[index] === 0, 'Missing or closed rest eyelid');
  const center=new Box3().setFromObject(pupil).getCenter(new Vector3());
  const pupilScale=pupil.scale.clone();
  const visible=[];
  for (const value of [0,.5,1]) {
    lid.morphTargetInfluences[index]=value;
    rays.set(new Vector3(center.x,center.y,6),new Vector3(0,0,-1));
    const hit=rays.intersectObject(scene,true)[0];
    visible.push(hit?.object.name);
    if (value === 0) assert(/Pupil|catchlight/.test(hit?.object.name), 'Open eyelid obscures pupil');
    if (value === 1) assert.equal(hit?.object?.name,lid.name,'Closed eyelid does not cover pupil');
  }
  assert(pupil.scale.equals(pupilScale),'Blink squashes the pupil');
  lid.morphTargetInfluences[index]=0;lids.push({side,visible,eyeVolumePreserved:true});
}
for (const name of ['Body','Cream_belly','Fine_grey_fibers','Fine_ivory_fibers','Belly_chevrons','Chevron_fibers']) assertUsesBone(scene.getObjectByName(name),'Breath');
const breath=scene.getObjectByName('Breath');
const beforeBreath=new Box3().setFromObject(scene.getObjectByName('Body')).getSize(new Vector3());
breath.scale.set(1.013,1.004,1.016);updateSkeletons();
const afterBreath=new Box3().setFromObject(scene.getObjectByName('Body')).getSize(new Vector3());
assert(afterBreath.x > beforeBreath.x+.015,'Breathing does not deform the torso');
breath.scale.set(1,1,1);updateSkeletons();
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
  requiredParts: required, teeth, attachments, paws, eyelids:lids, fiberTriangles, parts,
  scope: 'Compressed glTF decoding, finite geometry, skin weights and deformed attachments, eyelid occlusion, breathing, planted paws, exposed curved teeth and initial camera framing. Browser checks are recorded separately.' };
await writeFile('artwork/model-verification.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, triangles, meshDraws, compressedBytes: bytes.length, visibleTeeth: teeth.length, attachments }, null, 2));
