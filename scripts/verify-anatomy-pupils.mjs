import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { moduleURLFor } from './load-typescript.mjs';

const { createAnatomyExplorer } = await import(await moduleURLFor('lib/totoro-anatomy.ts'));
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
class Element extends EventTarget {
  classList = { add() {}, remove() {}, toggle() {} };
  children = []; style = { setProperty() {} }; clientWidth = 1000; clientHeight = 750;
  appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
  setAttribute() {}
  setPointerCapture() {}
  remove() { this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 750 }; }
}
globalThis.window = { matchMedia: () => ({ matches: true }) };
// oxlint-disable-next-line typescript/no-deprecated
globalThis.document = { createElement: () => new Element() };
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 2, height: 2, close() {} });
const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, options) => typeof url === 'string' && url.startsWith('/models/')
  ? readFile('public' + url.split('?')[0]).then(bytes => new Response(bytes))
  : nativeFetch(url, options);

const canvas = new Element(); new Element().appendChild(canvas);
const scene = new THREE.Scene(), exterior = new THREE.Group(); scene.add(exterior);
const camera = new THREE.PerspectiveCamera(30, 4 / 3, .1, 80); camera.position.set(3.5, 4, 12.4);
const api = createAnatomyExplorer({ canvas, scene, exterior, camera,
  renderer: { capabilities: { getMaxAnisotropy: () => 8 } },
  controls: { target: new THREE.Vector3(0, 2.3, 0), enabled: true },
  signal: new AbortController().signal, wake() {} });
await api.setMode('split'); api.update(0, false);
check(api.state.status === 'ready', 'The shipped compressed anatomy asset loads');
const part = id => {
  let result; scene.getObjectByName('Totoro_anatomy').traverse(node => {
    if (node.userData.partId === id && node.userData.label) result ??= node;
  });
  assert.ok(result, `Asset contains ${id}`); return result;
};
const eyes = ['L', 'R'].map(side => ({ eye: part(`eye_${side}`), pupil: part(`pupil_${side}`) }));
const rest = eyes.map(({ pupil }) => pupil.position.clone());
const ray = new THREE.Raycaster(), center = new THREE.Vector3();
function pupilIsFrontmost({ eye, pupil }) {
  new THREE.Box3().setFromObject(pupil).getCenter(center);
  ray.set(center.clone().add(new THREE.Vector3(0, 0, 2)), new THREE.Vector3(0, 0, -1));
  const hits = ray.intersectObjects([eye, pupil], true).filter(hit => {
    for (let node = hit.object; node; node = node.parent) if (!node.visible) return false;
    const material = Array.isArray(hit.object.material)
      ? hit.object.material[hit.face.materialIndex] : hit.object.material;
    return !material.clippingPlanes?.some(plane => plane.distanceToPoint(hit.point) < -1e-8);
  });
  for (let node = hits[0]?.object; node; node = node.parent) if (node === pupil) return true;
  return false;
}
api.setCut({ axis: 'x', position: .9, flipped: false }); api.update(0, false);
for (const entry of eyes) {
  const eyeBox = new THREE.Box3().setFromObject(entry.eye), pupilBox = new THREE.Box3().setFromObject(entry.pupil);
  check(pupilIsFrontmost(entry), `${entry.pupil.name}: rays see the pupil before the opaque sclera`);
  check(pupilBox.min.z < eyeBox.max.z && pupilBox.max.z > eyeBox.max.z,
    `${entry.pupil.name}: the pupil stays embedded in the globe without a gap`);
}
for (const flipped of [false, true]) {
  api.setCut({ axis: 'x', position: .5, flipped }); api.update(0, false);
  check(pupilIsFrontmost(eyes[flipped ? 1 : 0]), 'The retained half shows its pupil');
  check(!pupilIsFrontmost(eyes[flipped ? 0 : 1]), 'The removed half clips its pupil');
}
// Cut through the corrected pupil itself: stencil volumes must follow its pose.
new THREE.Box3().setFromObject(eyes[0].pupil).getCenter(center);
const { CUT_BOUNDS } = await import(await moduleURLFor('lib/anatomy-state.ts'));
api.setCut({ axis: 'z', position: (center.z - CUT_BOUNDS.z[0]) / (CUT_BOUNDS.z[1] - CUT_BOUNDS.z[0]) });
api.update(0, false);
const pupilMeshes = []; eyes[0].pupil.traverse(node => { if (node.isMesh) pupilMeshes.push(node); });
for (const source of pupilMeshes) {
  const masks = []; scene.traverse(node => {
    if (node.isMesh && node.geometry === source.geometry && node.material.stencilWrite && !node.material.colorWrite) masks.push(node);
  });
  check(masks.filter(mask => mask.visible && mask.matrix.equals(source.matrixWorld)).length === 2,
    'Both section masks follow the corrected pupil at a cut through its surface');
}
await api.setMode('exploded');
for (const amount of [.65, 0, 1, 0]) {
  api.setExplosion(amount); api.update(0, false);
  for (const entry of eyes) check(pupilIsFrontmost(entry), 'Pupils stay on their eyeballs throughout separation and reassembly');
}
for (let i = 0; i < eyes.length; i++) check(eyes[i].pupil.position.equals(rest[i]), 'Reassembly restores the corrected rest pose exactly');
await api.setMode('exterior'); api.update(0, false);
check(eyes.every(({ pupil }) => !pupil.visible), 'Exterior mode hides the anatomy pupils');
await api.setMode('split'); api.setCut({ axis: 'x', position: .9, flipped: false }); api.update(0, false);
check(eyes.every(pupilIsFrontmost), 'Reopening Split preserves both visible pupils');
api.dispose();
console.log(`Anatomy pupil verification passed: ${checks} checks against the shipped GLB.`);
