import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createTotoroMotion } from './totoro-motion';
import { createAnatomyExplorer, type AnatomyExplorer } from './totoro-anatomy';
import type { AnatomyMode, AnatomyState, AnatomySystem, AnatomyVariant } from './anatomy-state';
import type { HeartViewOptions } from './heart-detail';
import type { EyeViewOptions } from './eye-optics';
import type { LungSnapshot, LungViewOptions } from './lung-physiology';
import { createSplitShadowCache } from './split-shadow-cache';
import { createRenderPipeline, probeHdrSupport, type GradeName } from './render-pipeline';
import { createForestLight } from './forest-light';
import { createForestAtmosphere } from './forest-atmosphere';
import { createCamphorPlinth } from './camphor-plinth';
import { createSootSprites } from './soot-sprites';
import { createForestRain } from './forest-rain';

export type SculptureController = {
  setRotate(value: boolean): void;
  setAnimate(value: boolean): void;
  setNight(value: boolean): void;
  setRain(value: boolean): void;
  setMode(value: AnatomyMode): Promise<void>;
  setCut(value: Partial<AnatomyState['cut']>): void;
  setExplosion(value: number): void;
  setVisibleSystems(value: AnatomySystem[]): void;
  setAnatomyVariant(value: AnatomyVariant): void;
  selectPart(id: string | null): void;
  openBrainView(entry?: 'contextual' | 'shortcut'): Promise<void>;
  closeBrainView(): void;
  openHeartView(entry?: 'contextual' | 'shortcut'): Promise<void>;
  closeHeartView(): void;
  setHeartViewOptions(options: Partial<HeartViewOptions>): void;
  openEyeView(entry?: 'contextual' | 'shortcut'): Promise<void>;
  closeEyeView(): void;
  setEyeViewOptions(options: Partial<EyeViewOptions>): void;
  openLungView(entry?: 'contextual' | 'shortcut'): Promise<void>;
  closeLungView(): void;
  setLungViewOptions(options: Partial<LungViewOptions>): void;
  getLungSnapshot(): LungSnapshot | undefined;
  reset(): void;
  dispose(): void;
};
type Options = { signal: AbortSignal; animate: boolean; onReady(): void; onError(): void; onAnatomyState?(state: AnatomyState): void };
const damp = THREE.MathUtils.damp;

