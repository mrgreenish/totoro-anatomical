import * as THREE from 'three';

/**
 * Susuwatari: a small colony of soot sprites living on the plinth. They blink,
 * watch the pointer, and scatter in squashy hops when it comes close. Each is
 * a camera-facing card whose fuzzy outline, eyes and fake-sphere shading are
 * drawn in the fragment shader; alpha-to-coverage keeps the fuzz order-free
 * under the pipeline's MSAA.
 */
type Options = { scene: THREE.Scene; camera: THREE.PerspectiveCamera; canvas: HTMLCanvasElement; mobile: boolean };
export type SootFrame = { animated: boolean; visible: boolean; night: number; rain: number };

const TOP = -.03, RIM = 1.93, FEET = 1.08;
type Sprite = {
  x: number; z: number; homeX: number; homeZ: number; shelterX: number; shelterZ: number; radius: number; seed: number;
  hop: number; hopDuration: number; hopHeight: number; fromX: number; fromZ: number; toX: number; toZ: number;
  height: number; squash: number; squashVelocity: number; blink: number; nextBlink: number;
  lookX: number; lookY: number; fear: number; nextIdle: number;
  screenX: number; screenY: number; screenRadius: number;
};

const VERTEX = /* glsl */`
  attribute vec4 sprite; attribute vec4 spriteState; attribute vec2 spriteLook;
  varying vec2 vLocal; varying vec4 vState; varying vec2 vLook; varying float vSeed;
  void main() {
    // Camera-aligned card; squash widens and lowers, stretch narrows and lifts.
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float squash = spriteState.y;
    vec2 local = position.xy * 2.9;
    vec3 world = sprite.xyz + (right * local.x * (1. - squash * .45) + up * (local.y * (1. + squash) + squash * .9)) * sprite.w;
    vLocal = local; vState = spriteState; vLook = spriteLook; vSeed = spriteState.z;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.);
  }
`;

