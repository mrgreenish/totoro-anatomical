import assert from 'node:assert/strict';
import * as THREE from 'three';
import { moduleURLFor } from './load-typescript.mjs';

const { fitSectionCap } = await import(await moduleURLFor('lib/section-cap.ts'));
const cap = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
const forward = new THREE.Vector3(0, 0, 1), point = new THREE.Vector3();
let checks = 0;
for (const axis of ['x', 'y', 'z']) for (const flipped of [false, true]) {
  for (const scale of [.001, .1, 1, 6]) {
    const bounds = new THREE.Box3(new THREE.Vector3(-.2, 2.4, -.3), new THREE.Vector3(-.1, 2.6, .2));
    bounds.min.multiplyScalar(scale); bounds.max.multiplyScalar(scale);
    const normal = new THREE.Vector3(); normal[axis] = flipped ? 1 : -1;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, bounds.getCenter(point));
    cap.position.copy(normal).multiplyScalar(-plane.constant);
    cap.quaternion.setFromUnitVectors(forward, normal.clone().negate());
    fitSectionCap(cap, bounds);
    cap.updateMatrixWorld(true);
    const position = cap.geometry.getAttribute('position');
    const left = position.getX(0), right = position.getX(1), top = position.getY(0), bottom = position.getY(2);
    assert(right > left && top > bottom, 'Even thin sections have a finite, nonempty quad');
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(cap.matrixWorld);
      assert(Math.abs(plane.distanceToPoint(point)) < 1e-5, 'Cap remains on the exact cutting plane');
    }
    // Sample the actual box/plane intersection, including all four edges.
    const inPlane = ['x', 'y', 'z'].filter(a => a !== axis);
    for (const a of [0, .5, 1]) for (const b of [0, .5, 1]) {
      bounds.getCenter(point);
      point[inPlane[0]] = THREE.MathUtils.lerp(bounds.min[inPlane[0]], bounds.max[inPlane[0]], a);
      point[inPlane[1]] = THREE.MathUtils.lerp(bounds.min[inPlane[1]], bounds.max[inPlane[1]], b);
      cap.worldToLocal(point);
      assert(point.x >= left && point.x <= right && point.y >= bottom && point.y <= top, 'Every section point remains covered');
      // Keeping the transform and local XY unchanged preserves the cellular
      // shader's inputs; resizing the mesh itself would stretch that texture.
      assert.equal(cap.scale.x, 1); assert.equal(cap.scale.y, 1);
    }
    assert((right - left) * (top - bottom) < 400 / 20, 'Section avoids the old 20 × 20 surface');
    checks++;
  }
}
cap.geometry.dispose(); cap.material.dispose();
console.log(`Section caps: ${checks} axis, reversal and tissue-size combinations preserve coverage and texture coordinates.`);
