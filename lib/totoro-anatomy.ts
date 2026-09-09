import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clamp01, cutCoordinate, CUT_BOUNDS, defaultAnatomyState, fitDistance, systemVisible } from './anatomy-state';
import type { AnatomyMode, AnatomyPart, AnatomyState, AnatomySystem } from './anatomy-state';

type Part = AnatomyPart & { node: THREE.Object3D; rest: THREE.Vector3; restScale: THREE.Vector3; offset: THREE.Vector3; meshes: THREE.Mesh[] };
// Textured glTF materials use a white color factor. Section faces need the
// underlying tissue color instead of that multiplier to avoid white cut walls.
const tissueSectionColors: Record<string, number> = {
  brain: 0xbc9180, brain_cortex: 0xcda093, myocardium: 0x8c3538, lungs: 0xb57076,
  liver: 0x74332e, stomach: 0xd79986, intestine: 0xd39480,
  kidney: 0x843b34, spleen: 0x69384d, glands: 0xc79b65,
  muscle: 0x873e35, cortical_bone: 0xcaba98, tendon: 0xd4c9af,
};
type Cap = { source: THREE.Mesh; part: Part; back: THREE.Mesh; front: THREE.Mesh; cap: THREE.Mesh; box: THREE.Box3 };
type Options = {
  canvas: HTMLCanvasElement; renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  controls: OrbitControls; exterior: THREE.Group; signal: AbortSignal; wake(): void;
  onState?(state: AnatomyState): void; onMode?(): void;
};

