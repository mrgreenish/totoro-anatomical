import * as THREE from 'three';

const _point = new THREE.Vector3(), _projected = new THREE.Vector3(), _ndc = new THREE.Vector2();
const _origin = new THREE.Vector3(), _sphere = new THREE.Sphere();
export const BRAIN_VISIBILITY_SAMPLES = 8;

export function isBrainOccluder(mesh: THREE.Mesh) {
  return mesh.visible && !mesh.name.includes('fibers') && !mesh.userData.sectionCap;
}

/** Closest-hit probe that skips fur fibers and section caps. */
export function probeBrainVisibility(
  camera: THREE.Camera,
  brainMeshes: THREE.Mesh[], occluders: THREE.Mesh[], raycaster: THREE.Raycaster, clipPlane: THREE.Plane | null,
) {
  camera.getWorldPosition(_origin);
  for (const mesh of brainMeshes) {
    const positions = mesh.geometry.attributes.position;
    if (!positions) continue;
    const stride = Math.max(1, Math.floor(positions.count / BRAIN_VISIBILITY_SAMPLES));
    for (let i = 0; i < positions.count; i += stride) {
      _point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      if (clipPlane && clipPlane.distanceToPoint(_point) < -.001) continue;
      _projected.copy(_point).project(camera);
      if (Math.abs(_projected.x) > .94 || Math.abs(_projected.y) > .94 || Math.abs(_projected.z) > 1) continue;
      _ndc.set(_projected.x, _projected.y);
      raycaster.setFromCamera(_ndc, camera);
      const brainHit = firstUnclippedHit(raycaster.intersectObjects(brainMeshes, false), clipPlane);
      if (!brainHit) continue;
      const limit = brainHit.distance - 1e-4;
      let blocked = false;
      for (const other of occluders) {
        if (other === mesh || brainMeshes.includes(other) || !isBrainOccluder(other)) continue;
        if (!other.geometry.boundingSphere) other.geometry.computeBoundingSphere();
        _sphere.copy(other.geometry.boundingSphere!).applyMatrix4(other.matrixWorld);
        if (_origin.distanceTo(_sphere.center) - _sphere.radius > limit) continue;
        const hit = firstUnclippedHit(raycaster.intersectObject(other, false), clipPlane);
        if (hit && hit.distance < brainHit.distance) { blocked = true; break; }
      }
      if (!blocked) return true;
    }
  }
  return false;
}

function firstUnclippedHit(hits: THREE.Intersection[], clipPlane: THREE.Plane | null) {
  return clipPlane ? hits.find(h => clipPlane.distanceToPoint(h.point) >= -.0001) : hits[0];
}


/** Projected size with hysteresis; visibility is checked separately by raycast. */
export function brainProximity(size: number, visible: boolean, wasAvailable: boolean) {
  return visible && Number.isFinite(size) && size >= (wasAvailable ? .22 : .30);
}
