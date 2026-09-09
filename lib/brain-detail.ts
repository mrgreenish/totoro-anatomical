import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { applyTissueTouch, createBrainTouch, TOUCH_GLSL } from './brain-touch';

const BASE = '/models/brain-detail/';
type NeuralPath = { points: number[][]; phase: number; depth: number };
type Options = {
  renderer: THREE.WebGLRenderer; environment: THREE.Texture | null; signal: AbortSignal;
  canvas: HTMLCanvasElement; camera: THREE.PerspectiveCamera; controls: OrbitControls; wake(): void; reduced: boolean;
};
type Cache = {
  size: number; bytes: ArrayBuffer; paths: NeuralPath[];
  color: Blob; normal: Blob; surface: Blob; membrane: Blob; height: Blob;
};
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

export function detailTextureSize(width: number, maxTextureSize: number) {
  return width < 768 || maxTextureSize < 4096 ? 2048 : 4096;
}

export function createBrainDetail(o: Options) {
  const scene = new THREE.Scene();
  // The transparent background lets the gallery's dark vignette show through.
  scene.environment = o.environment;
  scene.environmentIntensity = .36;
  const ambient = new THREE.HemisphereLight(0xe8e6e2, 0x332a2c, .24);
  const key = new THREE.DirectionalLight(0xfff4ec, 2.7); key.position.set(-2, 3, 2);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -.9, right: .9, top: .9, bottom: -.9, near: .1, far: 8 });
  key.shadow.bias = -.00008; key.shadow.normalBias = .0006;
  const fill = new THREE.DirectionalLight(0xd9e6f4, .38); fill.position.set(2, .5, 2);
  const rim = new THREE.DirectionalLight(0xf0d6d4, 1.5); rim.position.set(1.5, 1, -2);
  scene.add(ambient, key, fill, rim);
  const root = new THREE.Group(); scene.add(root);
  const touch = createBrainTouch({ canvas:o.canvas, camera:o.camera, controls:o.controls, root, wake:()=>o.wake(), reduced:o.reduced });
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const time = { value: 0 };
  let promise: Promise<void> | undefined;
  let cache: Cache | undefined;
  let ready = false, disposed = false;
  const abort = new AbortController();
  const abortParent = () => abort.abort();
  o.signal.addEventListener('abort', abortParent, { once: true });

  async function get(url: string) {
    const response = await fetch(`${BASE}${url}?v=brain-detail-1`, { signal: abort.signal });
    if (!response.ok) throw new Error('The detailed brain could not load.');
    return response;
  }
  async function texture(blob: Blob, color = false) {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'none', premultiplyAlpha: 'none' });
    if (disposed) { bitmap.close(); throw new Error('Disposed'); }
    const map = new THREE.Texture(bitmap);
    map.flipY = false;
    map.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    map.anisotropy = Math.min(8, o.renderer.capabilities.getMaxAnisotropy());
    map.needsUpdate = true; textures.add(map);
    return map;
  }
  function release() {
    touch.setEnabled(false);
    root.clear(); geometries.forEach(g => g.dispose()); geometries.clear();
    materials.forEach(m => m.dispose()); materials.clear();
    textures.forEach(t => { t.dispose(); (t.image as ImageBitmap)?.close?.(); }); textures.clear();
    key.shadow.dispose();
    ready = false;
  }
  async function fetchCache(size: number) {
    // Settle every request before cleanup so a late image decode cannot leak.
    const results = await Promise.allSettled([
      get('brain-detail.glb').then(r => r.arrayBuffer()),
      get('neural-paths.json').then(r => r.json() as Promise<NeuralPath[]>),
      get(`basecolor-${size}.webp`).then(r => r.blob()), get(`normal-${size}.webp`).then(r => r.blob()),
      get('surface.webp').then(r => r.blob()), get('membrane.webp').then(r => r.blob()), get('height.png').then(r => r.blob()),
    ] as const);
    const failure = results.find(r => r.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    const [bytes, paths, color, normal, surface, membrane, height] = results.map(r => (r as PromiseFulfilledResult<unknown>).value) as [ArrayBuffer, NeuralPath[], Blob, Blob, Blob, Blob, Blob];
    return { size, bytes, paths, color, normal, surface, membrane, height };
  }
  async function load(width: number) {
    if (ready || disposed) return;
    if (promise) return promise;
    const thisPromise = (async () => {
      const size = detailTextureSize(width, o.renderer.capabilities.maxTextureSize);
      if (cache?.size !== size) cache = undefined;
      cache ??= await fetchCache(size);
      if (!cache || disposed || o.signal.aborted) throw new Error('Disposed');
      const [color, normal, surface, membrane, height] = await Promise.all([
        texture(cache.color, true), texture(cache.normal), texture(cache.surface), texture(cache.membrane), texture(cache.height),
      ]);
      if (disposed || o.signal.aborted) throw new Error('Disposed');
      const { bytes, paths } = cache;
      const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes, BASE);
      gltf.scene.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        node.castShadow = true; node.receiveShadow = true;
        geometries.add(node.geometry);
        const source = (Array.isArray(node.material) ? node.material[0] : node.material) as THREE.MeshStandardMaterial;
        const name = source.name;
        let material: THREE.MeshPhysicalMaterial;
        if (name.includes('artery') || name.includes('vein')) {
          material = new THREE.MeshPhysicalMaterial({ color: source.color, roughness: .28, clearcoat: .85, clearcoatRoughness: .10 });
          material.onBeforeCompile = shader => {
            shader.uniforms.brainTime = time;
            shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float brainTime;')
              .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * (.00014 * sin(brainTime * 7.3 + position.y * 5.0));');
          };
          material.customProgramCacheKey = () => 'brain-detail-vessel-v1';
        } else {
          material = new THREE.MeshPhysicalMaterial({
            map: color, normalMap: normal, normalScale: new THREE.Vector2(.6, .6),
            roughness: .65, roughnessMap: surface, aoMap: surface, aoMapIntensity: .65,
            bumpMap: height, bumpScale: .00065,
            metalness: 0, clearcoat: 1, clearcoatMap: membrane,
            clearcoatRoughness: .14, clearcoatRoughnessMap: surface,
            clearcoatNormalMap: normal, clearcoatNormalScale: new THREE.Vector2(.12, .12),
            ior: 1.36, specularIntensity: .85, envMapIntensity: 1.2,
            // Enable Three's volume-refraction pass; the shader varies its
            // contribution locally from the actual stretched surface area.
            transmission: .015, thickness: .12, thicknessMap: membrane,
            attenuationColor: new THREE.Color(.72, .30, .25), attenuationDistance: .24,
          });
          // Three's normalMap takes precedence over bumpMap. Add the height
          // relief explicitly so both independently baked maps contribute.
          material.onBeforeCompile = shader => {
            shader.uniforms.brainMembrane = { value: membrane };
            shader.uniforms.brainHeight = { value: height };
            shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vTissueUv; varying float vTissueArea;')
              .replace('#include <begin_vertex>', `#include <begin_vertex>
                vTissueUv = uv;
                vec3 restNormal=normalize(mat3(modelMatrix)*normal);
                vTissueArea=softTissueArea((modelMatrix*vec4(position,1.0)).xyz,restNormal);
              `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
              varying vec2 vTissueUv; varying float vTissueArea;
              uniform sampler2D brainMembrane; uniform sampler2D brainHeight;
              float brainStretch() { return smoothstep(1.035,1.55,vTissueArea); }
              float brainOpticalDepth() {
                return mix(.32,1.0,texture2D(brainMembrane,vTissueUv).g)/max(1.0,vTissueArea);
              }
            `)
              .replace('#include <lights_physical_pars_fragment>', `
                #include <lights_physical_pars_fragment>
                // Fast thickness-based subsurface transport, evaluated for
                // each real light after its attenuation and shadowing.
                void RE_Direct_Brain(const in IncidentLight light, const in vec3 p,
                  const in vec3 n, const in vec3 v, const in vec3 coatNormal,
                  const in PhysicalMaterial tissue, inout ReflectedLight reflected) {
                  RE_Direct_Physical(light,p,n,v,coatNormal,tissue,reflected);
                  float depth=brainOpticalDepth();
                  float stretch=brainStretch();
                  float back=pow(saturate(dot(v,-normalize(light.direction+n*.42))),3.0);
                  float wrap=saturate((dot(n,light.direction)+.45)/1.45);
                  vec3 transport=exp(-vec3(.9,2.8,3.5)*depth);
                  reflected.directDiffuse+=light.color*tissue.diffuseColor*transport*
                    (back*(.52+.65*stretch)+wrap*.13)*RECIPROCAL_PI;
                }
                #undef RE_Direct
                #define RE_Direct RE_Direct_Brain
              `)
              .replace('#include <normal_fragment_maps>', `
                #include <normal_fragment_maps>
                float relief = texture2D(brainHeight, vTissueUv).r * .00065;
                vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
                vec3 rx = cross(dy, normal), ry = cross(normal, dx);
                float determinant = dot(dx, rx);
                normal = normalize(abs(determinant) * normal - sign(determinant) * (dFdx(relief) * rx + dFdy(relief) * ry));
              `).replace('#include <transmission_fragment>', THREE.ShaderChunk.transmission_fragment
                .replace('material.transmission = transmission;', 'material.transmission = transmission + .46 * brainStretch();')
                .replace('material.thickness = thickness;', 'material.thickness = thickness / max(1.0,vTissueArea);'));
          };
          material.customProgramCacheKey = () => 'brain-detail-tissue-scattering-v2';
        }
        material.name = name; materials.add(material);
        const compileTissue = material.onBeforeCompile.bind(material);
        const cacheKey = material.customProgramCacheKey();
        material.onBeforeCompile = (shader, renderer) => { compileTissue(shader,renderer); applyTissueTouch(shader,touch.springs); };
        material.customProgramCacheKey = () => `${cacheKey}-squash-v1`;
        const depth = new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
        depth.onBeforeCompile = shader => applyTissueTouch(shader,touch.springs);
        depth.customProgramCacheKey = () => 'brain-squash-shadow-v1';
        node.customDepthMaterial=depth;materials.add(depth);
        for (const m of Array.isArray(node.material) ? node.material : [node.material]) m.dispose();
        node.material = material;
      });
      root.add(gltf.scene);
      const pieces: THREE.BufferGeometry[] = [];
      for (const path of paths) {
        const curve = new THREE.CatmullRomCurve3(path.points.map(p => new THREE.Vector3().fromArray(p)));
        const g = new THREE.TubeGeometry(curve, path.points.length * 2, .0018, 5, false);
        const count = g.attributes.position.count;
        g.setAttribute('phase', new THREE.Float32BufferAttribute(new Float32Array(count).fill(path.phase), 1));
        g.setAttribute('tissueDepth', new THREE.Float32BufferAttribute(new Float32Array(count).fill(path.depth), 1));
        pieces.push(g);
      }
      const geometry = mergeGeometries(pieces);
      pieces.forEach(g => g.dispose());
      if (geometry) {
        geometries.add(geometry);
        const material = new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, depthTest: true,
          uniforms: { brainTime: time, tissueTouchCenters:{value:touch.springs.centers}, tissueTouchOffsets:{value:touch.springs.offsets} },
          vertexShader: `${TOUCH_GLSL}\nattribute float phase; attribute float tissueDepth;
            varying vec2 vUv; varying float vPhase; varying float vDepth;
            void main() { vUv=uv; vPhase=phase; vDepth=tissueDepth;
              gl_Position=projectionMatrix*viewMatrix*vec4(softTissuePosition((modelMatrix*vec4(position,1.0)).xyz),1.0); }`,
          fragmentShader: `uniform float brainTime; varying vec2 vUv; varying float vPhase; varying float vDepth;
            void main() {
              float head = mod(brainTime*.16+vPhase,1.65)-.25;
              float impulse=exp(-pow((vUv.x-head)/.048,2.0));
              float softEdge=pow(sin(vUv.y*3.14159265),2.0);
              float alpha=impulse*softEdge*exp(-vDepth*1.8)*.55;
              gl_FragColor=vec4(vec3(1.0,.81,.60),alpha);
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            }`,
        });
        materials.add(material); root.add(new THREE.Mesh(geometry, material));
      }
      if (disposed || o.signal.aborted) throw new Error('Disposed');
      root.updateMatrixWorld(true); ready = true;
    })();
    promise = thisPromise;
    try { await thisPromise; } catch (error) { release(); throw error; }
    finally { if (promise === thisPromise) promise = undefined; }
  }
  return {
    scene, root, load,
    get ready() { return ready; },
    setInteractive(value: boolean) { touch.setEnabled(value); },
    unload() { if (!disposed && ready) release(); },
    update(dt: number, animated: boolean) { if (animated) time.value += dt; return touch.update(dt) || animated; },
    dispose() {
      if (disposed) return;
      disposed = true; cache = undefined; abort.abort(); o.signal.removeEventListener('abort', abortParent); release();
      touch.dispose();
      key.shadow.dispose();
    },
  };
}

/** Projected size with hysteresis; visibility is checked separately by raycast. */
export function brainProximity(size: number, visible: boolean, wasAvailable: boolean) {
  return visible && Number.isFinite(size) && size >= (wasAvailable ? .22 : .30);
}

export type BrainDetail = ReturnType<typeof createBrainDetail>;
