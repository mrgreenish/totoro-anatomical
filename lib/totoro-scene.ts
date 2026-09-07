import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export type SculptureController = {
  setRotate(value: boolean): void;
  setAnimate(value: boolean): void;
  setNight(value: boolean): void;
  reset(): void;
  dispose(): void;
};
type Options = { signal: AbortSignal; animate: boolean; onReady(): void; onError(): void };
const damp = THREE.MathUtils.damp;

export async function createSculpture(canvas: HTMLCanvasElement, options: Options): Promise<SculptureController> {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 60);
  const initialPosition = new THREE.Vector3(3.5, 4.0, 12.4);
  const initialTarget = new THREE.Vector3(0, 2.30, 0);
  camera.position.copy(initialPosition);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(initialTarget);
  controls.enableDamping = true;
  controls.dampingFactor = .065;
  controls.rotateSpeed = .65;
  controls.zoomSpeed = .65;
  controls.enablePan = false;
  controls.minDistance = 7.3;
  controls.maxDistance = 18;
  controls.minPolarAngle = .45;
  controls.maxPolarAngle = Math.PI / 2.03;
  controls.autoRotateSpeed = .45;
  controls.update();

  // Locally generated studio reflections: no HDR download or third-party assets.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .04);
  scene.environment = environment.texture;
  scene.environmentIntensity = .7;
  room.dispose(); pmrem.dispose();
  const ambient = new THREE.HemisphereLight(0xf8ffe9, 0x778371, .9);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xfff4de, 2.7);
  key.position.set(-3.5, 7, 5); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 6, bottom: -3, near: .5, far: 20 });
  key.shadow.bias = -.0004; key.shadow.normalBias = .025;
  key.target.position.set(0, 2, 0); scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xc7deef, .9);
  fill.position.set(5, 4, 2); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xe8ffc3, 2.5);
  rim.position.set(2, 5, -4); scene.add(rim);

  const plinthMaterial = new THREE.MeshPhysicalMaterial({ color: 0xdbdfcf, roughness: .62, metalness: .03, clearcoat: .2, clearcoatRoughness: .6 });
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(2.13, 2.13, .13, 112), plinthMaterial);
  plinth.position.y = -.095; plinth.receiveShadow = true; scene.add(plinth);
  const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0xd6ddc9, roughness: .6 });
  const lip = new THREE.Mesh(new THREE.TorusGeometry(2.095, .036, 8, 112), edgeMaterial);
  lip.rotation.x = Math.PI / 2; lip.position.y = -.033; scene.add(lip);
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  const ctx = shadowCanvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(30,46,30,0.27)');
  gradient.addColorStop(.48, 'rgba(30,46,30,0.16)');
  gradient.addColorStop(1, 'rgba(30,46,30,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  const groundShadow = new THREE.Mesh(new THREE.PlaneGeometry(6.7, 5.7), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }));
  groundShadow.rotation.x = -Math.PI / 2; groundShadow.position.y = -.19; scene.add(groundShadow);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.4), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, opacity: .65 }));
  contact.rotation.x = -Math.PI / 2; contact.position.set(0, -.024, .04); scene.add(contact);

  const particleGeometry = new THREE.BufferGeometry();
  const particlePositions = new Float32Array(30 * 3);
  let seed = 21;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 30; i++) {
    particlePositions[i * 3] = (random() - .5) * 7;
    particlePositions[i * 3 + 1] = random() * 5.5;
    particlePositions[i * 3 + 2] = (random() - .5) * 4;
  }
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  const particleMaterial = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, opacity: { value: .15 }, size: { value: 1 }, tint: { value: new THREE.Color(0xc4d394) } },
    vertexShader: 'uniform float time; uniform float size; void main(){ vec3 p=position; p.x+=sin(time*.3+position.y*2.)*.16; p.y+=sin(time*.24+position.x)*.18; vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv; gl_PointSize=clamp(32./-mv.z,1.5,4.)*size; }',
    fragmentShader: 'uniform float opacity; uniform vec3 tint; void main(){float d=length(gl_PointCoord-.5); gl_FragColor=vec4(tint,smoothstep(.5,.06,d)*opacity);}',
    transparent: true, depthWrite: false,
  });
  scene.add(new THREE.Points(particleGeometry, particleMaterial));
  const root = new THREE.Group(); scene.add(root);
  let model: THREE.Group | null = null;
  let animated = options.animate, rotating = false, disposed = false, running = false;
  let night = 0, nightTarget = 0, frame = 0, lastTime = 0, elapsed = 0, tilt = 0;
  let lastAzimuth = controls.getAzimuthalAngle(), interactionUntil = 0, resetting = false;
  let earLeft: THREE.Object3D | undefined, earRight: THREE.Object3D | undefined, leaf: THREE.Object3D | undefined;
  let armLeft: THREE.Object3D | undefined, armRight: THREE.Object3D | undefined;
  let catchlights: THREE.Object3D | undefined;
  const blinkObjects: { object: THREE.Object3D; scale: number }[] = [];
  let nextBlink = 3.4, blinkStart = -10;
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.8), slowFrames = 0;
  const dayStage = new THREE.Color(0xdbdfcf), nightStage = new THREE.Color(0x3c5054);
  const dayKey = new THREE.Color(0xfff4de), nightKey = new THREE.Color(0xbddeff);
  const dayRim = new THREE.Color(0xe8ffc3), nightRim = new THREE.Color(0xc3df9b);

  function resize() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height || disposed) return;
    renderer.setPixelRatio(pixelRatio); renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = camera.aspect < .8 ? 30 + (.8 - camera.aspect) * 21 : 30;
    camera.updateProjectionMatrix(); particleMaterial.uniforms.size.value = pixelRatio; wake();
  }
  function wake() {
    if (disposed || options.signal.aborted || document.hidden || running) return;
    running = true; lastTime = performance.now(); frame = requestAnimationFrame(tick);
  }
  function tick(now: number) {
    if (disposed) return;
    const rawDt = (now - lastTime) / 1000, dt = Math.min(rawDt, .05); lastTime = now;
    if (animated) elapsed += dt;
    if (resetting) {
      camera.position.lerp(initialPosition, 1 - Math.exp(-8 * dt));
      controls.target.lerp(initialTarget, 1 - Math.exp(-8 * dt));
      if (camera.position.distanceToSquared(initialPosition) < .00005) resetting = false;
    }
    controls.autoRotate = rotating && now > interactionUntil && !resetting;
    const changed = controls.update(dt);
    const angle = controls.getAzimuthalAngle();
    const delta = Math.atan2(Math.sin(angle - lastAzimuth), Math.cos(angle - lastAzimuth)); lastAzimuth = angle;
    tilt = damp(tilt, animated ? THREE.MathUtils.clamp(delta * 2.7, -.11, .11) : 0, 6, dt);
    const breath = animated ? Math.sin(elapsed * 1.45) : 0;
    root.scale.set(1 + breath * .003, 1 + breath * .005, 1 + breath * .004); root.rotation.z = tilt * .5;
    if (earLeft) earLeft.rotation.z = damp(earLeft.rotation.z, -tilt * 1.8 + (animated ? Math.sin(elapsed * 1.8) * .011 : 0), 8, dt);
    if (earRight) earRight.rotation.z = damp(earRight.rotation.z, -tilt * 2 + (animated ? Math.sin(elapsed * 1.8 + .6) * .012 : 0), 7, dt);
    if (leaf) { leaf.rotation.z = -tilt * 1.6 + (animated ? Math.sin(elapsed * 1.6) * .015 : 0); leaf.rotation.x = animated ? Math.sin(elapsed * 1.2) * .016 : 0; }
    if (armLeft) armLeft.rotation.z = (animated ? Math.sin(elapsed * 1.45) * .012 : 0) - tilt * .3;
    if (armRight) armRight.rotation.z = (animated ? -Math.sin(elapsed * 1.45 + .4) * .012 : 0) - tilt * .3;
    if (animated && elapsed > nextBlink) { blinkStart = elapsed; nextBlink = elapsed + 3.3 + random() * 4; }
    const blinkTime = elapsed - blinkStart;
    const blink = animated && blinkTime < .22 ? 1 - Math.sin(blinkTime / .22 * Math.PI) * .94 : 1;
    for (const eye of blinkObjects) eye.object.scale.y = eye.scale * blink;
    if (catchlights) catchlights.visible = blink > .85;
    particleMaterial.uniforms.time.value = elapsed;
    night = damp(night, nightTarget, 3, dt);
    key.color.copy(dayKey).lerp(nightKey, night); key.intensity = THREE.MathUtils.lerp(2.7, 2.2, night);
    ambient.intensity = THREE.MathUtils.lerp(.9, .3, night);
    rim.color.copy(dayRim).lerp(nightRim, night); rim.intensity = THREE.MathUtils.lerp(2.5, 4.5, night);
    fill.intensity = THREE.MathUtils.lerp(.9, .5, night); scene.environmentIntensity = THREE.MathUtils.lerp(.7, .35, night);
    plinthMaterial.color.copy(dayStage).lerp(nightStage, night); edgeMaterial.color.copy(plinthMaterial.color);
    particleMaterial.uniforms.opacity.value = THREE.MathUtils.lerp(.15, .62, night);
    renderer.render(scene, camera);
    // Adapt only after sustained slow frames, preserving crispness on capable devices.
    if (rawDt > .025 && rawDt < .2 && model) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 100 && pixelRatio > 1.1) { pixelRatio = Math.max(1, pixelRatio - .25); slowFrames = 0; resize(); }
    const settling = Math.abs(night - nightTarget) > .001 || Math.abs(tilt) > .0001 || resetting;
    if (animated || rotating || changed || settling) frame = requestAnimationFrame(tick); else running = false;
  }
  const onStart = () => { interactionUntil = Infinity; resetting = false; wake(); };
  const onEnd = () => { interactionUntil = performance.now() + 1800; wake(); };
  controls.addEventListener('start', onStart); controls.addEventListener('end', onEnd); controls.addEventListener('change', wake);
  const onVisibility = () => { if (document.hidden) { cancelAnimationFrame(frame); running = false; } else wake(); };
  const onContextLost = (event: Event) => { event.preventDefault(); cancelAnimationFrame(frame); running = false; options.onError(); };
  canvas.addEventListener('webglcontextlost', onContextLost); document.addEventListener('visibilitychange', onVisibility);
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas);

  const controller: SculptureController = {
    setRotate(value) { rotating = value; interactionUntil = 0; wake(); },
    setAnimate(value) { animated = value; wake(); },
    setNight(value) { nightTarget = value ? 1 : 0; wake(); },
    reset() { rotating = false; resetting = true; wake(); },
    dispose() {
      if (disposed) return;
      disposed = true; cancelAnimationFrame(frame); resizeObserver.disconnect(); controls.dispose();
      document.removeEventListener('visibilitychange', onVisibility); canvas.removeEventListener('webglcontextlost', onContextLost); canvas.removeEventListener('keydown', onKey);
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
      scene.traverse(object => { if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        geometries.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => materials.add(m));
      } });
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
      environment.dispose(); shadowTexture.dispose(); key.shadow.dispose(); renderer.dispose();
    },
  };
  function onKey(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', '=', 'Home'].includes(event.key)) return;
    event.preventDefault(); resetting = false; interactionUntil = performance.now() + 1800;
    const spherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    if (event.key === 'ArrowLeft') spherical.theta -= .1;
    if (event.key === 'ArrowRight') spherical.theta += .1;
    if (event.key === 'ArrowUp') spherical.phi -= .08;
    if (event.key === 'ArrowDown') spherical.phi += .08;
    if (event.key === '+' || event.key === '=') spherical.radius *= .94;
    if (event.key === '-') spherical.radius *= 1.06;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi, controls.minPolarAngle, controls.maxPolarAngle);
    spherical.radius = THREE.MathUtils.clamp(spherical.radius, controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
    if (event.key === 'Home') controller.reset();
    controls.update(); wake();
  }
  canvas.addEventListener('keydown', onKey); resize();

  try {
    const response = await fetch('/models/totoro.glb?v=grin-2', { signal: options.signal });
    if (!response.ok) throw new Error('Model unavailable');
    const bytes = await response.arrayBuffer();
    if (options.signal.aborted) { controller.dispose(); return controller; }
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes, '/models/');
    model = gltf.scene;
    const materialCache = new Map<string, THREE.MeshPhysicalMaterial>();
    const replacedMaterials = new Set<THREE.Material>();
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const fibers = object.name.includes('fibers');
      object.castShadow = !fibers; object.receiveShadow = !fibers;
      const old = object.material as THREE.MeshStandardMaterial;
      if (/Fur|Belly/.test(old.name)) {
        const cacheKey = `${old.uuid}-${fibers}`;
        let material = materialCache.get(cacheKey);
        if (!material) {
          material = new THREE.MeshPhysicalMaterial({ color: old.color, roughness: .94, sheen: .75, sheenColor: 0xa0ad93, sheenRoughness: .85, side: fibers ? THREE.DoubleSide : THREE.FrontSide });
          material.name = old.name;
          material.onBeforeCompile = shader => {
            shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFurPosition;');
            shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFurPosition = position;');
            shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
              varying vec3 vFurPosition;
              float furHash(vec3 p) { p=fract(p*.3183099+vec3(.1,.2,.3)); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
              float furNoise(vec3 p) { vec3 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(mix(furHash(i),furHash(i+vec3(1,0,0)),f.x),mix(furHash(i+vec3(0,1,0)),furHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(furHash(i+vec3(0,0,1)),furHash(i+vec3(1,0,1)),f.x),mix(furHash(i+vec3(0,1,1)),furHash(i+vec3(1,1,1)),f.x),f.y),f.z); }
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nfloat fuzz=furNoise(vFurPosition*115.); diffuseColor.rgb *= .93+.13*fuzz;');
            shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal=normalize(normal+vec3(dFdx(fuzz),dFdy(fuzz),0.)*.13);');
          };
          material.customProgramCacheKey = () => 'soft-fur-v1'; materialCache.set(cacheKey, material);
        }
        object.material = material; replacedMaterials.add(old);
      }
    });
    replacedMaterials.forEach(material => material.dispose());
    root.add(model); root.updateMatrixWorld(true);
    // Compression recenters meshes; explicit pivots retain natural ear/shoulder motion.
    function pivot(name: string, position: THREE.Vector3) {
      const object = model!.getObjectByName(name); if (!object) return undefined;
      const group = new THREE.Group(); group.position.copy(position); model!.add(group);
      group.updateMatrixWorld(true); group.attach(object); return group;
    }
    earLeft = pivot('Ear_L', new THREE.Vector3(-.72, 3.83, -.045));
    earRight = pivot('Ear_R', new THREE.Vector3(.72, 3.83, -.045));
    armLeft = pivot('Arm_L', new THREE.Vector3(-1.2, 2.6, -.015));
    armRight = pivot('Arm_R', new THREE.Vector3(1.2, 2.6, -.015));
    leaf = model.getObjectByName('Leaf'); catchlights = model.getObjectByName('Eye_catchlights');
    for (const name of ['Eye_L', 'Eye_R', 'Pupil_L', 'Pupil_R']) {
      const object = model.getObjectByName(name); if (object) blinkObjects.push({ object, scale: object.scale.y });
    }
    await renderer.compileAsync(scene, camera);
    if (!options.signal.aborted && !disposed) { renderer.render(scene, camera); options.onReady(); wake(); } else controller.dispose();
  } catch { if (!options.signal.aborted) options.onError(); }
  return controller;
}
