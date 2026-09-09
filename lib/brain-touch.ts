import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const TOUCH_SLOTS = 3;
export const TOUCH_RADIUS = .29;
export const MAX_TISSUE_PULL = .19;

/** Small overlapping Kelvin–Voigt-style spring handles, in scene coordinates. */
export function createTissueSprings() {
  const centers = Array.from({ length: TOUCH_SLOTS }, () => new THREE.Vector3());
  const offsets = Array.from({ length: TOUCH_SLOTS }, () => new THREE.Vector3());
  const velocities = Array.from({ length: TOUCH_SLOTS }, () => new THREE.Vector3());
  const targets = Array.from({ length: TOUCH_SLOTS }, () => new THREE.Vector3());
  const age = new Uint32Array(TOUCH_SLOTS);
  let sequence = 0;
  function grab(point: THREE.Vector3) {
    let index = 0;
    for (let i = 1; i < TOUCH_SLOTS; i++) if (age[i] < age[index]) index = i;
    age[index] = ++sequence; centers[index].copy(point);
    offsets[index].set(0, 0, 0); velocities[index].set(0, 0, 0); targets[index].set(0, 0, 0);
    return index;
  }
  return {
    centers, offsets, velocities, targets, grab,
    setTarget(index: number, value: THREE.Vector3) { targets[index].copy(value).clampLength(0, MAX_TISSUE_PULL); },
    release(index: number) { targets[index].set(0, 0, 0); },
    reset() {
      offsets.forEach(v => v.set(0, 0, 0)); velocities.forEach(v => v.set(0, 0, 0)); targets.forEach(v => v.set(0, 0, 0));
    },
    update(dt: number, reduced: boolean) {
      // Bounded substeps preserve the same soft response across refresh rates.
      const steps = Math.max(1, Math.ceil(Math.min(dt, .08) / (1 / 240)));
      const h = Math.min(Math.max(dt, 0), .08) / steps;
      let moving = false;
      for (let i = 0; i < TOUCH_SLOTS; i++) {
        const x = offsets[i], v = velocities[i], target = targets[i];
        for (let step = 0; step < steps; step++) {
          const stiffness = reduced ? 220 : 115, damping = reduced ? 31 : 10.8;
          v.x += ((target.x - x.x) * stiffness - v.x * damping) * h;
          v.y += ((target.y - x.y) * stiffness - v.y * damping) * h;
          v.z += ((target.z - x.z) * stiffness - v.z * damping) * h;
          x.addScaledVector(v, h);
        }
        if (x.distanceToSquared(target) < 1e-9 && v.lengthSq() < 1e-8) { x.copy(target); v.set(0, 0, 0); }
        else moving = true;
      }
      return moving;
    },
  };
}

/** The same world-space field drives tissue, vessels, neural paths and shadows. */
export const TOUCH_GLSL = `
  uniform vec3 tissueTouchCenters[3];
  uniform vec3 tissueTouchOffsets[3];
  vec3 softTissuePosition(vec3 p) {
    for (int i=0; i<3; i++) {
      vec3 delta=p-tissueTouchCenters[i];
      float weight=exp(-dot(delta,delta)/.0841);
      p+=tissueTouchOffsets[i]*weight;
    }
    return p;
  }
  vec3 softTissueNormal(vec3 p, vec3 n) {
    for (int i=0; i<3; i++) {
      vec3 delta=p-tissueTouchCenters[i];
      float weight=exp(-dot(delta,delta)/.0841);
      vec3 gradient=-2.0*delta*weight/.0841;
      vec3 offset=tissueTouchOffsets[i];
      n=normalize(n-gradient*dot(offset,n)/max(.25,1.0+dot(gradient,offset)));
      p+=offset*weight;
    }
    return n;
  }
`;

