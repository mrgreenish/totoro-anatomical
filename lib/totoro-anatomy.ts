import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clamp01, cutCoordinate, CUT_BOUNDS, defaultAnatomyState, fitDistance, partVisible } from './anatomy-state';
import type { AnatomyMode, AnatomyPart, AnatomyState, AnatomySystem, AnatomyVariant } from './anatomy-state';
import { brainProximity, createBrainDetail, isBrainOccluder, probeBrainVisibility, type BrainDetail } from './brain-detail';
import type { HeartDetail, HeartViewOptions } from './heart-detail';
import type { EyeDetail } from './eye-detail';
import type { EyeViewOptions } from './eye-optics';
import type { OrganStudy } from './anatomy-state';
import { COAT_OFFSET, REVEAL_DURATION, museumEase, presentationOffset, presentationPhase, revealProgress, type PresentationPhase } from './anatomy-presentation';
import { applyTissuePreset, BRAIN_SURFACE, createHeartTissueMaterial, sectionTint } from './tissue-materials';

type Part = AnatomyPart & { node: THREE.Object3D; rest: THREE.Vector3; restScale: THREE.Vector3; offset: THREE.Vector3; phase: PresentationPhase; meshes: THREE.Mesh[] };
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
  animate?: boolean;
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
  applyTissuePreset(material);
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
      roughnessFactor = mix(${BRAIN_SURFACE.roughness[0]}, ${BRAIN_SURFACE.roughness[1]}, tissueMoisture);
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
      material.clearcoat = mix(${BRAIN_SURFACE.clearcoat[0]}, ${BRAIN_SURFACE.clearcoat[1]}, tissueMoisture);
      material.clearcoatRoughness = mix(${BRAIN_SURFACE.coatRoughness[0]}, ${BRAIN_SURFACE.coatRoughness[1]}, tissueFine);
    `);
  };
  material.customProgramCacheKey = () => 'brain-wet-cortex-museum-v3';
  return material;
}

export function createAnatomyExplorer(o: Options) {
  let state = defaultAnatomyState();
  let model: THREE.Group | undefined, loadPromise: Promise<void> | undefined;
  let disposed = false, revision = 0, dirty = true, fitting = false;
  let animationEnabled = o.animate ?? true;
  const expansion = [0, 0, 0], expansionFrom = [0, 0, 0];
  let revealTime = 0, revealing = false, entrance = false;
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
  function startCamera() {
    cameraFrom.copy(o.camera.position); lookFrom.copy(o.controls.target); cameraTime = 0;
    fitting = !reduced && animationEnabled;
    if (!fitting) { o.camera.position.copy(targetPosition); o.controls.target.copy(targetLook); }
  }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let detail: BrainDetail | HeartDetail | EyeDetail | undefined;
  let brainDetail: BrainDetail | undefined, heartDetail: HeartDetail | undefined;
  let eyeDetail: EyeDetail | undefined;
  let detailKind: OrganStudy = 'brain';
  const view = (kind = detailKind) => kind === 'brain' ? state.brainView : kind === 'heart' ? state.heartView : state.eyeView;
  const studyOpen = () => state.brainView.status === 'open' || state.heartView.status === 'open' || state.eyeView.status === 'open';
  let brainRequest = 0, proximityTime = .2, proximityPending = true;
  const proximityPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
  const proximityTarget = new THREE.Vector3(Infinity, Infinity, Infinity);
  let opening = false, restoringCamera = false;
  let openingEntry: 'contextual' | 'shortcut' = 'contextual';
  // One owner at a time may decode, compile, or release the shared detail scene.
  let brainLoadQueue: Promise<void> = Promise.resolve();
  let brainSnapshot: {
    position: THREE.Vector3; target: THREE.Vector3; quaternion: THREE.Quaternion;
    near: number; far: number; fov: number;
    minDistance: number; maxDistance: number; minPolarAngle: number; maxPolarAngle: number;
  } | undefined;
  const pointer = new THREE.Vector2(), raycaster = new THREE.Raycaster();
  const occluders: THREE.Mesh[] = [];
  const brainBounds = new THREE.Box3(), brainCenter = new THREE.Vector3(), cameraDirection = new THREE.Vector3();
  const screenBounds = new THREE.Box2(), screenPoint = new THREE.Vector2(), corner = new THREE.Vector3();
  const externalMaterials = new Set<THREE.Material>();
  o.exterior.traverse(ob => { if (ob instanceof THREE.Mesh) for (const m of (Array.isArray(ob.material) ? ob.material : [ob.material])) externalMaterials.add(m); });

  const handle = document.createElement('button');
  handle.className = 'cut-plane-handle'; handle.type = 'button'; handle.hidden = true;
  handle.setAttribute('role', 'slider'); handle.setAttribute('aria-label', 'Move cutting plane');
  handle.setAttribute('aria-valuemin', '0'); handle.setAttribute('aria-valuemax', '100');
  const grip = document.createElement('span'); grip.textContent = '↔'; handle.appendChild(grip);
  o.canvas.parentElement?.appendChild(handle);
  let dragging: { id: number; position: number; x: number; y: number; dx: number; dy: number; screenPosition: number; wa: number; wb: number; camera: THREE.Vector3; target: THREE.Vector3 } | undefined;

  function emit() { if (!disposed && !o.signal.aborted) o.onState?.({ ...state, brainView: { ...state.brainView }, heartView: { ...state.heartView }, eyeView: { ...state.eyeView }, cut: { ...state.cut }, visibleSystems: [...state.visibleSystems] }); }
  function invalidate() { dirty = true; proximityPending = true; o.wake(); }
  async function organAsset(kind: OrganStudy) {
    const options = { renderer: o.renderer, environment: o.scene.environment, signal: o.signal,
      canvas:o.canvas, camera:o.camera, controls:o.controls, wake:()=>o.wake(), reduced };
    if(kind === 'brain')return brainDetail ??= createBrainDetail(options);
    if(kind === 'eye') {
      if(!eyeDetail) {
        const {createEyeDetail}=await import('./eye-detail');
        if(disposed||o.signal.aborted)throw new Error('Disposed');
        eyeDetail=createEyeDetail(options);
      }
      return eyeDetail;
    }
    if(!heartDetail) {
      const {createHeartDetail}=await import('./heart-detail');
      if(disposed||o.signal.aborted)throw new Error('Disposed');
      heartDetail=createHeartDetail(options);
    }
    return heartDetail;
  }
  function discardInertia() {
    const position = o.camera.position.clone(), target = o.controls.target.clone();
    const damping = o.controls.enableDamping, rotate = o.controls.autoRotate;
    o.controls.enableDamping = false; o.controls.autoRotate = false; o.controls.update?.();
    o.controls.enableDamping = damping; o.controls.autoRotate = rotate;
    o.camera.position.copy(position); o.controls.target.copy(target);
  }
  function frameDetail() {
    if(detailKind === 'eye' && eyeDetail) { eyeDetail.frame(); return; }
    const bounds = new THREE.Box3().setFromObject(detail!.root);
    const size = bounds.getSize(new THREE.Vector3()); bounds.getCenter(targetLook);
    const distance = fitDistance(size.x, size.y, size.z, o.camera.fov, o.camera.aspect);
    targetPosition.copy(targetLook).addScaledVector((detailKind === 'brain' ? new THREE.Vector3(1.2, .85, 2.1) : new THREE.Vector3(.28, .20, 2.8)).normalize(), distance);
    o.controls.minDistance = detailKind === 'brain' ? 1.05 : .68; o.controls.maxDistance = distance * 2.5;
    o.controls.minPolarAngle = .025; o.controls.maxPolarAngle = Math.PI - .025;
    // A fresh framing within the isolated scene avoids flying through the body.
    o.camera.position.copy(targetPosition); o.controls.target.copy(targetLook);
    o.camera.near = .025; o.camera.far = 100; o.camera.updateProjectionMatrix();
    o.camera.lookAt(targetLook); o.camera.updateMatrixWorld(true);
  }
  async function openOrganView(kind: OrganStudy, entry: 'contextual' | 'shortcut' = 'contextual') {
    // All three studies share one camera snapshot. Switching preserves the
    // anatomy state and releases the previous study's GPU resources first.
    if(studyOpen() && kind !== detailKind && !opening) closeDetailView();
    if (state.mode === 'exterior' || state.status !== 'ready' || (entry === 'contextual' && !view(kind).available)
      || opening || studyOpen() || disposed) return;
    detailKind = kind;
    const request = ++brainRequest;
    opening = true; openingEntry = entry; view(kind).status = 'loading'; emit();
    const valid = () => !disposed && !o.signal.aborted && request === brainRequest && state.mode !== 'exterior'
      && (entry === 'shortcut' || view(kind).available);
    const loading = brainLoadQueue.then(async () => {
      if (!valid()) return;
      const asset = await organAsset(kind);
      if(!valid())return;
      await asset.load(o.canvas.clientWidth);
      if (!valid()) { asset.unload(); return; }
      await o.renderer.compileAsync?.(asset.scene, o.camera);
      if (!valid()) { asset.unload(); return; }
      detail = asset;
      fitting = false; discardInertia();
      brainSnapshot = {
        position: o.camera.position.clone(), target: o.controls.target.clone(), quaternion: o.camera.quaternion.clone(),
        near: o.camera.near, far: o.camera.far, fov: o.camera.fov,
        minDistance: o.controls.minDistance, maxDistance: o.controls.maxDistance,
        minPolarAngle: o.controls.minPolarAngle, maxPolarAngle: o.controls.maxPolarAngle,
      };
      frameDetail(); handle.hidden = true;
      view(kind).status = 'open';
      detail!.setInteractive(true);
    });
    brainLoadQueue = loading.catch(() => {});
    try { await loading; } catch {
      if (request === brainRequest && !disposed && !o.signal.aborted) view(kind).status = 'error';
    } finally {
      if (request === brainRequest && !disposed) {
        opening = false;
        if (view(kind).status === 'loading') view(kind).status = 'closed';
        emit(); invalidate();
      }
    }
  }
  function closeDetailView() {
    ++brainRequest; opening = false;
    if (brainSnapshot) {
      detail?.setInteractive(false);
      fitting = false; discardInertia();
      const saved = brainSnapshot;
      o.camera.position.copy(saved.position); o.camera.quaternion.copy(saved.quaternion);
      o.controls.target.copy(saved.target);
      Object.assign(o.camera, { near: saved.near, far: saved.far, fov: saved.fov }); o.camera.updateProjectionMatrix();
      Object.assign(o.controls, { minDistance: saved.minDistance, maxDistance: saved.maxDistance, minPolarAngle: saved.minPolarAngle, maxPolarAngle: saved.maxPolarAngle });
      o.camera.updateMatrixWorld(true); brainSnapshot = undefined;
      // A CSS viewport change on exit must not replace the restored camera fit.
      restoringCamera = true;
    }
    handle.hidden = state.mode !== 'split';
    detail?.unload();
    state.brainView.status = state.heartView.status = state.eyeView.status = 'closed'; emit(); invalidate();
  }
  function updateOrganAvailability(kind: OrganStudy) {
    const brain = parts.find(p => p.id === kind);
    let fraction = 0, visible = false;
    if (brain?.node.visible && state.mode !== 'exterior') {
      brainBounds.setFromObject(brain.node);
      brainBounds.getCenter(brainCenter);
      if (brainCenter.sub(o.camera.position).dot(o.camera.getWorldDirection(cameraDirection)) > 0) {
        screenBounds.makeEmpty();
        for (const x of [brainBounds.min.x, brainBounds.max.x]) for (const y of [brainBounds.min.y, brainBounds.max.y]) for (const z of [brainBounds.min.z, brainBounds.max.z]) {
          corner.set(x, y, z).project(o.camera);
          screenBounds.expandByPoint(screenPoint.set(corner.x * o.canvas.clientWidth / 2, corner.y * o.canvas.clientHeight / 2));
        }
        const size = screenBounds.getSize(screenPoint);
        fraction = Math.max(size.x, size.y) / Math.min(o.canvas.clientWidth, o.canvas.clientHeight);
        if (brainProximity(fraction, true, view(kind).available)) {
          occluders.length = 0;
          for (const part of parts) {
            if (!part.node.visible) continue;
            for (const mesh of part.meshes) if (isBrainOccluder(mesh)) occluders.push(mesh);
          }
          if (o.exterior.visible) o.exterior.traverse(node => {
            if (node instanceof THREE.Mesh && isBrainOccluder(node)) occluders.push(node);
          });
          // Surface samples handle partial clipping. Caps and fur fibers are
          // skipped: the clip plane already rejects cut-away tissue, and the
          // coat hull is the Body mesh rather than 150k+ groom triangles.
          visible = probeBrainVisibility(o.camera, brain.meshes, occluders, raycaster, state.mode === 'split' ? plane : null);
        }
      }
    }
    const available = brainProximity(fraction, visible, view(kind).available);
    if (available !== view(kind).available) {
      view(kind).available = available;
      if (!available && opening && detailKind === kind && openingEntry === 'contextual') closeDetailView();
      emit();
    }
  }
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
    for (const part of parts) part.node.visible = active && partVisible(part, state);
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
    // Material.clone() deep-copies clipping planes. Both stencil passes must
    // follow the live plane used by the tissue, rather than the plane at load.
    backMat.clippingPlanes = frontMat.clippingPlanes = planes;
    base.dispose();
    const sourceMaterial = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    const tissue = sourceMaterial.name.replace(/^Anatomy_/, '');
    const capMat = new THREE.MeshStandardMaterial({ color: tissueSectionColors[tissue] ?? sourceMaterial.color, roughness: .64, side: THREE.DoubleSide,
      stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    capMat.color.multiply(new THREE.Color(sectionTint(sourceMaterial.name)));
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
      const response = await fetch('/models/totoro-anatomy.glb?v=anatomy-back-containment-2', { signal: loadAbort.signal });
      if (!response.ok) throw new Error('Anatomy unavailable');
      const bytes = await response.arrayBuffer();
      if (disposed || o.signal.aborted) return;
      const { scene } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes, '/models/');
      if (disposed || o.signal.aborted) { disposeObject(scene); return; }
      model = scene; model.name = 'Totoro_anatomy'; model.visible = false; o.scene.add(model);
      model.traverse(node => {
        if (!node.userData.partId) return;
        const part: Part = { id: node.userData.partId, label: node.userData.label,
          systems: node.userData.systems, description: node.userData.description || '', variant: node.userData.variant, node,
          rest: node.position.clone(), restScale: node.scale.clone(),
          offset: new THREE.Vector3().fromArray(presentationOffset(node.userData.partId, node.userData.assemblyGroup, node.userData.explodeOffset)),
          phase: presentationPhase(node.userData.assemblyGroup), meshes: [] };
        node.traverse(child => {
          if (!(child instanceof THREE.Mesh)) return;
          part.meshes.push(child);
          child.castShadow = true; child.receiveShadow = true;
          const multiple = Array.isArray(child.material);
          const clones = (multiple ? child.material as THREE.Material[] : [child.material as THREE.Material]).map(m => {
            const cardiac = part.id === 'heart' && m instanceof THREE.MeshStandardMaterial;
            const clone = m instanceof THREE.MeshStandardMaterial && m.name.startsWith('Anatomy_brain')
              ? brainTissueMaterial(m) : cardiac ? createHeartTissueMaterial(m) : m.clone();
            if (clone instanceof THREE.MeshStandardMaterial) {
              if (!cardiac && !clone.name.startsWith('Anatomy_brain')) {
                clone.envMapIntensity = .68;
                applyTissuePreset(clone);
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
      state.parts = parts.map(({ id, label, systems, description, variant }) => ({ id, label, systems, description, variant }));
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
    if (reduced || !animationEnabled) { o.camera.position.copy(targetPosition); o.controls.target.copy(targetLook); fitting = false; }
    invalidate();
  }
  function cutDirection() {
    const sign = state.cut.flipped ? -1 : 1;
    return state.cut.axis === 'x' ? new THREE.Vector3(10 * sign, 3, 9)
      : state.cut.axis === 'y' ? new THREE.Vector3(5, 12 * sign, 8) : new THREE.Vector3(3, 3, 13 * sign);
  }
  function fitDestination(direction?: THREE.Vector3, part?: Part) {
    if (state.mode !== 'exploded' || !revealing) { fit(direction, part); return; }
    const current = expansion.slice();
    expansion.fill(state.explosion); updateLayout(); fit(direction, part);
    for (let i = 0; i < 3; i++) expansion[i] = current[i];
    updateLayout();
  }
  async function setMode(mode: AnatomyMode) {
    closeDetailView(); restoringCamera = false;
    revealing = false;
    const request = ++revision;
    clearSelection(); state.mode = mode; o.onMode?.();
    // Hide geometry and independent stencil passes synchronously, even if an
    // earlier anatomy load has not settled yet.
    if (mode !== 'exploded') expansion.fill(0);
    if (mode === 'exterior') { applyVisibility(); updateLayout(); }
    if (mode !== 'exterior') {
      try { await load(); } catch (error) {
        if (disposed || o.signal.aborted || request !== revision) return;
        state.mode = 'exterior'; state.status = 'error';
        if (process.env.NODE_ENV !== 'production') console.error('Anatomy loading failed', error);
      }
    }
    if (disposed || o.signal.aborted || request !== revision) return;
    applyVisibility(); applyPlane();
    for (let i = 0; i < 3; i++) expansionFrom[i] = expansion[i];
    expansion.fill(state.mode === 'exploded' ? state.explosion : 0);
    updateLayout();
    if (state.mode === 'exterior') {
      targetPosition.copy(initialPosition); targetLook.copy(initialTarget); startCamera();
    } else fit(state.mode === 'split' ? cutDirection() : new THREE.Vector3(2, 1, 14));
    // Measure the destination first, then animate from the current assembly.
    if (!reduced && animationEnabled && state.mode === 'exploded') {
      for (let i = 0; i < 3; i++) expansion[i] = expansionFrom[i];
      revealTime = 0; revealing = true; entrance = true;
    }
    updateLayout();
    invalidate(); emit();
  }
  function updateLayout() {
    for (const part of parts) part.node.position.copy(part.rest).addScaledVector(part.offset, expansion[part.phase]);
    o.exterior.position.set(COAT_OFFSET[0] * expansion[0], COAT_OFFSET[1] * expansion[0], COAT_OFFSET[2] * expansion[0]);
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
    animationEnabled = animated;
    if (studyOpen()) return detail?.update(dt, animated && !reduced) ?? false;
    const target = state.mode === 'exploded' ? state.explosion : 0;
    const moving = revealing;
    if (revealing) {
      revealTime += dt;
      for (let i = 0; i < 3; i++) {
        const progress = reduced || !animated ? 1 : revealProgress(revealTime, i as PresentationPhase, entrance);
        expansion[i] = progress === 1 ? target : THREE.MathUtils.lerp(expansionFrom[i], target, progress);
      }
      revealing = !reduced && animated && revealTime < (entrance ? REVEAL_DURATION : .3);
      dirty = true;
    }
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
      cameraTime = Math.min(1, cameraTime + dt / REVEAL_DURATION);
      const t = reduced || !animated ? 1 : museumEase(cameraTime);
      o.camera.position.lerpVectors(cameraFrom, targetPosition, t); o.controls.target.lerpVectors(lookFrom, targetLook, t);
      fitting = t < 1;
    }
    if (dragging) {
      o.camera.position.copy(dragging.camera); o.controls.target.copy(dragging.target);
    }
    // Project the handle using the same camera transform as this frame's render.
    o.camera.lookAt(o.controls.target); o.camera.updateMatrixWorld(true);
    if (!proximityPosition.equals(o.camera.position) || !proximityTarget.equals(o.controls.target) || moving) proximityPending = true;
    proximityTime += dt;
    if (proximityPending && proximityTime >= .18) {
      proximityTime = 0; proximityPending = false;
      proximityPosition.copy(o.camera.position); proximityTarget.copy(o.controls.target);
      updateOrganAvailability('brain');
      updateOrganAvailability('heart');
    }
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
    return moving || fitting || pumping || proximityPending;
  }
  function setCut(cut: Partial<AnatomyState['cut']>) {
    if (studyOpen() || opening) closeDetailView();
    const changeDirection = cut.axis !== undefined && cut.axis !== state.cut.axis || cut.flipped !== undefined && cut.flipped !== state.cut.flipped;
    state.cut = { ...state.cut, ...cut, position: clamp01(cut.position ?? state.cut.position) };
    applyPlane(); invalidate(); emit();
    if (changeDirection) fit(cutDirection());
  }
  function selectPart(id: string | null) {
    if (studyOpen() || opening) closeDetailView();
    clearSelection();
    const part = parts.find(p => p.id === id && p.node.visible);
    if (part) {
      state.selectedId = part.id;
      for (const mesh of part.meshes) for (const mat of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
        if (mat instanceof THREE.MeshStandardMaterial && !mat.name.startsWith('Anatomy_brain')) {
          // The green inspector glow bleaches red tissue when focusing the
          // heart. Keep its natural color and lighting readable at close range.
          mat.emissive.set(part.id === 'heart' ? 0x6c2020 : 0x597246);
          mat.emissiveIntensity = part.id === 'heart' ? .035 : .28;
          selectedMaterials.push(mat);
        }
      }
      fitDestination(undefined, part);
    }
    emit(); invalidate();
  }
  let pointerDown: { x: number; y: number; id: number } | undefined;
  const onDown = (event: PointerEvent) => { if (event.isPrimary) pointerDown = { x: event.clientX, y: event.clientY, id: event.pointerId }; };
  const onUp = (event: PointerEvent) => {
    const start = pointerDown; pointerDown = undefined;
    if (!start || start.id !== event.pointerId || studyOpen() || state.mode !== 'exploded' || Math.hypot(event.clientX-start.x,event.clientY-start.y)>5) return;
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
  // A recreated renderer (for example during live preview updates) must
  // synchronize React's controls with this explorer's fresh initial state.
  emit();
  return {
    get active() { return !!model && state.mode !== 'exterior'; },
    get state() { return state; },
    get detailScene() { return studyOpen() ? detail?.scene : undefined; },
    setMode, setCut, selectPart, update,
    openBrainView: (entry?: 'contextual' | 'shortcut') => openOrganView('brain', entry),
    openHeartView: (entry?: 'contextual' | 'shortcut') => openOrganView('heart', entry),
    openEyeView: (entry?: 'contextual' | 'shortcut') => openOrganView('eye', entry),
    closeBrainView: closeDetailView, closeHeartView: closeDetailView, closeEyeView: closeDetailView,
    setHeartViewOptions(options: Partial<HeartViewOptions>) { heartDetail?.setOptions(options); invalidate(); },
    setEyeViewOptions(options: Partial<EyeViewOptions>) { eyeDetail?.setOptions(options); invalidate(); },
    setAnatomyVariant(value: AnatomyVariant) {
      if ((value !== 'male' && value !== 'female') || state.variant === value) return;
      if (studyOpen() || opening) closeDetailView();
      state.variant = value;
      // Stop a previous selection flight without reframing the user's cut.
      fitting = false;
      applyVisibility(); updateLayout(); invalidate(); emit();
    },
    stopCameraMotion() { fitting=false; },
    setAnimate(value: boolean) {
      animationEnabled = value;
      if (!value) {
        revealing = false; expansion.fill(state.mode === 'exploded' ? state.explosion : 0);
        if (fitting) { o.camera.position.copy(targetPosition); o.controls.target.copy(targetLook); fitting = false; }
        updateLayout();
      }
      invalidate();
    },
    resize() {
      if (studyOpen()) { detail?.setInteractive(false); frameDetail(); detail?.setInteractive(true); return; }
      if (restoringCamera) { restoringCamera = false; return; }
      if (state.mode !== 'exterior' && model) fitDestination(fitting ? targetPosition.clone().sub(targetLook) : undefined);
    },
    setExplosion(value: number) {
      if (studyOpen() || opening) closeDetailView();
      state.explosion=clamp01(value);
      // Fit the final expanded bounds without rebuilding any geometry.
      for (let i = 0; i < 3; i++) expansionFrom[i] = expansion[i];
      expansion.fill(state.mode === 'exploded' ? state.explosion : 0); updateLayout(); fit();
      if (!reduced && animationEnabled && state.mode === 'exploded') {
        for (let i = 0; i < 3; i++) expansion[i] = expansionFrom[i];
        revealTime = 0; revealing = true; entrance = false;
      } else revealing = false;
      updateLayout(); invalidate(); emit();
    },
    setVisibleSystems(visible: AnatomySystem[]) {
      if (studyOpen() || opening) closeDetailView();
      state.visibleSystems=[...new Set(visible)]; applyVisibility(); invalidate(); emit();
      if (state.mode==='exploded') fitDestination();
    },
    reset() {
      closeDetailView(); restoringCamera = false;
      ++revision; clearSelection(); const status=state.status, manifest=state.parts;
      state={...defaultAnatomyState(),status,parts:manifest}; revealing=false; expansion.fill(0); applyPlane(); applyVisibility();updateLayout();
      targetPosition.copy(initialPosition);targetLook.copy(initialTarget);startCamera();emit();invalidate();o.onMode?.();
    },
    dispose() {
      if(disposed)return;disposed=true;++revision;dragEnd();handle.remove();
      ++brainRequest; brainDetail?.dispose(); heartDetail?.dispose(); eyeDetail?.dispose();
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
