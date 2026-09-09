import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BASE = '/models/brain-detail/';
type NeuralPath = { points: number[][]; phase: number; depth: number };
type Options = { renderer: THREE.WebGLRenderer; environment: THREE.Texture | null; signal: AbortSignal };

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
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const time = { value: 0 };
  let promise: Promise<void> | undefined;
  let ready = false, disposed = false;
  const abort = new AbortController();
  const abortParent = () => abort.abort();
  o.signal.addEventListener('abort', abortParent, { once: true });

  async function get(url: string) {
    const response = await fetch(`${BASE}${url}?v=brain-detail-1`, { signal: abort.signal });
    if (!response.ok) throw new Error('The detailed brain could not load.');
    return response;
  }
  async function texture(name: string, color = false) {
    const blob = await (await get(name)).blob();
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
    root.clear(); geometries.forEach(g => g.dispose()); geometries.clear();
    materials.forEach(m => m.dispose()); materials.clear();
    textures.forEach(t => { t.dispose(); (t.image as ImageBitmap)?.close?.(); }); textures.clear();
    ready = false;
  }
  async function load(width: number) {
    if (ready || disposed) return;
    if (promise) return promise;
    promise = (async () => {
      const size = detailTextureSize(width, o.renderer.capabilities.maxTextureSize);
      // Settle every request before cleanup so a late image decode cannot leak.
      const results = await Promise.allSettled([
        get('brain-detail.glb').then(r => r.arrayBuffer()),
        get('neural-paths.json').then(r => r.json() as Promise<NeuralPath[]>),
        texture(`basecolor-${size}.webp`, true), texture(`normal-${size}.webp`),
        texture('surface.webp'), texture('membrane.webp'), texture('height.png'),
      ] as const);
      const failure = results.find(r => r.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      if (disposed || o.signal.aborted) throw new Error('Disposed');
      const [bytes, paths, color, normal, surface, membrane, height] = results.map(r => (r as PromiseFulfilledResult<unknown>).value) as [ArrayBuffer, NeuralPath[], THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture];
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
          });
          // Three's normalMap takes precedence over bumpMap. Add the height
          // relief explicitly so both independently baked maps contribute.
          material.onBeforeCompile = shader => {
            shader.uniforms.brainMembrane = { value: membrane };
            shader.uniforms.brainHeight = { value: height };
            shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vTissueUv;')
              .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTissueUv = uv;');
            shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vTissueUv;\nuniform sampler2D brainMembrane;\nuniform sampler2D brainHeight;')
              .replace('#include <normal_fragment_maps>', `
                #include <normal_fragment_maps>
                float relief = texture2D(brainHeight, vTissueUv).r * .00065;
                vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
                vec3 rx = cross(dy, normal), ry = cross(normal, dx);
                float determinant = dot(dx, rx);
                normal = normalize(abs(determinant) * normal - sign(determinant) * (dFdx(relief) * rx + dFdy(relief) * ry));
              `).replace('#include <opaque_fragment>', `
                float thickness = texture2D(brainMembrane, vTissueUv).g;
                float grazing = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);
                outgoingLight += vec3(.085, .021, .017) * grazing * (1.0 - thickness);
                #include <opaque_fragment>
              `);
          };
          material.customProgramCacheKey = () => 'brain-detail-tissue-v1';
        }
        material.name = name; materials.add(material);
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
          uniforms: { brainTime: time },
          vertexShader: `attribute float phase; attribute float tissueDepth;
            varying vec2 vUv; varying float vPhase; varying float vDepth;
            void main() { vUv=uv; vPhase=phase; vDepth=tissueDepth;
              gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
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
    try { await promise; } catch (error) { release(); throw error; }
    finally { promise = undefined; }
  }
  return {
    scene, root, load,
    get ready() { return ready; },
    update(dt: number, animated: boolean) { if (animated) time.value += dt; return animated; },
    dispose() {
      if (disposed) return;
      disposed = true; abort.abort(); o.signal.removeEventListener('abort', abortParent); release();
      key.shadow.dispose();
    },
  };
}

/** Projected size with hysteresis; visibility is checked separately by raycast. */
export function brainProximity(size: number, visible: boolean, wasAvailable: boolean) {
  return visible && Number.isFinite(size) && size >= (wasAvailable ? .22 : .30);
}

export type BrainDetail = ReturnType<typeof createBrainDetail>;