const FRAGMENT = /* glsl */`
  uniform float time; uniform float night; uniform vec3 lightDirection;
  varying vec2 vLocal; varying vec4 vState; varying vec2 vLook; varying float vSeed;
  float sootHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float sootNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(sootHash(i), sootHash(i + vec2(1, 0)), f.x), mix(sootHash(i + vec2(0, 1)), sootHash(i + vec2(1, 1)), f.x), f.y);
  }
  float eye(vec2 q, vec2 center, float blink) {
    vec2 e = (q - center) / vec2(.25, .27 * max(1. - blink, .06));
    return 1. - smoothstep(.82, 1., length(e));
  }
  void main() {
    vec2 q = vLocal;
    float r = length(q), a = atan(q.y, q.x);
    float jitter = time * (2.4 + vState.w * 6.);
    // Lumpy body, a slowly boiling outline and long stray hairs.
    float outline = .84 + .1 * sootNoise(vec2(a * 2.6 + vSeed * 7., jitter * .5)) + .07 * sootNoise(vec2(a * 7. - vSeed * 3., jitter));
    float spikes = pow(sootNoise(vec2(a * 31. + vSeed * 13., vSeed + jitter * .15)), 2.) * .55;
    float core = 1. - smoothstep(outline - .07, outline + .015, r);
    float strands = smoothstep(.35, .85, sootNoise(vec2(a * 110. + vSeed * 29., r * 2.5 + jitter * .2)));
    float fringe = (1. - smoothstep(outline, outline + .06 + spikes, r)) * strands;
    float alpha = clamp(core + fringe * .85, 0., 1.);
    if (alpha < .03) discard;
    vec2 sphere = q / max(outline, .5);
    vec3 normal = vec3(sphere, sqrt(max(0., 1. - dot(sphere, sphere))));
    float light = max(dot(normal, lightDirection), 0.);
    float rim = pow(1. - normal.z, 2.5);
    vec3 color = vec3(.011, .010, .012) * (.55 + .7 * light) + vec3(.07, .075, .085) * rim * (.4 + .6 * light) * (1. - core * .5);
    color += vec3(.02) * sootNoise(q * 22. + vSeed) * core;
    // Big round eyes with pinprick pupils that follow the pointer.
    float blink = vState.x;
    vec2 left = vec2(-.31, .16), right = vec2(.31, .16);
    float whites = max(eye(q, left, blink), eye(q, right, blink));
    vec2 look = vLook * vec2(.1, .085);
    float pupil = max(1. - smoothstep(.07, .1, length(q - left - look)), 1. - smoothstep(.07, .1, length(q - right - look)));
    float glint = max(1. - smoothstep(.025, .045, length(q - left - vec2(-.07, .08))), 1. - smoothstep(.025, .045, length(q - right - vec2(-.07, .08))));
    vec3 white = mix(vec3(.82, .82, .78), vec3(1.25, 1.3, 1.2), night);
    color = mix(color, white, whites);
    color = mix(color, vec3(.004), pupil * whites);
    color += vec3(1.4) * glint * whites * (1. - pupil);
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createSootSprites(o: Options) {
  const count = o.mobile ? 6 : 9;
  let seed = 41;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const sprites: Sprite[] = [];
  // Two little huddles near the front of the plinth, plus a few loners.
  const huddles = [[.72, 1.62], [1.72, 1.55], [2.55, 1.7], [-.35, 1.66]];
  for (let i = 0; i < count; i++) {
    const huddle = huddles[i % huddles.length];
    const angle = huddle[0] + (random() - .5) * .34, radius = huddle[1] + (random() - .5) * .22;
    const x = Math.sin(angle) * radius, z = Math.cos(angle) * radius;
    // In a shower they crowd in at Totoro's feet, under the overhang of his belly.
    const shelterAngle = -.85 + 2.1 * (i / Math.max(1, count - 1)) + (random() - .5) * .12, shelterRadius = 1.12 + random() * .1;
    sprites.push({ x, z, homeX: x, homeZ: z, shelterX: Math.sin(shelterAngle) * shelterRadius, shelterZ: Math.cos(shelterAngle) * shelterRadius,
      radius: .11 + random() * .035, seed: random() * 10,
      hop: -1, hopDuration: .25, hopHeight: 0, fromX: x, fromZ: z, toX: x, toZ: z, height: 0,
      squash: 0, squashVelocity: 0, blink: 0, nextBlink: 1 + random() * 4, lookX: 0, lookY: 0,
      fear: 0, nextIdle: 2 + random() * 6, screenX: 0, screenY: 0, screenRadius: 0 });
  }

  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  const spriteAttribute = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const stateAttribute = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const lookAttribute = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('sprite', spriteAttribute);
  geometry.setAttribute('spriteState', stateAttribute);
  geometry.setAttribute('spriteLook', lookAttribute);
  geometry.instanceCount = count;
  // A fixed upper-left light in view space keeps the fuzz readable from any orbit.
  const lightDirection = new THREE.Vector3(-.45, .75, .5).normalize();
  const material = new THREE.ShaderMaterial({ name: 'Soot sprites', vertexShader: VERTEX, fragmentShader: FRAGMENT,
    uniforms: { time: { value: 0 }, night: { value: 0 }, lightDirection: { value: lightDirection } }, alphaToCoverage: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Soot sprites'; mesh.frustumCulled = false;

  // Soft contact shadows that shrink as a sprite leaves the ground.
  const shadowGeometry = new THREE.InstancedBufferGeometry();
  shadowGeometry.index = quad.index;
  shadowGeometry.setAttribute('position', quad.getAttribute('position'));
  shadowGeometry.setAttribute('sprite', spriteAttribute);
  shadowGeometry.setAttribute('spriteState', stateAttribute);
  shadowGeometry.instanceCount = count;
  const shadowMaterial = new THREE.ShaderMaterial({ name: 'Soot sprite shadows', transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { top: { value: TOP + .002 } },
    vertexShader: /* glsl */`
      attribute vec4 sprite; attribute vec4 spriteState; uniform float top; varying vec2 vLocal; varying float vLift;
      void main() {
        float lift = clamp((sprite.y - top) / sprite.w - .92, 0., 3.);
        vLocal = position.xy * 2.; vLift = lift;
        vec3 world = vec3(sprite.x + position.x * sprite.w * 2.6, top, sprite.z + position.y * sprite.w * 2.1);
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.);
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vLocal; varying float vLift;
      void main() {
        float shade = exp(-dot(vLocal, vLocal) * 3.2) * .55 / (1. + vLift * 1.4);
        gl_FragColor = vec4(vec3(.015, .01, .008), shade);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const shadows = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadows.name = 'Soot sprite shadows'; shadows.frustumCulled = false;
  const root = new THREE.Group();
  root.name = 'Soot sprites';
  root.add(shadows, mesh);
  o.scene.add(root);

  // Pointer, in CSS pixels relative to the canvas.
  let pointerX = 0, pointerY = 0, pointerActive = false, pointerDown: { x: number; y: number } | undefined;
  let scareX = 0, scareY = 0, scare = 0, time = 0, visibility = 1, sheltering = false;
  const onMove = (event: PointerEvent) => {
    const rect = o.canvas.getBoundingClientRect();
    pointerX = event.clientX - rect.left; pointerY = event.clientY - rect.top; pointerActive = true;
  };
  const onLeave = (event: PointerEvent) => { if (event.pointerType !== 'mouse' || event.type === 'pointerleave') pointerActive = false; };
  const onDown = (event: PointerEvent) => { onMove(event); pointerDown = { x: event.clientX, y: event.clientY }; };
  const onUp = (event: PointerEvent) => {
    const start = pointerDown; pointerDown = undefined;
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
    const rect = o.canvas.getBoundingClientRect();
    // A tap startles every sprite nearby, the closest ones most.
    scareX = event.clientX - rect.left; scareY = event.clientY - rect.top; scare = 1;
  };
  o.canvas.addEventListener('pointermove', onMove, { passive: true });
  o.canvas.addEventListener('pointerdown', onDown, { passive: true });
  o.canvas.addEventListener('pointerup', onUp, { passive: true });
  o.canvas.addEventListener('pointerleave', onLeave, { passive: true });
  o.canvas.addEventListener('pointercancel', onLeave, { passive: true });

  const projected = new THREE.Vector3(), ray = new THREE.Ray(), ndc = new THREE.Vector2(), closest = new THREE.Vector3(), center = new THREE.Vector3();

  function hop(s: Sprite, toX: number, toZ: number, height: number, duration: number) {
    // Stay on the wood: slide along the rim rather than off it, and keep clear of the paws.
    let r = Math.hypot(toX, toZ);
    if (r > RIM) { toX *= RIM / r; toZ *= RIM / r; r = RIM; }
    if (r < FEET) { toX *= FEET / Math.max(r, 1e-3); toZ *= FEET / Math.max(r, 1e-3); }
    for (const other of sprites) {
      if (other === s) continue;
      const dx = toX - other.toX, dz = toZ - other.toZ, d = Math.hypot(dx, dz), min = (s.radius + other.radius) * 1.15;
      if (d < min && d > 1e-4) { toX += dx / d * (min - d); toZ += dz / d * (min - d); }
    }
    Object.assign(s, { hop: 0, hopDuration: duration, hopHeight: height, fromX: s.x, fromZ: s.z, toX, toZ });
    s.squashVelocity -= 3.2;
  }

  function flee(s: Sprite, px: number, py: number, strength: number) {
    // Direction away from the pointer ray's closest approach to the sprite.
    const rect = o.canvas.getBoundingClientRect();
    ndc.set(px / rect.width * 2 - 1, -(py / rect.height) * 2 + 1);
    ray.origin.setFromMatrixPosition(o.camera.matrixWorld);
    ray.direction.set(ndc.x, ndc.y, .5).unproject(o.camera).sub(ray.origin).normalize();
    center.set(s.x, TOP + s.radius, s.z);
    ray.closestPointToPoint(center, closest);
    let dx = s.x - closest.x, dz = s.z - closest.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-3) { dx = Math.cos(s.seed * 7); dz = Math.sin(s.seed * 7); } else { dx /= length; dz /= length; }
    const angle = (random() - .5) * .9, distance = .22 + .28 * strength + random() * .15;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    hop(s, s.x + (dx * cos - dz * sin) * distance, s.z + (dx * sin + dz * cos) * distance, .1 + .16 * strength, .2 + .08 * random());
  }

  function update(dt: number, frame: SootFrame) {
    visibility = THREE.MathUtils.damp(visibility, frame.visible ? 1 : 0, 8, dt);
    if (Math.abs(visibility - (frame.visible ? 1 : 0)) < .002) visibility = frame.visible ? 1 : 0;
    root.visible = visibility > 0;
    material.uniforms.night.value = frame.night;
    if (!root.visible) { scare = 0; return false; }
    const step = frame.animated ? dt : 0;
    time += step;
    material.uniforms.time.value = time;
    o.camera.updateMatrixWorld();
    const rect = o.canvas.getBoundingClientRect();
    const scale = rect.height / (2 * Math.tan(THREE.MathUtils.degToRad(o.camera.fov) / 2));
    for (const s of sprites) {
      projected.set(s.x, TOP + s.radius + s.height, s.z).project(o.camera);
      s.screenX = (projected.x * .5 + .5) * rect.width; s.screenY = (-projected.y * .5 + .5) * rect.height;
      s.screenRadius = s.radius * scale / Math.max(.1, o.camera.position.distanceTo(center.set(s.x, TOP, s.z)));
    }
    if (step > 0) {
      const shelter = frame.rain > (sheltering ? .2 : .35);
      if (shelter !== sheltering) { sheltering = shelter; for (const s of sprites) s.nextIdle = random() * .35; }
      for (const s of sprites) {
        const reach = Math.max(55, s.screenRadius * 5);
        const near = pointerActive ? Math.hypot(s.screenX - pointerX, s.screenY - pointerY) : Infinity;
        const tapped = scare > 0 ? Math.hypot(s.screenX - scareX, s.screenY - scareY) : Infinity;
        if (s.hop < 0 && tapped < 190) { flee(s, scareX, scareY, 1.6 - tapped / 190); s.fear = 1; }
        else if (s.hop < 0 && near < reach) { flee(s, pointerX, pointerY, 1 - near / reach * .5); s.fear = 1; }
        s.fear = Math.max(0, s.fear - step * .45);
        // Watch the pointer when it is around, otherwise glance about.
        const watching = pointerActive && near < 320;
        const lookX = watching ? THREE.MathUtils.clamp((pointerX - s.screenX) / 90, -1, 1) : Math.sin(time * .7 + s.seed * 5) * .6;
        const lookY = watching ? THREE.MathUtils.clamp((s.screenY - pointerY) / 90, -1, 1) : Math.sin(time * .5 + s.seed * 3) * .3;
        s.lookX = THREE.MathUtils.damp(s.lookX, lookX, 10, step); s.lookY = THREE.MathUtils.damp(s.lookY, lookY, 10, step);
        s.nextBlink -= step;
        if (s.nextBlink < 0) { s.blink = 1; s.nextBlink = 1.8 + random() * 4.5; }
        s.blink = Math.max(0, s.blink - step * 7);
        if (s.hop >= 0) {
          s.hop += step / s.hopDuration;
          const t = Math.min(1, s.hop);
          s.x = THREE.MathUtils.lerp(s.fromX, s.toX, t); s.z = THREE.MathUtils.lerp(s.fromZ, s.toZ, t);
          s.height = 4 * s.hopHeight * t * (1 - t);
          if (s.hop >= 1) {
            s.hop = -1; s.height = 0; s.squashVelocity -= 4.5;
            // Keep scurrying while frightened; wander home once calm.
            if (s.fear > .6 && random() < .55) flee(s, pointerActive ? pointerX : s.screenX, pointerActive ? pointerY : s.screenY + 30, .6);
          }
        } else {
          s.nextIdle -= step;
          const homeX = sheltering ? s.shelterX : s.homeX, homeZ = sheltering ? s.shelterZ : s.homeZ;
          const away = Math.hypot(homeX - s.x, homeZ - s.z);
          if (s.fear < .05 && away > .06 && s.nextIdle < 0) {
            const k = Math.min(1, .3 / away);
            hop(s, s.x + (homeX - s.x) * k, s.z + (homeZ - s.z) * k, .06, .22);
            s.nextIdle = .2 + random() * .45;
          } else if (s.nextIdle < 0 && !sheltering) {
            hop(s, s.x + (random() - .5) * .16, s.z + (random() - .5) * .16, .045 + random() * .05, .18);
            s.nextIdle = 2.5 + random() * 6;
          }
        }
        // Squash-and-stretch spring; stretch while airborne.
        const target = s.hop >= 0 ? .16 * Math.sin(Math.PI * Math.min(1, s.hop)) : 0;
        s.squashVelocity += ((target - s.squash) * 160 - s.squashVelocity * 11) * step;
        s.squash = THREE.MathUtils.clamp(s.squash + s.squashVelocity * step, -.35, .3);
      }
      scare = 0;
    }
    const spriteArray = spriteAttribute.array as Float32Array, stateArray = stateAttribute.array as Float32Array, lookArray = lookAttribute.array as Float32Array;
    sprites.forEach((s, i) => {
      const size = s.radius * visibility;
      spriteArray.set([s.x, TOP + s.radius * .92 + s.height, s.z, size], i * 4);
      stateArray.set([s.blink, s.squash, s.seed, s.fear], i * 4);
      lookArray.set([s.lookX, s.lookY], i * 2);
    });
    spriteAttribute.needsUpdate = stateAttribute.needsUpdate = lookAttribute.needsUpdate = true;
    return visibility > 0 && visibility < 1;
  }

  return {
    root,
    update,
    dispose() {
      o.canvas.removeEventListener('pointermove', onMove);
      o.canvas.removeEventListener('pointerdown', onDown);
      o.canvas.removeEventListener('pointerup', onUp);
      o.canvas.removeEventListener('pointerleave', onLeave);
      o.canvas.removeEventListener('pointercancel', onLeave);
      root.removeFromParent();
      quad.dispose(); geometry.dispose(); shadowGeometry.dispose(); material.dispose(); shadowMaterial.dispose();
    },
  };
}
