import assert from 'node:assert/strict';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder': MeshoptDecoder});
const coat = await io.read('public/models/totoro.glb');
const anatomy = await io.read('public/models/totoro-anatomy.glb');
const element = (a, i) => a.getElement(i, []);
const shells = [];
for (const node of coat.getRoot().listNodes().filter(n => ['Body', 'Arm_L', 'Arm_R'].includes(n.getName()))) {
  for (const primitive of node.getMesh().listPrimitives()) {
    const position = primitive.getAttribute('POSITION');
    const points = new Float32Array(position.getCount() * 3);
    for (let i = 0; i < position.getCount(); i++) {
      const point = new THREE.Vector3().fromArray(element(position, i));
      const skin = node.getSkin();
      if (skin) {
        const joints = primitive.getAttribute('JOINTS_0').getElement(i, []);
        const weights = primitive.getAttribute('WEIGHTS_0').getElement(i, []);
        const fitted = new THREE.Vector3();
        for (let j = 0; j < 4; j++) {
          const transform = new THREE.Matrix4().fromArray(skin.listJoints()[joints[j]].getWorldMatrix())
            .multiply(new THREE.Matrix4().fromArray(skin.getInverseBindMatrices().getElement(joints[j], [])));
          fitted.addScaledVector(point.clone().applyMatrix4(transform), weights[j]);
        }
        point.copy(fitted);
      } else point.applyMatrix4(new THREE.Matrix4().fromArray(node.getWorldMatrix()));
      points.set(point.toArray(), i * 3);
    }
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(points, 3));
    geometry.setIndex(Array.from(primitive.getIndices().getArray()));
    shells.push(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({side: THREE.DoubleSide})));
  }
}
const ray = new THREE.Raycaster();
for (const node of anatomy.getRoot().listNodes().filter(n => /^(latissimus|trapezius|erector|triceps)_/.test(n.getName()))) {
  let minimum = Infinity;
  let outside = 0;
  const matrix = new THREE.Matrix4().fromArray(node.getWorldMatrix());
  for (const primitive of node.getMesh().listPrimitives()) {
    const positions = primitive.getAttribute('POSITION');
    for (let i = 0; i < positions.getCount(); i++) {
      const point = new THREE.Vector3().fromArray(element(positions, i)).applyMatrix4(matrix);
      ray.set(new THREE.Vector3(point.x, point.y, -5), new THREE.Vector3(0, 0, 1));
      const hit = ray.intersectObjects(shells, false)[0];
      if (!hit) continue;
      const clearance = point.z - hit.point.z;
      minimum = Math.min(minimum, clearance);
      if (clearance < 0) outside++;
    }
  }
  console.log(node.getName(), {minimum, outside});
  if (process.argv.includes('--assert')) assert(Number.isFinite(minimum) && minimum >= (node.getName().startsWith('latissimus_') ? .035 : .015), `${node.getName()} must stay under the back of the coat`);
}