export async function createSculpture(canvas: HTMLCanvasElement, options: Options): Promise<SculptureController> {
  // The HDR pipeline owns multisampling, so the default framebuffer only
  // receives the final composite. Browsers without float targets keep
  // native antialiasing for direct rendering.
  const hdr = probeHdrSupport();
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: !hdr, stencil: true, powerPreference: 'high-performance' });
  const collectRenderStats = process.env.NODE_ENV !== 'production';
  // Keep the normal renderer fast in production. Development diagnostics use
  // manual resets so the counters include the shadow pass as well as the main
  // scene render.
  renderer.info.autoReset = !collectRenderStats;
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  const splitShadowCache = createSplitShadowCache(renderer.shadowMap);
  // PCF avoids variance-shadow light leaks through thin ribs and close tissue.
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const createdPipeline = hdr ? createRenderPipeline(renderer) : undefined;
  const pipeline = createdPipeline?.supported ? createdPipeline : undefined;
  if (!pipeline) createdPipeline?.dispose();
  canvas.dataset.pipeline = pipeline ? 'hdr' : 'direct';
  // The forest wakes gently: exposure rises once the sculpture is ready.
  pipeline?.setExposureScale(options.animate ? .3 : 1, true);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 100);
  const cameraRadius = Math.hypot(3.5, 12.4), cameraAzimuth = THREE.MathUtils.degToRad(25);
  const initialPosition = new THREE.Vector3(Math.sin(cameraAzimuth) * cameraRadius, 4.0, Math.cos(cameraAzimuth) * cameraRadius);
  const initialTarget = new THREE.Vector3(0, 2.30, 0);
  camera.position.copy(initialPosition);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(initialTarget);
  controls.enableDamping = true;
  controls.dampingFactor = .052;
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
  scene.environmentIntensity = .48;
  room.dispose(); pmrem.dispose();
  const ambient = new THREE.HemisphereLight(0xf8ffe9, 0x778371, .45);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xfff4de, 2.7);
  key.position.set(-3.5, 7, 5); key.castShadow = true;
  key.shadow.autoUpdate = false; key.shadow.needsUpdate = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 6, bottom: -3, near: .5, far: 20 });
  key.shadow.bias = -.00015; key.shadow.normalBias = .018;
  key.shadow.radius = 4; key.shadow.blurSamples = 8;
  key.target.position.set(0, 2, 0); scene.add(key, key.target);
  // Komorebi: the key light reaches the exterior through a swaying canopy.
  const forest = createForestLight(key.position, key.target.position);
  const fill = new THREE.DirectionalLight(0xc7deef, .48);
  fill.position.set(5, 4, 2); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xddeafa, 3.0);
  rim.position.set(2, 5, -4); scene.add(rim);

  const plinth = createCamphorPlinth(forest);
  scene.add(plinth.mesh);
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

  let seed = 21;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const mobile = window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 600;
  const atmosphere = createForestAtmosphere({ scene, camera, forest, mobile });
  const soot = createSootSprites({ scene, camera, canvas, mobile });
  const rain = createForestRain({ scene, camera, mobile, lightDirection: forest.direction });
  let raining = false;
  const root = new THREE.Group(); scene.add(root);
  let model: THREE.Group | null = null;
  let anatomy: AnatomyExplorer | undefined;
  let lastShadowRevision = -1, exteriorWasMoving = false;
  let animated = options.animate, rotating = false, disposed = false, running = false;
  let night = 0, nightTarget = 0, frame = 0, lastTime = 0, elapsed = 0;
  let lastAzimuth = controls.getAzimuthalAngle(), interactionUntil = 0, resetting = false;
  let lastPolar = controls.getPolarAngle();
  const motion = createTotoroMotion();
  let earLeft: THREE.Object3D | undefined, earRight: THREE.Object3D | undefined, leaf: THREE.Object3D | undefined;
  let armLeft: THREE.Object3D | undefined, armRight: THREE.Object3D | undefined;
  let breathBone: THREE.Object3D | undefined, tailBone: THREE.Object3D | undefined;
  const eyelids: { mesh: THREE.Mesh; index: number }[] = [];
  const restRotations = new Map<THREE.Object3D, THREE.Quaternion>();
  const localRotation = new THREE.Quaternion();
  const bendAxis = new THREE.Vector3(0, 0, 1);
  const leafTilt = new THREE.Euler();
  function bend(object: THREE.Object3D | undefined, angle: number) {
    if (!object) return;
    const rest = restRotations.get(object);
    if (rest) object.quaternion.copy(rest).multiply(localRotation.setFromAxisAngle(bendAxis, angle));
  }
  type FrameSample = { frameMs: number; updateMs: number; renderMs: number; drawCalls: number; triangles: number };
  const frameSamples: FrameSample[] = [];
  let statsAsset: string | undefined;
  function resetFrameStats() { frameSamples.length = 0; statsAsset = undefined; delete canvas.dataset.renderStats; }
  function currentAsset() {
    return anatomy?.state.lungView.status === 'open' ? 'lung-study-1'
      : anatomy?.state.eyeView.status === 'open' ? 'eye-study-1'
      : anatomy?.state.heartView.status === 'open' ? 'heart-study-1'
      : anatomy?.state.brainView.status === 'open' ? 'brain-detail-1' : 'refinement-1';
  }
  let nextBlink = 3.4, blinkStart = -10, pokeTime = -10, leafRestY = 0;
  // Preserve the gallery's sharpness target even under load. Optimize repeated
  // work instead of silently reducing resolution or HDR multisampling.
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.8);
  const dayKey = new THREE.Color(0xfff4de), nightKey = new THREE.Color(0xbddeff);
  const dayRim = new THREE.Color(0xddeafa), nightRim = new THREE.Color(0xc3df9b), rainKey = new THREE.Color(0xd9e4ee);

  let viewportWidth = 0, viewportHeight = 0;
  function resize() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height || disposed) return;
    const viewportChanged = width !== viewportWidth || height !== viewportHeight;
    const previousPixelRatio = renderer.getPixelRatio();
    viewportWidth = width; viewportHeight = height;
    renderer.setPixelRatio(pixelRatio); renderer.setSize(width, height, false);
    if (viewportChanged || previousPixelRatio !== pixelRatio) resetFrameStats();
    camera.aspect = width / height;
    camera.fov = camera.aspect < .8 ? 30 + (.8 - camera.aspect) * 21 : 30;
    camera.updateProjectionMatrix();
    if (viewportChanged) anatomy?.resize();
    wake();
  }
  function wake() {
    if (disposed || options.signal.aborted || document.hidden || running) return;
    running = true; lastTime = performance.now(); frame = requestAnimationFrame(tick);
  }
  function tick(now: number) {
    if (disposed) return;
    const frameStart = performance.now();
    // A frame timestamp can precede the wake time under load; never step backwards.
    const rawDt = (now - lastTime) / 1000, dt = THREE.MathUtils.clamp(rawDt, 0, .05); lastTime = now;
    const movingCharacter = animated && !anatomy?.active;
    if (movingCharacter) elapsed += dt;
    if (resetting) {
      camera.position.lerp(initialPosition, 1 - Math.exp(-8 * dt));
      controls.target.lerp(initialTarget, 1 - Math.exp(-8 * dt));
      if (camera.position.distanceToSquared(initialPosition) < .00005) resetting = false;
    }
    // OrbitControls' damping factor is per update; normalize the render updates
    // to elapsed time so release glide does not speed up on high-refresh screens.
    controls.dampingFactor = 1 - Math.exp(-3.2 * Math.max(dt, .001));
    controls.autoRotate = rotating && !anatomy?.active && now > interactionUntil && !resetting;
    const changed = controls.update(dt);
    const angle = controls.getAzimuthalAngle();
    const delta = Math.atan2(Math.sin(angle - lastAzimuth), Math.cos(angle - lastAzimuth)); lastAzimuth = angle;
    const polar = controls.getPolarAngle(), polarDelta = polar - lastPolar; lastPolar = polar;
    if (movingCharacter && !resetting) motion.update(delta / Math.max(dt, .001), polarDelta / Math.max(dt, .001), dt);
    else motion.update(0, 0, dt);
    const breath = movingCharacter ? Math.sin(elapsed * 1.45) : 0;
    if (model) {
      model.rotation.set(motion.pitch.position, motion.yaw.position, motion.lean.position);
    }
    // A poke answers with a springy squash that settles within a second.
    const pokeAge = elapsed - pokeTime;
    const boing = movingCharacter && pokeAge >= 0 && pokeAge < 1.8 ? Math.exp(-pokeAge * 4.2) * Math.sin(pokeAge * 17) : 0;
    if (breathBone) breathBone.scale.set(1 + breath * .013 - boing * .016, 1 + breath * .004 + boing * .022, 1 + breath * .016 - boing * .016);
    if (leaf) leaf.position.y = leafRestY + (boing ? Math.max(0, Math.sin(pokeAge * 8.5)) * Math.exp(-pokeAge * 3.2) * .05 : 0);
    // Gusts from the forest lean the ears and flutter the leaf hat.
    const gust = movingCharacter ? atmosphere.wind - .45 : 0;
    bend(earLeft, motion.ears.position + (movingCharacter ? Math.sin(elapsed * 1.8) * .016 : 0) + gust * (.012 + .006 * Math.sin(elapsed * 3.1)));
    bend(earRight, motion.ears.position * 1.13 + (movingCharacter ? Math.sin(elapsed * 1.8 + .6) * .019 : 0) + gust * (.014 + .006 * Math.sin(elapsed * 2.7 + 1)));
    if (leaf && restRotations.has(leaf)) {
      // Keep the hat attached: flutter around its authored pose, with enough
      // clearance and bounded tilt to keep the blade out of the crown.
      leafTilt.set(
        THREE.MathUtils.clamp(-motion.pitch.position * .45 + (movingCharacter ? Math.sin(elapsed * 1.2) * .009 : 0), -.025, .025),
        0, THREE.MathUtils.clamp(motion.leaf.position * .3 + (movingCharacter ? Math.sin(elapsed * 1.6) * .012 : 0) + gust * .012 * Math.sin(elapsed * 4.7), -.035, .035));
      leaf.quaternion.copy(restRotations.get(leaf)!).multiply(localRotation.setFromEuler(leafTilt));
    }
    bend(armLeft, (movingCharacter ? Math.sin(elapsed * 1.45) * .017 : 0) + motion.arms.position);
    bend(armRight, (movingCharacter ? -Math.sin(elapsed * 1.45 + .4) * .017 : 0) + motion.arms.position);
    bend(tailBone, -motion.yaw.position * .26 + (movingCharacter ? Math.sin(elapsed * .9 + 1) * .020 : 0));
    if (movingCharacter && elapsed > nextBlink) { blinkStart = elapsed; nextBlink = elapsed + 3.3 + random() * 4; }
    const blinkTime = elapsed - blinkStart;
    // Fast closure, a brief full closure, then a softer reopening.
    const blink = !movingCharacter || blinkTime < 0 || blinkTime > .28 ? 0
      : blinkTime < .09 ? THREE.MathUtils.smoothstep(blinkTime, 0, .09)
      : blinkTime < .12 ? 1 : 1 - THREE.MathUtils.smoothstep(blinkTime, .12, .28);
    for (const lid of eyelids) lid.mesh.morphTargetInfluences![lid.index] = blink;
    night = damp(night, nightTarget, 3, dt);
    key.color.copy(dayKey).lerp(nightKey, night); key.intensity = THREE.MathUtils.lerp(2.7, 2.2, night);
    ambient.intensity = THREE.MathUtils.lerp(.45, .25, night);
    rim.color.copy(dayRim).lerp(nightRim, night); rim.intensity = THREE.MathUtils.lerp(3.0, 4.5, night);
    fill.intensity = THREE.MathUtils.lerp(.48, .4, night); scene.environmentIntensity = THREE.MathUtils.lerp(.48, .28, night);
    plinth.setNight(night);
    const rainSettling = rain.update(dt, { animated: movingCharacter, raining, visible: !anatomy?.active, night,
      wind: atmosphere.wind, viewportWidth: canvas.width, viewportHeight: canvas.height });
    // Overcast: the sun hides behind cloud and the sky does more of the lighting.
    const overcast = rain.level;
    key.intensity *= 1 - .55 * overcast; key.color.lerp(rainKey, overcast * .5);
    ambient.intensity += .2 * overcast * (1 - .5 * night);
    rim.intensity *= 1 - .35 * overcast;
    scene.environmentIntensity += .1 * overcast * (1 - night);
    plinth.setWeather(rain.wetness, rain.level, rain.time);
    const anatomySettling = anatomy?.update(dt, animated) ?? false;
    if (anatomy?.active) {
      // Neutral studio light preserves red/brown tissue separation. A lower
      // fill keeps fissures and overlapping organs dimensional; the environment
      // supplies broad, restrained reflections on the moist capsules.
      key.color.set(0xfff7f0); key.intensity = 2.35;
      fill.color.set(0xdce7f5); fill.intensity = .42;
      ambient.color.set(0xf3f5fa); ambient.groundColor.set(0x514a43); ambient.intensity = .22;
      rim.color.set(0xe4edff); rim.intensity = 1.65;
      scene.environmentIntensity = .46;
      renderer.toneMappingExposure = 1;
      key.shadow.normalBias = .004;
    } else {
      key.shadow.normalBias = .018;
      fill.color.set(0xc7deef);
      ambient.color.set(0xf8ffe9); ambient.groundColor.set(0x778371);
      renderer.toneMappingExposure = 1.05;
    }
    // Keep the spread-out muscle and vessel layers inside the shadow volume.
    const shadowExtent = anatomy?.active ? 8 : 4;
    if (key.shadow.camera.right !== shadowExtent) {
      key.shadow.camera.left = -shadowExtent; key.shadow.camera.right = shadowExtent;
      key.shadow.camera.updateProjectionMatrix();
      key.shadow.needsUpdate = true;
    }
    // Camera motion and color/exposure changes do not change light-space
    // depth. Keep full-resolution shadows until an actual caster pose, cut,
    // filter or layout changes; include the final frame as motion settles.
    const exteriorMoving = movingCharacter || motion.settling;
    const shadowRevision = anatomy?.shadowRevision ?? 0;
    if (exteriorMoving || exteriorWasMoving || shadowRevision !== lastShadowRevision) key.shadow.needsUpdate = true;
    exteriorWasMoving = exteriorMoving; lastShadowRevision = shadowRevision;
    const splitShadowsEligible = anatomy?.state.mode === 'split'
      && !anatomy.detailScene;
    splitShadowCache.update(splitShadowsEligible, changed);
    const study = anatomy?.state.brainView.status === 'open' ? 'brain' : anatomy?.state.heartView.status === 'open' ? 'heart'
      : anatomy?.state.eyeView.status === 'open' ? 'eye' : anatomy?.state.lungView.status === 'open' ? 'lung' : undefined;
    const grade: GradeName = study ?? (anatomy?.active ? 'anatomy' : night > .5 ? 'night' : rain.level > .5 ? 'rain' : 'day');
    pipeline?.setGrade(grade);
    const grading = pipeline?.update(dt) ?? false;
    const atmosphereSettling = atmosphere.update(dt, { animated: movingCharacter, night, visible: !anatomy?.active,
      pixelRatio: renderer.getPixelRatio(), viewportWidth: canvas.width, viewportHeight: canvas.height,
      rain: rain.level, wetness: rain.wetness });
    const sootSettling = soot.update(dt, { animated: movingCharacter, visible: !anatomy?.active, night, rain: rain.level });
    const renderStart = performance.now();
    if (collectRenderStats) renderer.info.reset();
    renderFrame(anatomy?.detailScene ?? scene);
    const renderMs = performance.now() - renderStart;
    const updateMs = renderStart - frameStart;
    if (collectRenderStats && model && rawDt > 0) {
      const asset = currentAsset();
      if (statsAsset !== asset) resetFrameStats();
      statsAsset = asset;
      frameSamples.push({ frameMs: rawDt * 1000, updateMs, renderMs,
        drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
      if (frameSamples.length === 180) {
        const sortedFrames = [...frameSamples].sort((a, b) => a.frameMs - b.frameMs);
        const sortedUpdates = [...frameSamples].sort((a, b) => a.updateMs - b.updateMs);
        const sortedRenders = [...frameSamples].sort((a, b) => a.renderMs - b.renderMs);
        const last = frameSamples[frameSamples.length - 1];
        canvas.dataset.renderStats = JSON.stringify({ medianMs: sortedFrames[90].frameMs, p95Ms: sortedFrames[171].frameMs,
          updateMedianMs: sortedUpdates[90].updateMs, updateP95Ms: sortedUpdates[171].updateMs,
          renderMedianMs: sortedRenders[90].renderMs, renderP95Ms: sortedRenders[171].renderMs,
          triangles: last.triangles, drawCalls: last.drawCalls, shadowIncluded: true,
          pixelRatio: renderer.getPixelRatio(), samples: pipeline?.target.samples ?? 0, mode: anatomy?.state.mode,
          studyMode: anatomy?.state.lungView.status === 'open' ? anatomy.getLungSnapshot()?.mode : undefined,
          width: canvas.clientWidth, height: canvas.clientHeight, eyelids: eyelids.length,
          rig: !!breathBone, asset });
        frameSamples.length = 0;
      }
    }
    if (collectRenderStats) renderer.info.reset();
    const settling = Math.abs(night - nightTarget) > .001 || motion.settling || resetting || anatomySettling || grading || atmosphereSettling || sootSettling || rainSettling;
    if (movingCharacter || (rotating && !anatomy?.active) || changed || settling) frame = requestAnimationFrame(tick); else running = false;
  }
  function renderFrame(target: THREE.Scene) {
    if (pipeline) pipeline.render(target, camera);
    else renderer.render(target, camera);
  }
  const onStart = () => {
    interactionUntil = Infinity;
    resetting = false;
    anatomy?.stopCameraMotion();
    splitShadowCache.begin(
      anatomy?.state.mode === 'split' && !anatomy.detailScene,
    );
    wake();
  };
  const onEnd = () => {
    interactionUntil = performance.now() + 1800;
    splitShadowCache.end();
    wake();
  };
  controls.addEventListener('start', onStart); controls.addEventListener('end', onEnd); controls.addEventListener('change', wake);
  // Tap Totoro to say hello: he blinks and bounces, and the forest answers.
  const pokeRay = new THREE.Raycaster(), pokePointer = new THREE.Vector2();
  const bodyCenter = new THREE.Vector3(0, 1.95, .05), bodyRadii = new THREE.Vector3(1.2, 2.05, 1.1);
  const rayOrigin = new THREE.Vector3(), rayDirection = new THREE.Vector3();
  let pokeStart: { x: number; y: number; time: number; id: number } | undefined;
  const onPokeDown = (event: PointerEvent) => { if (event.isPrimary) pokeStart = { x: event.clientX, y: event.clientY, time: performance.now(), id: event.pointerId }; };
  const onPokeUp = (event: PointerEvent) => {
    const start = pokeStart; pokeStart = undefined;
    if (!start || start.id !== event.pointerId || !animated || anatomy?.active || !model) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6 || performance.now() - start.time > 500) return;
    const rect = canvas.getBoundingClientRect();
    pokePointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    pokeRay.setFromCamera(pokePointer, camera);
    // Ray against an ellipsoid hugging the body and head.
    rayOrigin.copy(pokeRay.ray.origin).sub(bodyCenter).divide(bodyRadii);
    rayDirection.copy(pokeRay.ray.direction).divide(bodyRadii);
    const a = rayDirection.lengthSq(), b = 2 * rayOrigin.dot(rayDirection), c = rayOrigin.lengthSq() - 1;
    if (b * b - 4 * a * c < 0 || -b + Math.sqrt(b * b - 4 * a * c) < 0) return;
    pokeTime = elapsed; blinkStart = elapsed; nextBlink = elapsed + 2.8;
    motion.ears.velocity += 2.4; motion.leaf.velocity += 1.8; motion.arms.velocity -= .9; motion.pitch.velocity -= .3;
    atmosphere.poke();
    wake();
  };
  canvas.addEventListener('pointerdown', onPokeDown, { passive: true });
  canvas.addEventListener('pointerup', onPokeUp, { passive: true });
  const onVisibility = () => { if (document.hidden) { cancelAnimationFrame(frame); running = false; } else wake(); };
  const onContextLost = (event: Event) => { event.preventDefault(); cancelAnimationFrame(frame); running = false; options.onError(); };
  canvas.addEventListener('webglcontextlost', onContextLost); document.addEventListener('visibilitychange', onVisibility);
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas);

  const controller: SculptureController = {
    setRotate(value) { rotating = value; interactionUntil = 0; wake(); },
    setAnimate(value) { animated = value; anatomy?.setAnimate(value); if (!value) motion.reset(); wake(); },
    setNight(value) { nightTarget = value ? 1 : 0; wake(); },
    setRain(value) { raining = value; wake(); },
    async setMode(value) { resetting = false; motion.reset(); resetFrameStats(); await anatomy?.setMode(value); wake(); },
    setCut(value) { resetFrameStats(); anatomy?.setCut(value); },
    setExplosion(value) { resetFrameStats(); anatomy?.setExplosion(value); },
    setVisibleSystems(value) { resetFrameStats(); anatomy?.setVisibleSystems(value); },
    setAnatomyVariant(value) { resetFrameStats(); anatomy?.setAnatomyVariant(value); renderer.shadowMap.needsUpdate = true; },
    selectPart(id) { anatomy?.selectPart(id); },
    async openBrainView(entry) { resetting = false; resetFrameStats(); await anatomy?.openBrainView(entry); wake(); },
    closeBrainView() { resetFrameStats(); anatomy?.closeBrainView(); wake(); },
    async openHeartView(entry) { resetting = false; resetFrameStats(); await anatomy?.openHeartView(entry); wake(); },
    closeHeartView() { resetFrameStats(); anatomy?.closeHeartView(); wake(); },
    setHeartViewOptions(value) { resetFrameStats(); anatomy?.setHeartViewOptions(value); wake(); },
    async openEyeView(entry) { resetting = false; resetFrameStats(); await anatomy?.openEyeView(entry); wake(); },
    closeEyeView() { resetFrameStats(); anatomy?.closeEyeView(); wake(); },
    setEyeViewOptions(value) { resetFrameStats(); anatomy?.setEyeViewOptions(value); wake(); },
    async openLungView(entry) { resetting = false; resetFrameStats(); await anatomy?.openLungView(entry); wake(); },
    closeLungView() { resetFrameStats(); anatomy?.closeLungView(); wake(); },
    setLungViewOptions(value) { resetFrameStats(); anatomy?.setLungViewOptions(value); wake(); },
    getLungSnapshot() { return anatomy?.getLungSnapshot(); },
    reset() { rotating = false; resetting = true; anatomy?.reset(); motion.reset(); wake(); },
    dispose() {
      if (disposed) return;
      disposed = true; cancelAnimationFrame(frame); resizeObserver.disconnect(); controls.dispose();
      anatomy?.dispose();
      atmosphere.dispose(); soot.dispose(); rain.dispose(); plinth.dispose(); forest.dispose();
      document.removeEventListener('visibilitychange', onVisibility); canvas.removeEventListener('webglcontextlost', onContextLost); canvas.removeEventListener('keydown', onKey);
      canvas.removeEventListener('pointerdown', onPokeDown); canvas.removeEventListener('pointerup', onPokeUp);
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
      const skeletons = new Set<THREE.Skeleton>();
      scene.traverse(object => { if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        geometries.add(object.geometry); (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => materials.add(m));
        if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
      } });
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
      skeletons.forEach(s => s.dispose());
      environment.dispose(); shadowTexture.dispose(); key.shadow.dispose();
      splitShadowCache.dispose();
      pipeline?.dispose();
      renderer.dispose();
    },
  };
  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape' && anatomy?.detailScene) {
      event.preventDefault(); controller.closeBrainView(); return;
    }
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
    const response = await fetch('/models/totoro.glb?v=fur-1', { signal: options.signal });
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
      if (/Fur|Belly|Seven chevrons/.test(old.name)) {
        const cacheKey = `${old.uuid}-${fibers}`;
        let material = materialCache.get(cacheKey);
        if (!material) {
          const ivory = old.name.includes('Belly');
          material = new THREE.MeshPhysicalMaterial({
            color: old.color, vertexColors: object.geometry.hasAttribute('color'),
            roughness: fibers ? .91 : .96, metalness: 0,
            sheen: fibers ? .72 : .40, sheenColor: ivory ? 0xd6ceac : 0x8e9a94,
            sheenRoughness: .9, side: fibers ? THREE.DoubleSide : THREE.FrontSide,
          });
          material.name = old.name;
          // Strands carry their own root-to-tip color, so only the skin beneath the
          // coat gets procedural fur detail. Skipping it on the strands keeps their
          // many small fragments cheap.
          if (!fibers) material.onBeforeCompile = shader => {
            shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFurPosition;');
            shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFurPosition = position;');
            shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
              varying vec3 vFurPosition;
              float furHash(vec3 p) { p=fract(p*.3183099+vec3(.1,.2,.3)); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
              float furNoise(vec3 p) { vec3 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(mix(furHash(i),furHash(i+vec3(1,0,0)),f.x),mix(furHash(i+vec3(0,1,0)),furHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(furHash(i+vec3(0,0,1)),furHash(i+vec3(1,0,1)),f.x),mix(furHash(i+vec3(0,1,1)),furHash(i+vec3(1,1,1)),f.x),f.y),f.z); }
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
              // Two octaves stretched along the downward groom: combed streaks that
              // read at gallery distance, and finer strands for close views. Each
              // fades out once it drops below a pixel, so orbiting never crawls.
              vec3 combed = vFurPosition * vec3(62., 13., 62.);
              vec3 strands = vFurPosition * vec3(190., 40., 190.);
              float sway = furNoise(vFurPosition * 7.);
              float readsCombed = 1. - smoothstep(.5, 2., length(fwidth(combed)));
              float readsStrands = 1. - smoothstep(.45, 1.8, length(fwidth(strands)));
              float fuzz = .6 * mix(.5, furNoise(combed + vec3(0., 0., sway * 2.)), readsCombed)
                         + .4 * mix(.5, furNoise(strands + vec3(0., 0., sway * 1.4)), readsStrands);
              diffuseColor.rgb *= .96 + .36 * (fuzz - .5);
            `);
            shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
              vec3 sigmaX = normalize(dFdx(-vViewPosition));
              vec3 sigmaY = normalize(dFdy(-vViewPosition));
              vec3 r1 = cross(sigmaY, normal), r2 = cross(normal, sigmaX);
              float determinant = dot(sigmaX, r1) * faceDirection;
              vec3 gradient = sign(determinant) * (dFdx(fuzz) * r1 + dFdy(fuzz) * r2);
              normal = normalize(max(abs(determinant), .00001) * normal - gradient * .11);
            `);
          };
          material.customProgramCacheKey = () => `groomed-fur-v4-${fibers}`; materialCache.set(cacheKey, material);
        }
        object.material = material; replacedMaterials.add(old);
      }
    });
    replacedMaterials.forEach(material => material.dispose());
    // Every lit exterior surface shares the canopy light and firefly glow.
    const forestMaterials = new Set<THREE.Material>();
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material instanceof THREE.MeshStandardMaterial && !forestMaterials.has(material)) { forestMaterials.add(material); forest.patch(material); }
      }
    });
    root.add(model); root.updateMatrixWorld(true); key.shadow.needsUpdate = true;
    // Paws and their claws/fur stay on the plinth while the heavy torso settles.
    for (const name of ['Foot_L', 'Foot_R']) {
      const foot = model.getObjectByName(name); if (foot) root.attach(foot);
    }
    earLeft = model.getObjectByName('EarBend_L'); earRight = model.getObjectByName('EarBend_R');
    armLeft = model.getObjectByName('ArmSwing_L'); armRight = model.getObjectByName('ArmSwing_R');
    breathBone = model.getObjectByName('Breath'); tailBone = model.getObjectByName('TailSway');
    for (const object of [earLeft, earRight, armLeft, armRight, tailBone]) {
      if (object) restRotations.set(object, object.quaternion.clone());
    }
    leaf = model.getObjectByName('Leaf');
    if (leaf) { restRotations.set(leaf, leaf.quaternion.clone()); leaf.position.y += .10; leafRestY = leaf.position.y; }
    for (const name of ['Eyelids_L', 'Eyelids_R']) {
      const object = model.getObjectByName(name);
      if (object instanceof THREE.Mesh && object.morphTargetDictionary?.Blink !== undefined) {
        eyelids.push({ mesh: object, index: object.morphTargetDictionary.Blink });
        object.morphTargetInfluences![object.morphTargetDictionary.Blink] = 0;
      }
    }
    anatomy = createAnatomyExplorer({ canvas, renderer, scene, camera, controls, exterior: root,
      signal: options.signal, animate: animated, wake, onState: state => options.onAnatomyState?.(state), onMode: () => motion.reset() });
    // Warm the rain and firefly shaders too, so the first shower or night does not hitch.
    atmosphere.prepareCompile(); rain.prepareCompile();
    const compilation = pipeline ? pipeline.compile(scene, camera) : renderer.compileAsync(scene, camera);
    renderer.getContext().flush(); wake();
    await compilation;
    if (!options.signal.aborted && !disposed) { renderFrame(scene); pipeline?.setExposureScale(1); options.onReady(); wake(); } else controller.dispose();
  } catch (error) {
    if (!options.signal.aborted) {
      if (process.env.NODE_ENV !== 'production') console.error('Sculpture loading failed', error);
      options.onError();
    }
  }
  return controller;
}