type Shader = { uniforms: Record<string, THREE.IUniform>; vertexShader: string };
export function applyTissueTouch(shader: Shader, springs: ReturnType<typeof createTissueSprings>) {
  shader.uniforms.tissueTouchCenters = { value: springs.centers };
  shader.uniforms.tissueTouchOffsets = { value: springs.offsets };
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${TOUCH_GLSL}`)
    .replace('#include <defaultnormal_vertex>', `
      #include <defaultnormal_vertex>
      vec3 touchPosition=(modelMatrix*vec4(position,1.0)).xyz;
      vec3 touchNormal=inverseTransformDirection(transformedNormal,viewMatrix);
      transformedNormal=transformDirection(softTissueNormal(touchPosition,touchNormal),viewMatrix);
    `).replace('#include <project_vertex>', `
      vec4 touchWorld=modelMatrix*vec4(transformed,1.0);
      vec4 mvPosition=viewMatrix*vec4(softTissuePosition(touchWorld.xyz),1.0);
      gl_Position=projectionMatrix*mvPosition;
    `).replace('#include <worldpos_vertex>', `
      #if defined(USE_ENVMAP) || defined(DISTANCE) || defined(USE_SHADOWMAP) || defined(USE_TRANSMISSION) || NUM_SPOT_LIGHT_COORDS > 0
        vec4 worldPosition=vec4(softTissuePosition((modelMatrix*vec4(transformed,1.0)).xyz),1.0);
      #endif
    `);
}

type Options = {
  canvas: HTMLCanvasElement; camera: THREE.PerspectiveCamera; controls: OrbitControls;
  root: THREE.Group; wake(): void; reduced: boolean;
};
export function createBrainTouch(o: Options) {
  const springs = createTissueSprings();
  const pointer = new THREE.Vector2(), ray = new THREE.Raycaster(), plane = new THREE.Plane();
  const normalMatrix = new THREE.Matrix3();
  const point = new THREE.Vector3(), target = new THREE.Vector3(), view = new THREE.Vector3();
  let enabled = false;
  let drag: { id: number; slot: number; start: THREE.Vector3; normal: THREE.Vector3; x: number; y: number; controlsEnabled: boolean } | undefined;
  function aim(event: PointerEvent) {
    const r = o.canvas.getBoundingClientRect();
    pointer.set((event.clientX-r.left)/r.width*2-1, -(event.clientY-r.top)/r.height*2+1);
    o.camera.updateMatrixWorld(true); ray.setFromCamera(pointer, o.camera);
  }
  function end(event?: PointerEvent) {
    if (!drag || event && event.pointerId !== drag.id) return;
    const previous = drag; drag = undefined;
    springs.release(previous.slot); o.controls.enabled = previous.controlsEnabled;
    if (o.canvas.hasPointerCapture?.(previous.id)) o.canvas.releasePointerCapture(previous.id);
    o.canvas.classList.remove('is-tissue-grabbed'); o.wake();
  }
  function down(event: PointerEvent) {
    if (!enabled || event.button !== 0) return;
    // Leave two-finger pinch gestures to OrbitControls instead of trapping them.
    if (drag && event.pointerId !== drag.id) { end(); return; }
    if (!event.isPrimary || event.altKey) return;
    aim(event); o.root.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    o.root.traverse(node => {
      if (node instanceof THREE.Mesh && (node.material as THREE.MeshStandardMaterial).map) meshes.push(node);
    });
    const hit = ray.intersectObjects(meshes, false)[0];
    if (!hit?.face) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const normal = hit.face.normal.clone().applyNormalMatrix(normalMatrix.getNormalMatrix(hit.object.matrixWorld));
    if (normal.dot(ray.ray.direction) > 0) normal.negate();
    // Clear any prior orbit inertia before holding the camera still.
    const cameraPosition=o.camera.position.clone(), cameraTarget=o.controls.target.clone(), damping=o.controls.enableDamping;
    o.controls.enableDamping=false; o.controls.update?.();o.controls.enableDamping=damping;
    o.camera.position.copy(cameraPosition);o.controls.target.copy(cameraTarget);
    const slot = springs.grab(hit.point);
    drag={id:event.pointerId,slot,start:hit.point.clone(),normal,x:event.clientX,y:event.clientY,controlsEnabled:o.controls.enabled};
    o.controls.enabled=false; o.camera.getWorldDirection(view);
    plane.setFromNormalAndCoplanarPoint(view,hit.point);
    target.copy(normal).multiplyScalar(-.068 * (event.pointerType === 'pen' ? .65 + event.pressure * .7 : 1));
    springs.setTarget(slot,target);
    o.canvas.setPointerCapture(event.pointerId);o.canvas.classList.add('is-tissue-grabbed');o.wake();
  }
  function move(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    event.preventDefault();event.stopImmediatePropagation();aim(event);
    if (!ray.ray.intersectPlane(plane, point)) return;
    const travel=Math.hypot(event.clientX-drag.x,event.clientY-drag.y);
    const pull=THREE.MathUtils.smoothstep(travel,3,35);
    target.copy(point).sub(drag.start).multiplyScalar(.75);
    target.addScaledVector(drag.normal,THREE.MathUtils.lerp(-.068,.055,pull));
    springs.setTarget(drag.slot,target);o.wake();
  }
  function up(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    // A quick tap can begin and end between animation frames. Give it a small
    // impulse so it still makes a tactile dent instead of disappearing.
    if (event.type === 'pointerup' && Math.hypot(event.clientX-drag.x,event.clientY-drag.y) < 4 && springs.offsets[drag.slot].length() < .025) {
      springs.velocities[drag.slot].addScaledVector(drag.normal,-.85);
    }
    event.preventDefault();event.stopImmediatePropagation();end(event);
  }
  const cancel = () => { end(); springs.reset(); };
  const visibility = () => { if (document.hidden) cancel(); };
  const capture = { capture:true };
  o.canvas.addEventListener('pointerdown',down,capture);o.canvas.addEventListener('pointermove',move,capture);
  o.canvas.addEventListener('pointerup',up,capture);o.canvas.addEventListener('pointercancel',up,capture);
  o.canvas.addEventListener('lostpointercapture',end);
  window.addEventListener?.('blur',cancel);document.addEventListener?.('visibilitychange',visibility);
  return {
    springs,
    setEnabled(value: boolean) { enabled=value; if (!value) cancel();o.canvas.classList.toggle('is-touchable-brain',value); },
    update(dt: number) { return springs.update(dt,o.reduced); },
    dispose() {
      enabled=false;cancel();o.canvas.classList.remove('is-touchable-brain');
      o.canvas.removeEventListener('pointerdown',down,capture);o.canvas.removeEventListener('pointermove',move,capture);
      o.canvas.removeEventListener('pointerup',up,capture);o.canvas.removeEventListener('pointercancel',up,capture);
      o.canvas.removeEventListener('lostpointercapture',end);
      window.removeEventListener?.('blur',cancel);document.removeEventListener?.('visibilitychange',visibility);
    },
  };
}