// Continuous object-space detail avoids atlas seams and follows the organ
// during explosion. Keep the baked cortical folds and their cavity shading.
function brainTissueMaterial(source: THREE.MeshStandardMaterial) {
  const material = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(material, source);
  Object.assign(material, { defines: { STANDARD: '', PHYSICAL: '' } });
  material.metalness = 0;
  material.roughness = .24;
  material.clearcoat = 1;
  material.clearcoatRoughness = .075;
  material.ior = 1.36;
  material.specularIntensity = .9;
  material.normalScale.set(.32, .32);
  material.envMapIntensity = 1.45;
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `
      #include <common>
      varying vec3 vBrainPosition;
    `).replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vBrainPosition = position;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      varying vec3 vBrainPosition;
      float tissueHash(vec3 p) {
        p = fract(p * .3183099 + vec3(.13, .27, .41));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float tissueNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(tissueHash(i), tissueHash(i + vec3(1,0,0)), f.x),
                       mix(tissueHash(i + vec3(0,1,0)), tissueHash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(tissueHash(i + vec3(0,0,1)), tissueHash(i + vec3(1,0,1)), f.x),
                       mix(tissueHash(i + vec3(0,1,1)), tissueHash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
    `).replace('#include <map_fragment>', `
      #include <map_fragment>
      vec3 tissueP = vBrainPosition;
      float tissueMottle = tissueNoise(tissueP * 24.0);
      float tissueFine = tissueNoise(tissueP * 155.0);
      float tissueMoisture = tissueNoise(tissueP * 38.0 + 7.0);
      float tissueShade = clamp(dot(diffuseColor.rgb, vec3(.2126,.7152,.0722)) / .40, .25, 1.16);
      vec3 tissueColor = mix(vec3(.39,.19,.18), vec3(.70,.43,.37), tissueMottle);
      tissueColor *= .92 + .16 * tissueFine;
      // Delicate, broken capillary traces beneath the pia membrane.
      vec3 vascularP = tissueP * 17.0 + vec3(tissueNoise(tissueP * 9.0) * 1.8);
      float vesselField = tissueNoise(vascularP);
      float vesselWidth = max(fwidth(vesselField), .003);
      float vessel = 1.0 - smoothstep(.009, .009 + vesselWidth, abs(vesselField - .49));
      vessel *= smoothstep(.48, .72, tissueNoise(tissueP * 8.0 + 19.0));
      tissueColor = mix(tissueColor, vec3(.29,.065,.075), vessel * .42);
      diffuseColor.rgb = tissueColor * tissueShade;
    `).replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      roughnessFactor = mix(.17, .30, tissueMoisture);
    `).replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      // Microscopic relief breaks up broad highlights without changing
      // the silhouette or section stencil geometry.
      float microRelief = tissueFine * .00014;
      vec3 tissueDx = dFdx(-vViewPosition), tissueDy = dFdy(-vViewPosition);
      vec3 tissueR1 = cross(tissueDy, normal), tissueR2 = cross(normal, tissueDx);
      float tissueDet = dot(tissueDx, tissueR1);
      normal = normalize(abs(tissueDet) * normal - sign(tissueDet) *
        (dFdx(microRelief) * tissueR1 + dFdy(microRelief) * tissueR2));
    `).replace('#include <lights_physical_fragment>', `
      #include <lights_physical_fragment>
      // Thin, irregular fluid film over the softer diffuse tissue layer.
      material.clearcoat = mix(.75, 1.0, tissueMoisture);
      material.clearcoatRoughness = mix(.045, .12, tissueFine);
    `);
  };
  material.customProgramCacheKey = () => 'brain-wet-cortex-v2';
  return material;
}

export function createAnatomyExplorer(o: Options) {
  let state = defaultAnatomyState();
  let model: THREE.Group | undefined, loadPromise: Promise<void> | undefined;
  let disposed = false, revision = 0, dirty = true, expanded = 0, fitting = false;
  const loadAbort = new AbortController();
  const abortLoad = () => loadAbort.abort();
  o.signal.addEventListener('abort', abortLoad, { once: true });
  let selectedMaterials: THREE.MeshStandardMaterial[] = [];
  const parts: Part[] = [], caps: Cap[] = [];
  const materials = new Set<THREE.Material>();
  const planes = [new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0)];
  const plane = planes[0], capRoot = new THREE.Group(); o.scene.add(capRoot);
  const capGeometry = new THREE.PlaneGeometry(20, 20);
  const initialPosition = o.camera.position.clone(), initialTarget = o.controls.target.clone();
  const targetPosition = initialPosition.clone(), targetLook = initialTarget.clone();
  let heartbeatTime = 0;
  let cameraTime = 0;
  const cameraFrom = initialPosition.clone(), lookFrom = initialTarget.clone();
  const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  function startCamera() {
    cameraFrom.copy(o.camera.position); lookFrom.copy(o.controls.target); cameraTime = 0; fitting = true;
  }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pointer = new THREE.Vector2(), raycaster = new THREE.Raycaster();
  const externalMaterials = new Set<THREE.Material>();
  o.exterior.traverse(ob => { if (ob instanceof THREE.Mesh) for (const m of (Array.isArray(ob.material) ? ob.material : [ob.material])) externalMaterials.add(m); });

  const handle = document.createElement('button');
  handle.className = 'cut-plane-handle'; handle.type = 'button'; handle.hidden = true;
  handle.setAttribute('role', 'slider'); handle.setAttribute('aria-label', 'Move cutting plane');
  handle.setAttribute('aria-valuemin', '0'); handle.setAttribute('aria-valuemax', '100');
  const grip = document.createElement('span'); grip.textContent = '↔'; handle.appendChild(grip);
  o.canvas.parentElement?.appendChild(handle);
  let dragging: { id: number; position: number; x: number; y: number; dx: number; dy: number; screenPosition: number; wa: number; wb: number; camera: THREE.Vector3; target: THREE.Vector3 } | undefined;

  function emit() { if (!disposed && !o.signal.aborted) o.onState?.({ ...state, cut: { ...state.cut }, visibleSystems: [...state.visibleSystems] }); }
  function invalidate() { dirty = true; o.wake(); }
  function clearSelection() {
    for (const m of selectedMaterials) { m.emissive.set(0); m.emissiveIntensity = 1; }
    selectedMaterials = []; state.selectedId = null;
  }
  function applyPlane() {
    plane.normal.set(0, 0, 0).setComponent({ x: 0, y: 1, z: 2 }[state.cut.axis], state.cut.flipped ? 1 : -1);
    plane.constant = -plane.normal[state.cut.axis] * cutCoordinate(state.cut.axis, state.cut.position);
  }
  function setClipping(m: THREE.Material, enabled: boolean) {
    if ((m.clippingPlanes?.length ?? 0) === (enabled ? 1 : 0)) return;
    m.clippingPlanes = enabled ? planes : []; m.clipShadows = enabled; m.needsUpdate = true;
  }
  function applyVisibility() {
    if (!model) return;
    const active = state.mode !== 'exterior';
    model.visible = active;
    o.exterior.visible = !active || state.visibleSystems.includes('skin');
    for (const part of parts) part.node.visible = active && systemVisible(part.systems, state.visibleSystems);
    for (const m of externalMaterials) setClipping(m, state.mode === 'split');
    for (const m of materials) if (!(m instanceof THREE.MeshBasicMaterial)) {
      // Cap surfaces are on the plane, not clipped by themselves.
      if (!m.userData.sectionCap) setClipping(m, state.mode === 'split');
    }
    handle.hidden = !active || state.mode !== 'split';
    if (state.selectedId && !parts.find(p => p.id === state.selectedId)?.node.visible) clearSelection();
    o.controls.minDistance = active ? 1.1 : 7.3; o.controls.maxDistance = active ? 52 : 18;
    o.controls.minPolarAngle = active ? .10 : .45; o.controls.maxPolarAngle = active ? Math.PI - .15 : Math.PI / 2.03;
  }
  function makeCaps(part: Part, mesh: THREE.Mesh, index: number) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const base = new THREE.MeshBasicMaterial({ depthWrite: false, depthTest: false, colorWrite: false,
      stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, clippingPlanes: planes });
    const backMat = base.clone(); backMat.side = THREE.BackSide;
    backMat.stencilFail = backMat.stencilZFail = backMat.stencilZPass = THREE.IncrementWrapStencilOp;
    const frontMat = base.clone(); frontMat.side = THREE.FrontSide;
    frontMat.stencilFail = frontMat.stencilZFail = frontMat.stencilZPass = THREE.DecrementWrapStencilOp;
    base.dispose();
    const sourceMaterial = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    const tissue = sourceMaterial.name.replace(/^Anatomy_/, '');
    const capMat = new THREE.MeshStandardMaterial({ color: tissueSectionColors[tissue] ?? sourceMaterial.color, roughness: .64, side: THREE.DoubleSide,
      stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    capMat.userData.sectionCap = true;
    const back = new THREE.Mesh(mesh.geometry, backMat), front = new THREE.Mesh(mesh.geometry, frontMat);
    for (const volume of [back, front]) { volume.matrixAutoUpdate = false; volume.frustumCulled = false; }
    const cap = new THREE.Mesh(capGeometry, capMat); cap.frustumCulled = false;
    back.renderOrder = 100 + index * 3; front.renderOrder = back.renderOrder + 1; cap.renderOrder = back.renderOrder + 2;
    cap.onAfterRender = renderer => renderer.clearStencil();
    capRoot.add(back, front, cap); materials.add(backMat); materials.add(frontMat); materials.add(capMat);
    caps.push({ source: mesh, part, back, front, cap, box: new THREE.Box3() });
  }

  function removeModel() {
    if (model) { disposeObject(model); model.removeFromParent(); model = undefined; }
  }
  async function load() {
    if (model || loadPromise) return loadPromise;
    state.status = 'loading'; emit();
    loadPromise = (async () => {
      const response = await fetch('/models/totoro-anatomy.glb?v=anatomy-realism-7', { signal: loadAbort.signal });
      if (!response.ok) throw new Error('Anatomy unavailable');
      const bytes = await response.arrayBuffer();
      if (disposed || o.signal.aborted) return;
      const { scene } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes, '/models/');
      if (disposed || o.signal.aborted) { disposeObject(scene); return; }
      model = scene; model.name = 'Totoro_anatomy'; model.visible = false; o.scene.add(model);
      model.traverse(node => {
        if (!node.userData.partId) return;
        const part: Part = { id: node.userData.partId, label: node.userData.label,
          systems: node.userData.systems, description: node.userData.description || '', node,
          rest: node.position.clone(), restScale: node.scale.clone(), offset: new THREE.Vector3().fromArray(node.userData.explodeOffset), meshes: [] };
        node.traverse(child => {
          if (!(child instanceof THREE.Mesh)) return;
          part.meshes.push(child);
          child.castShadow = true; child.receiveShadow = true;
          const multiple = Array.isArray(child.material);
          const clones = (multiple ? child.material as THREE.Material[] : [child.material as THREE.Material]).map(m => {
            const clone = m instanceof THREE.MeshStandardMaterial && m.name.startsWith('Anatomy_brain')
              ? brainTissueMaterial(m) : m.clone();
            if (clone instanceof THREE.MeshStandardMaterial) {
              if (!clone.name.startsWith('Anatomy_brain')) clone.envMapIntensity = .68;
              if (clone instanceof THREE.MeshPhysicalMaterial) {
                if (clone.name === 'Anatomy_muscle' || clone.name === 'Anatomy_tendon') {
                  // Tissue should catch a soft museum-light highlight rather
                  // than a plastic studio reflection. Tendons stay a touch
                  // brighter while muscle remains matte between the fibers.
                  const tendon = clone.name === 'Anatomy_tendon';
                  clone.sheen = tendon ? .16 : .07;
                  clone.sheenColor.set(tendon ? 0xe3d5ba : 0x8c463e);
                  clone.sheenRoughness = tendon ? .72 : .82;
                  clone.clearcoat = tendon ? .025 : .015;
                  clone.clearcoatRoughness = .54;
                  if (clone.normalMap) clone.normalScale.set(tendon ? .52 : .58, tendon ? .52 : .58);
                } else if (clone.name === 'Anatomy_cortical_bone') {
                  clone.envMapIntensity = .6;
                }
              }
              for (const texture of [clone.map, clone.normalMap, clone.roughnessMap]) {
                if (texture) texture.anisotropy = Math.min(8, o.renderer.capabilities?.getMaxAnisotropy() ?? 1);
              }
            }
            materials.add(clone); return clone;
          });
          child.material = multiple ? clones : clones[0];
        });
        parts.push(part);
      });
      // Some exporters repeat extras on primitive children. The named part
      // node is the only source of identity for both picking and explosion.
      const seen = new Set<string>();
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (seen.has(p.id) || parts.some(other => other !== p && other.id === p.id && other.node.getObjectById(p.node.id))) parts.splice(i, 1);
        else seen.add(p.id);
      }
      model.updateMatrixWorld(true);
      let capIndex = 0;
      for (const part of parts) for (const mesh of part.meshes) makeCaps(part, mesh, capIndex++);
      capRoot.visible = false;
      state.parts = parts.map(({ id, label, systems, description }) => ({ id, label, systems, description }));
      state.status = 'ready';
      emit();
    })();
    try { await loadPromise; } catch (error) {
      removeModel();
      for (const material of materials) material.dispose();
      materials.clear(); caps.length = 0; parts.length = 0; capRoot.clear();
      state.status = 'error'; emit();
      throw error;
    } finally { loadPromise = undefined; }
  }

  function fit(direction?: THREE.Vector3, part?: Part) {
    if (!model) return;
    model.updateMatrixWorld(true); o.exterior.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    if (part) bounds.setFromObject(part.node);
    else {
      for (const p of parts) if (p.node.visible) bounds.expandByObject(p.node);
      if (o.exterior.visible) bounds.expandByObject(o.exterior);
    }
    if (bounds.isEmpty()) return;
    const size = bounds.getSize(new THREE.Vector3()); bounds.getCenter(targetLook);
    const vector = direction ?? o.camera.position.clone().sub(o.controls.target).normalize();
    const distance = Math.max(1.2, fitDistance(size.x, size.y, size.z, o.camera.fov, o.camera.aspect));
    targetPosition.copy(targetLook).addScaledVector(vector.normalize(), distance); startCamera();
    if (reduced) { o.camera.position.copy(targetPosition); o.controls.target.copy(targetLook); fitting = false; }
    invalidate();
  }
  function cutDirection() {
    const sign = state.cut.flipped ? -1 : 1;
    return state.cut.axis === 'x' ? new THREE.Vector3(10 * sign, 3, 9)
      : state.cut.axis === 'y' ? new THREE.Vector3(5, 12 * sign, 8) : new THREE.Vector3(3, 3, 13 * sign);
  }
  async function setMode(mode: AnatomyMode) {
    const request = ++revision;
    clearSelection(); state.mode = mode; o.onMode?.();
    if (mode !== 'exterior') {
      try { await load(); } catch (error) {
        if (disposed || o.signal.aborted || request !== revision) return;
        state.mode = 'exterior'; state.status = 'error';
        if (process.env.NODE_ENV !== 'production') console.error('Anatomy loading failed', error);
      }
    }
    if (disposed || o.signal.aborted || request !== revision) return;
    applyVisibility(); applyPlane();
    const previousExpansion = expanded;
    expanded = state.mode === 'exploded' ? state.explosion : 0;
    updateLayout();
    if (state.mode === 'exterior') {
      targetPosition.copy(initialPosition); targetLook.copy(initialTarget); startCamera();
    } else fit(state.mode === 'split' ? cutDirection() : new THREE.Vector3(2, 1, 14));
    // Measure the destination first, then animate from the current assembly.
    if (!reduced && state.mode === 'exploded') expanded = previousExpansion;
    updateLayout();
    invalidate(); emit();
  }
  function updateLayout() {
    for (const part of parts) part.node.position.copy(part.rest).addScaledVector(part.offset, expanded);
    o.exterior.position.set(-4.35 * expanded, 0, 0);
    model?.updateMatrixWorld(true); o.exterior.updateMatrixWorld(true);
    for (const c of caps) {
      const visible = state.mode === 'split' && c.part.node.visible && c.box.copy(c.source.geometry.boundingBox!).applyMatrix4(c.source.matrixWorld).intersectsPlane(plane);
      c.back.visible = c.front.visible = c.cap.visible = visible;
      if (!visible) continue;
      c.back.matrix.copy(c.source.matrixWorld); c.front.matrix.copy(c.source.matrixWorld);
      c.cap.position.copy(plane.normal).multiplyScalar(-plane.constant);
      c.cap.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), plane.normal.clone().negate());
    }
    capRoot.visible = state.mode === 'split'; dirty = false;
  }
  function handleEndpoints() {
    const a = new THREE.Vector3(0, 2.45, 0), b = a.clone();
    [a[state.cut.axis], b[state.cut.axis]] = CUT_BOUNDS[state.cut.axis];
    const wa = -a.clone().applyMatrix4(o.camera.matrixWorldInverse).z;
    const wb = -b.clone().applyMatrix4(o.camera.matrixWorldInverse).z;
    a.project(o.camera); b.project(o.camera);
    return [new THREE.Vector2((a.x*.5+.5)*o.canvas.clientWidth,(-a.y*.5+.5)*o.canvas.clientHeight),
      new THREE.Vector2((b.x*.5+.5)*o.canvas.clientWidth,(-b.y*.5+.5)*o.canvas.clientHeight), wa, wb] as const;
  }
  function update(dt: number, animated = true) {
    if (disposed) return false;
    const target = state.mode === 'exploded' ? state.explosion : 0;
    const moving = Math.abs(expanded - target) > .0001;
    if (moving) { expanded = reduced ? target : THREE.MathUtils.damp(expanded, target, 8, dt); dirty = true; }
    else expanded = target;
    const heart = parts.find(part => part.id === 'heart');
    const pumping = !reduced && animated && state.mode !== 'exterior' && !!heart?.node.visible;
    if (pumping) heartbeatTime += dt;
    if (heart) {
      // 72 BPM: a quick primary contraction, smaller second beat, soft refill.
      const phase = (heartbeatTime % (60 / 72)) / (60 / 72);
      const pulse = (center: number, width: number) => Math.exp(-(((phase - center) / width) ** 2));
      const contraction = pumping ? pulse(.16, .065) + .42 * pulse(.36, .085) : 0;
      const wasContracted = !heart.node.scale.equals(heart.restScale);
      heart.node.scale.copy(heart.restScale).multiply(new THREE.Vector3(1 - .085 * contraction, 1 + .045 * contraction, 1 - .065 * contraction));
      // The section stencil must follow the beating surface every frame.
      if (pumping || wasContracted) dirty = true;
    }
    if (dirty) updateLayout();
    if (fitting) {
      cameraTime = Math.min(1, cameraTime + dt / 1.15);
      const t = reduced ? 1 : ease(cameraTime);
      o.camera.position.lerpVectors(cameraFrom, targetPosition, t); o.controls.target.lerpVectors(lookFrom, targetLook, t);
      fitting = t < 1;
    }
    if (dragging) {
      o.camera.position.copy(dragging.camera); o.controls.target.copy(dragging.target);
    }
    // Project the handle using the same camera transform as this frame's render.
    o.camera.lookAt(o.controls.target); o.camera.updateMatrixWorld(true);
    if (state.mode === 'split' && model) {
      const [a,b,wa,wb] = handleEndpoints();
      const p = state.cut.position;
      const screenPosition = p * wb / ((1 - p) * wa + p * wb);
      const point = a.clone().lerp(b,screenPosition);
      handle.style.left = `${point.x}px`; handle.style.top = `${point.y}px`;
      handle.style.setProperty('--cut-angle', `${Math.atan2(b.y-a.y,b.x-a.x)}rad`);
      handle.setAttribute('aria-valuenow',String(Math.round(state.cut.position*100)));
      handle.setAttribute('aria-valuetext',`${Math.round(state.cut.position*100)} percent, ${state.cut.axis === 'x' ? 'side to side' : state.cut.axis === 'y' ? 'top to bottom' : 'front to back'}`);
    }
    return moving || fitting || pumping;
  }
  function setCut(cut: Partial<AnatomyState['cut']>) {
    const changeDirection = cut.axis !== undefined && cut.axis !== state.cut.axis || cut.flipped !== undefined && cut.flipped !== state.cut.flipped;
    state.cut = { ...state.cut, ...cut, position: clamp01(cut.position ?? state.cut.position) };
    applyPlane(); invalidate(); emit();
    if (changeDirection) fit(cutDirection());
  }
  function selectPart(id: string | null) {
    clearSelection();
    const part = parts.find(p => p.id === id && p.node.visible);
    if (part) {
      state.selectedId = part.id;
      for (const mesh of part.meshes) for (const mat of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
        if (mat instanceof THREE.MeshStandardMaterial && !mat.name.startsWith('Anatomy_brain')) {
          mat.emissive.set(0x597246); mat.emissiveIntensity = .28; selectedMaterials.push(mat);
        }
      }
      fit(undefined, part);
    }
    emit(); invalidate();
  }
  let pointerDown: { x: number; y: number; id: number } | undefined;
  const onDown = (event: PointerEvent) => { if (event.isPrimary) pointerDown = { x: event.clientX, y: event.clientY, id: event.pointerId }; };
  const onUp = (event: PointerEvent) => {
    const start = pointerDown; pointerDown = undefined;
    if (!start || start.id !== event.pointerId || state.mode !== 'exploded' || Math.hypot(event.clientX-start.x,event.clientY-start.y)>5) return;
    const rect = o.canvas.getBoundingClientRect();
    pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,o.camera);
    const visible = parts.filter(p => p.node.visible);
    const hits = raycaster.intersectObjects(visible.flatMap(p => p.meshes),false);
    const part = visible.find(p => p.meshes.includes(hits[0]?.object as THREE.Mesh));
    selectPart(part?.id ?? null);
  };
  const dragStart = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    o.camera.updateMatrixWorld(true);
    const [a,b,wa,wb] = handleEndpoints(), p = state.cut.position;
    dragging = { id:event.pointerId, position:p,x:event.clientX,y:event.clientY,dx:b.x-a.x,dy:b.y-a.y,
      screenPosition:p * wb / ((1-p)*wa+p*wb), wa, wb,
      camera:o.camera.position.clone(), target:o.controls.target.clone() };
    handle.setPointerCapture(event.pointerId); o.controls.enabled = false; fitting = false;
  };
  const dragMove = (event: PointerEvent) => {
    if (!dragging || dragging.id !== event.pointerId) return;
    const d = dragging, length = d.dx*d.dx+d.dy*d.dy;
    // Near an end-on view, use a stable horizontal control instead of amplifying tiny movements.
    if (length < 2500) {
      setCut({position:d.position+(event.clientX-d.x)/250});
      return;
    }
    const screenPosition = clamp01(d.screenPosition+((event.clientX-d.x)*d.dx+(event.clientY-d.y)*d.dy)/length);
    setCut({position:screenPosition*d.wa/((1-screenPosition)*d.wb+screenPosition*d.wa)});
  };
  const dragEnd = () => {
    if (!dragging) return;
    // Discard orbit inertia accumulated before the drag without moving the camera.
    const d = dragging, damping = o.controls.enableDamping;
    o.controls.enableDamping = false; o.controls.update?.(); o.controls.enableDamping = damping;
    o.camera.position.copy(d.camera); o.controls.target.copy(d.target);
    dragging = undefined; o.controls.enabled = true; invalidate();
  };
  const handleKey = (e: KeyboardEvent) => {
    const delta = ['ArrowLeft','ArrowDown'].includes(e.key) ? -.01 : ['ArrowRight','ArrowUp'].includes(e.key) ? .01 : 0;
    if (!delta && !['Home','End'].includes(e.key)) return;
    e.preventDefault(); setCut({position:e.key==='Home'?0:e.key==='End'?1:state.cut.position+delta});
  };
  o.canvas.addEventListener('pointerdown',onDown); o.canvas.addEventListener('pointerup',onUp);
  handle.addEventListener('pointerdown',dragStart); handle.addEventListener('pointermove',dragMove);
  handle.addEventListener('pointerup',dragEnd); handle.addEventListener('pointercancel',dragEnd); handle.addEventListener('lostpointercapture',dragEnd); handle.addEventListener('keydown',handleKey);

  function disposeObject(root: THREE.Object3D) {
    const geometries = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    root.traverse(ob => { if (ob instanceof THREE.Mesh) {
      geometries.add(ob.geometry);
      for (const m of (Array.isArray(ob.material)?ob.material:[ob.material])) mats.add(m);
    } });
    for (const m of mats) for (const value of Object.values(m)) if (value instanceof THREE.Texture) textures.add(value);
    geometries.forEach(g=>g.dispose()); mats.forEach(m=>m.dispose()); textures.forEach(t=>{t.dispose();t.source.data?.close?.();});
  }
  return {
    get active() { return !!model && state.mode !== 'exterior'; },
    get state() { return state; },
    setMode, setCut, selectPart, update,
    stopCameraMotion() { fitting=false; },
    resize() {
      if (state.mode !== 'exterior' && model) fit(fitting ? targetPosition.clone().sub(targetLook) : undefined);
    },
    setExplosion(value: number) {
      state.explosion=clamp01(value);
      // Fit the final expanded bounds without rebuilding any geometry.
      const current=expanded; expanded=state.explosion; updateLayout(); fit(); expanded=current; invalidate();emit();
    },
    setVisibleSystems(visible: AnatomySystem[]) {
      state.visibleSystems=[...new Set(visible)]; applyVisibility(); invalidate(); emit();
      if (state.mode==='exploded') fit();
    },
    reset() {
      ++revision; clearSelection(); const status=state.status, manifest=state.parts;
      state={...defaultAnatomyState(),status,parts:manifest}; expanded=0; applyPlane(); applyVisibility();updateLayout();
      targetPosition.copy(initialPosition);targetLook.copy(initialTarget);startCamera();emit();invalidate();o.onMode?.();
    },
    dispose() {
      if(disposed)return;disposed=true;++revision;dragEnd();handle.remove();
      loadAbort.abort();o.signal.removeEventListener('abort',abortLoad);
      o.canvas.removeEventListener('pointerdown',onDown);o.canvas.removeEventListener('pointerup',onUp);
      if(model){disposeObject(model);model.removeFromParent();}
      for(const m of materials)m.dispose();capGeometry.dispose();capRoot.removeFromParent();
      for(const m of externalMaterials)setClipping(m,false);
      parts.length=0;caps.length=0;
    },
  };
}
export type AnatomyExplorer = ReturnType<typeof createAnatomyExplorer>;
