import * as THREE from 'three';

const localBounds = new THREE.Box3();
const inverse = new THREE.Matrix4();
const padding = 1e-4;

/** Bound a section quad to its tissue without moving its texture coordinates. */
export function fitSectionCap(cap: THREE.Mesh<THREE.PlaneGeometry>, worldBounds: THREE.Box3) {
  cap.updateMatrix();
  localBounds.copy(worldBounds).applyMatrix4(inverse.copy(cap.matrix).invert());
  const left = localBounds.min.x - padding, right = localBounds.max.x + padding;
  const bottom = localBounds.min.y - padding, top = localBounds.max.y + padding;
  const position = cap.geometry.getAttribute('position') as THREE.BufferAttribute;
  // Keep the plane's origin, orientation and local XY in world units: the
  // cellular section shader must sample exactly the same tissue coordinates.
  position.setXYZ(0, left, top, 0);
  position.setXYZ(1, right, top, 0);
  position.setXYZ(2, left, bottom, 0);
  position.setXYZ(3, right, bottom, 0);
  position.needsUpdate = true;
}
