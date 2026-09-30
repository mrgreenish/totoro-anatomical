import * as THREE from 'three';
import { FOREST_GLOWS, type ForestLight } from './forest-light';

/**
 * The living air around the sculpture: sunbeams through the canopy, dust
 * that sparkles only where the sun reaches it, camphor leaves that glide down
 * and settle on the plinth, and fireflies after dark. Everything advances on
 * the character clock, so Pause freezes the whole moment.
 */
type Options = { scene: THREE.Scene; camera: THREE.PerspectiveCamera; forest: ForestLight; mobile: boolean };
export type AtmosphereFrame = {
  animated: boolean; night: number; visible: boolean; pixelRatio: number; viewportWidth: number; viewportHeight: number;
  /** Current rainfall and lingering surface water, both 0 to 1. */
  rain: number; wetness: number;
};

const PLINTH_TOP = -.03, PLINTH_RADIUS = 2.02;
const FOCUS = new THREE.Vector3(0, 2.3, 0);
const damp = THREE.MathUtils.damp;

const NOISE = /* glsl */`
  float atmosphereHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float atmosphereNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(atmosphereHash(i), atmosphereHash(i + vec2(1, 0)), f.x), mix(atmosphereHash(i + vec2(0, 1)), atmosphereHash(i + vec2(1, 1)), f.x), f.y);
  }
`;

/** Slow breeze with occasional gusts; roughly 0.1 to 1.9. */
export function windAt(time: number) {
  const base = .38 + .22 * Math.sin(time * .13) + .12 * Math.sin(time * .31 + 1.7);
  const gust = Math.max(0, Math.sin(time * .071 + .4)) ** 6 * 1.1 + Math.max(0, Math.sin(time * .053 + 2.1)) ** 8 * .8;
  return base + gust;
}

// Fireflies share one motion model between the GPU sprites and the two
// "hero" glows that light the fur, so the light follows the visible insect.
type Firefly = { radius: number; height: number; angle: number; seed: number };
function fireflyPosition(f: Firefly, time: number, out: THREE.Vector3) {
  const s = f.seed;
  const direction = (s * 9) % 1 > .5 ? 1 : -1;
  const angle = f.angle + time * (.05 + .07 * ((s * 3.1) % 1)) * direction;
  const radius = f.radius + Math.sin(time * .37 + s * 17) * .32;
  return out.set(
    Math.cos(angle) * radius + Math.sin(time * .9 + s * 13) * .12,
    f.height + Math.sin(time * .29 + s * 5) * .42 + Math.sin(time * 1.1 + s * 3) * .06,
    Math.sin(angle) * radius + Math.cos(time * .8 + s * 11) * .12);
}
function fireflyFlash(f: Firefly, time: number) {
  const period = 2.6 + ((f.seed * 7.3) % 1) * 3.2;
  const x = ((time + f.seed * 11) % period + period) % period;
  return THREE.MathUtils.smoothstep(x, 0, .18) * (1 - THREE.MathUtils.smoothstep(x, .35, 1.1));
}
const FIREFLY_GLSL = /* glsl */`
  vec3 fireflyPosition(vec4 f, float time) {
    float s = f.w;
    float direction = fract(s * 9.) > .5 ? 1. : -1.;
    float angle = f.z + time * (.05 + .07 * fract(s * 3.1)) * direction;
    float radius = f.x + sin(time * .37 + s * 17.) * .32;
    return vec3(cos(angle) * radius + sin(time * .9 + s * 13.) * .12,
      f.y + sin(time * .29 + s * 5.) * .42 + sin(time * 1.1 + s * 3.) * .06,
      sin(angle) * radius + cos(time * .8 + s * 11.) * .12);
  }
  float fireflyFlash(float seed, float time) {
    float period = 2.6 + fract(seed * 7.3) * 3.2;
    float x = mod(time + seed * 11., period);
    return smoothstep(0., .18, x) * (1. - smoothstep(.35, 1.1, x));
  }
`;

function leafGeometry() {
  // A camphor leaf: elliptic blade, pointed tip, folded along the midrib and
  // curling slightly upward toward the tip. Length runs along +Y.
  const rows = 8, positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let i = 0; i <= rows; i++) {
    const s = i / rows, y = s - .5;
    const width = .23 * Math.sin(Math.PI * Math.pow(s, .82)) * (1 - .18 * s);
    const curl = .07 * s * s, fold = width * .32;
    positions.push(-width, y, curl + fold, 0, y, curl, width, y, curl + fold);
    uvs.push(0, s, .5, s, 1, s);
  }
  for (let i = 0; i < rows; i++) {
    const a = i * 3, b = a + 3;
    indices.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
  // Petiole.
  const base = positions.length / 3;
  positions.push(-.012, -.5, 0, .012, -.5, 0, 0, -.62, .01);
  uvs.push(.45, 0, .55, 0, .5, 0);
  indices.push(base, base + 2, base + 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

type Leaf = {
  x: number; y: number; z: number; t: number; phase: number; amp: number; freq: number; fall: number;
  heading: number; spin: number; size: number; landed: number; rest: number; fade: number; tilt: number;
  /** Reserve leaves wait, hidden, for a gust to shake them loose. */
  reserve: boolean; parked: boolean;
};

export function createForestAtmosphere(o: Options) {
  const { forest } = o;
  const root = new THREE.Group();
  root.name = 'Forest atmosphere';
  o.scene.add(root);
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let time = 0, visibility = 1, wind = windAt(0), gust = 0;
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [];

  // --- Sunbeams: camera-facing ribbons along the key light direction. ---
  const beams = o.mobile ? 3 : 5;
  const beamGeometry = new THREE.BufferGeometry();
  {
    const coords: number[] = [], origins: number[] = [], seeds: number[] = [], indices: number[] = [];
    const rows = 12, direction = forest.direction;
    const candidates: THREE.Vector3[] = [];
    // Keep each beam clear of the sculpture: sample its axis between the
    // plinth and the ears and reject paths that pass through the body.
    for (let attempt = 0; attempt < 400 && candidates.length < beams; attempt++) {
      const angle = random() * Math.PI * 2, radius = 1.4 + random() * 1.9;
      const ground = new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      let clear = true;
      for (let h = 0; h <= 4.6 && clear; h += .2) {
        const point = ground.clone().addScaledVector(direction, -h / -direction.y);
        if (Math.hypot(point.x, point.z) < (h < 3.8 ? 1.55 : 1.15)) clear = false;
      }
      if (clear && candidates.every(c => c.distanceTo(ground) > 1.1)) candidates.push(ground);
    }
    candidates.forEach((ground, index) => {
      const top = ground.clone().addScaledVector(direction, -7.2 / -direction.y);
      const width = .22 + random() * .26, beamSeed = random();
      const offset = coords.length / 2;
      for (let r = 0; r <= rows; r++) for (const side of [-1, 1]) {
        coords.push(side, r / rows); origins.push(top.x, top.y, top.z, width); seeds.push(beamSeed + index);
      }
      for (let r = 0; r < rows; r++) {
        const a = offset + r * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    });
    beamGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(coords.length / 2 * 3), 3));
    beamGeometry.setAttribute('beamCoord', new THREE.Float32BufferAttribute(coords, 2));
    beamGeometry.setAttribute('beamOrigin', new THREE.Float32BufferAttribute(origins, 4));
    beamGeometry.setAttribute('beamSeed', new THREE.Float32BufferAttribute(seeds, 1));
    beamGeometry.setIndex(indices);
  }
  geometries.push(beamGeometry);
  const beamMaterial = new THREE.ShaderMaterial({
    name: 'Canopy sunbeams', transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { time: { value: 0 }, intensity: { value: 0 }, color: { value: new THREE.Color() },
      beamDirection: { value: forest.direction }, beamLength: { value: 7.2 / -forest.direction.y }, viewport: { value: new THREE.Vector2(1, 1) } },
    vertexShader: /* glsl */`
      attribute vec2 beamCoord; attribute vec4 beamOrigin; attribute float beamSeed;
      uniform vec3 beamDirection; uniform float beamLength;
      varying vec2 vCoord; varying float vSeed; varying vec3 vWorld;
      void main() {
        vec3 axis = beamOrigin.xyz + beamDirection * beamCoord.y * beamLength;
        vec3 side = normalize(cross(beamDirection, cameraPosition - axis));
        vec3 world = axis + side * beamCoord.x * beamOrigin.w * (.7 + .65 * beamCoord.y);
        vCoord = beamCoord; vSeed = beamSeed; vWorld = world;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.);
      }`,
    fragmentShader: /* glsl */`
      uniform float time; uniform float intensity; uniform vec3 color; uniform vec2 viewport;
      varying vec2 vCoord; varying float vSeed; varying vec3 vWorld;
      ${NOISE}
      void main() {
        float across = 1. - vCoord.x * vCoord.x; across *= across;
        float along = smoothstep(.12, .45, vCoord.y) * smoothstep(-.02, .75, vWorld.y);
        float dust = atmosphereNoise(vec2(vCoord.x * 2.3 + vSeed * 7.1, vWorld.y * 1.7 + time * .16)) * .6
          + atmosphereNoise(vec2(vCoord.x * 6.1 - vSeed * 3.3, vWorld.y * 4.3 - time * .11)) * .4;
        float breathe = .72 + .28 * sin(time * .55 + vSeed * 6.3);
        // Fade before every canvas edge so a beam never reveals the frame.
        vec2 screen = gl_FragCoord.xy / viewport;
        float frame = (1. - smoothstep(.74, .98, screen.y)) * smoothstep(0., .16, screen.x) * (1. - smoothstep(.84, 1., screen.x)) * smoothstep(0., .1, screen.y);
        float alpha = across * along * frame * breathe * (.55 + .45 * dust) * intensity;
        if (alpha < .002) discard;
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  materials.push(beamMaterial);
  const beamMesh = new THREE.Mesh(beamGeometry, beamMaterial);
  beamMesh.name = 'Canopy sunbeams'; beamMesh.frustumCulled = false; beamMesh.renderOrder = 3;
  root.add(beamMesh);

  // --- Dust motes with bokeh: sunlit only where the canopy is open. ---
  const moteCount = o.mobile ? 70 : 170;
  const moteData = new Float32Array(moteCount * 4);
  for (let i = 0; i < moteCount; i++) {
    moteData.set([(random() - .5) * 6.6, random() * 5.4 - .1, (random() - .5) * 5.4, random()], i * 4);
  }
  const moteGeometry = new THREE.BufferGeometry();
  moteGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(moteCount * 3), 3));
  moteGeometry.setAttribute('mote', new THREE.Float32BufferAttribute(moteData, 4));
  geometries.push(moteGeometry);
  const moteMaterial = new THREE.ShaderMaterial({
    name: 'Sunlit dust', transparent: true, depthWrite: false,
    uniforms: { ...forest.uniforms, time: { value: 0 }, pixelScale: { value: 1 }, focus: { value: 13 },
      intensity: { value: 0 }, color: { value: new THREE.Color() }, sunDirection: { value: forest.direction.clone().negate() } },
    vertexShader: /* glsl */`
      ${forest.glsl}
      attribute vec4 mote; uniform float time; uniform float pixelScale; uniform float focus; uniform vec3 sunDirection;
      varying float vAlpha; varying float vBokeh;
      void main() {
        float s = mote.w;
        vec3 p = mote.xyz + vec3(sin(time * .13 + s * 11.) * .34 + sin(time * .29 + s * 3.) * .11,
          sin(time * .11 + s * 7.) * .22, cos(time * .17 + s * 5.) * .3);
        p.y = mod(p.y + time * (.012 + .02 * fract(s * 13.)) + .1, 5.4) - .1;
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        float depth = -mv.z;
        // Circle of confusion around the orbit target: near and far motes
        // become soft discs whose brightness spreads over their area.
        float coc = abs(depth - focus) / depth * 6.;
        float size = (1.2 + 22. / depth) + coc * 3.2;
        gl_PointSize = clamp(size * pixelScale, 1., 44. * pixelScale);
        vBokeh = smoothstep(.8, 3.2, coc);
        float sun = forestCanopyOpening(p);
        // Dust scatters forward: it glows when the viewer looks toward the sun.
        float forward = pow(max(dot(normalize(p - cameraPosition), sunDirection), 0.), 3.);
        float twinkle = .55 + .45 * sin(time * (1.3 + fract(s * 7.) * 2.6) + s * 21.);
        vAlpha = (.12 + .88 * sun) * (.45 + .75 * forward) * twinkle / (1. + coc * coc * .35);
      }`,
    fragmentShader: /* glsl */`
      uniform float intensity; uniform vec3 color; varying float vAlpha; varying float vBokeh;
      void main() {
        float r = length(gl_PointCoord * 2. - 1.);
        float soft = exp(-r * r * 4.5);
        float disc = (1. - smoothstep(.72, 1., r)) * (.75 + .45 * smoothstep(.45, .9, r));
        float alpha = mix(soft, disc * .4, vBokeh) * vAlpha * intensity;
        if (alpha < .003) discard;
        gl_FragColor = vec4(color, min(alpha, 1.));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  materials.push(moteMaterial);
  const motes = new THREE.Points(moteGeometry, moteMaterial);
  motes.name = 'Sunlit dust'; motes.frustumCulled = false; motes.renderOrder = 4;
  root.add(motes);

  // --- Fireflies. The first FOREST_GLOWS fly close enough to light the fur. ---
  const fireflyCount = o.mobile ? 18 : 36;
  const fireflies: Firefly[] = [];
  for (let i = 0; i < fireflyCount; i++) {
    const hero = i < FOREST_GLOWS;
    fireflies.push({ radius: hero ? 1.42 + random() * .25 : 1.55 + random() * 1.8,
      height: hero ? 1.1 + random() * 2.2 : .25 + random() * 4.3, angle: random() * Math.PI * 2, seed: random() * 10 });
  }
  const fireflyGeometry = new THREE.BufferGeometry();
  fireflyGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(fireflyCount * 3), 3));
  fireflyGeometry.setAttribute('firefly', new THREE.Float32BufferAttribute(fireflies.flatMap(f => [f.radius, f.height, f.angle, f.seed]), 4));
  geometries.push(fireflyGeometry);
  const fireflyMaterial = new THREE.ShaderMaterial({
    name: 'Fireflies', transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 }, intensity: { value: 0 }, pixelScale: { value: 1 } },
    vertexShader: /* glsl */`
      ${FIREFLY_GLSL}
      attribute vec4 firefly; uniform float time; uniform float pixelScale; varying float vFlash;
      void main() {
        vec4 mv = modelViewMatrix * vec4(fireflyPosition(firefly, time), 1.);
        gl_Position = projectionMatrix * mv;
        vFlash = fireflyFlash(firefly.w, time);
        gl_PointSize = clamp(pixelScale * (22. + 26. * vFlash) / -mv.z * 4., 2., 34. * pixelScale);
      }`,
    fragmentShader: /* glsl */`
      uniform float intensity; varying float vFlash;
      void main() {
        float r = length(gl_PointCoord * 2. - 1.);
        float core = exp(-r * r * 30.), halo = exp(-r * r * 5.);
        float glow = .1 + vFlash;
        float alpha = (core + halo * .3) * glow * intensity;
        if (alpha < .003) discard;
        // HDR core so the bloom chain turns each flash into a soft lantern.
        gl_FragColor = vec4(vec3(1., .86, .38) * (1.4 + core * 14. * vFlash), min(alpha, 1.));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  materials.push(fireflyMaterial);
  const fireflyPoints = new THREE.Points(fireflyGeometry, fireflyMaterial);
  fireflyPoints.name = 'Fireflies'; fireflyPoints.frustumCulled = false; fireflyPoints.renderOrder = 5;
  root.add(fireflyPoints);

  // --- Falling camphor leaves. ---
  const ambientLeaves = o.mobile ? 8 : 14, reserveLeaves = o.mobile ? 6 : 10, leafCount = ambientLeaves + reserveLeaves;
  const leafGeo = leafGeometry();
  geometries.push(leafGeo);
  const fade = new THREE.InstancedBufferAttribute(new Float32Array(leafCount), 1);
  fade.setUsage(THREE.DynamicDrawUsage);
  leafGeo.setAttribute('leafFade', fade);
  const leafMaterial = new THREE.MeshStandardMaterial({ name: 'Camphor leaves', roughness: .5, metalness: 0,
    side: THREE.DoubleSide, transparent: true, envMapIntensity: .8 });
  const viewportHeight = { value: 1 }, leafVisibility = { value: 1 };
  forest.patch(leafMaterial, shader => {
    shader.uniforms.forestViewportHeight = viewportHeight;
    shader.uniforms.forestLeafVisibility = leafVisibility;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float leafFade; varying float vLeafFade; varying vec2 vLeafUv; uniform float forestTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLeafFade = leafFade; vLeafUv = uv;
        // Fine flutter along the blade on top of the tumbling motion.
        transformed.z += sin(forestTime * 9. + float(gl_InstanceID) * 1.7 + position.y * 5.) * .045 * (position.y + .5);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLeafFade; varying vec2 vLeafUv; uniform float forestViewportHeight; uniform float forestLeafVisibility;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float leafVein = 1. - smoothstep(.0, .035, abs(vLeafUv.x - .5));
        float sideVeins = smoothstep(.9, 1., sin((vLeafUv.y * 2.2 - abs(vLeafUv.x - .5)) * 38.)) * (1. - leafVein);
        diffuseColor.rgb *= 1. + leafVein * .32 + sideVeins * .1 - (1. - vLeafUv.y) * .08;
        diffuseColor.a *= vLeafFade * forestLeafVisibility * (1. - smoothstep(.86, .99, gl_FragCoord.y / forestViewportHeight));`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
          // Sun shining through the blade from behind.
          float leafBacklight = saturate(dot(-geometryNormal, directionalLights[ 0 ].direction));
          reflectedLight.directDiffuse += directionalLights[ 0 ].color * forestCanopyLight(forestWorldPosition)
            * leafBacklight * diffuseColor.rgb * .5;
        #endif`);
  }, 'leaf-v1');
  materials.push(leafMaterial);
  const leafMesh = new THREE.InstancedMesh(leafGeo, leafMaterial, leafCount);
  leafMesh.name = 'Falling camphor leaves'; leafMesh.frustumCulled = false; leafMesh.receiveShadow = true;
  leafMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(leafMesh);
  // Camphor sheds old leaves in red and amber alongside the green.
  const palette = [0x557d33, 0x6f913b, 0x9aa441, 0xc88a2e, 0xb8542c, 0x49702d].map(c => new THREE.Color(c));
  const leaves: Leaf[] = [];
  function spawn(leaf: Leaf, initial: boolean, shaken = false) {
    const angle = random() * Math.PI * 2, radius = 1.45 + random() * (shaken ? 1.35 : 1.75);
    Object.assign(leaf, { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius,
      y: initial ? .6 + random() * 5.6 : shaken ? 5.5 + random() * 1.2 : 6.3 + random() * 1.6, t: random() * 10, phase: random() * Math.PI * 2,
      amp: .16 + random() * .2, freq: 1.2 + random() * .9, fall: .3 + random() * .2, heading: random() * Math.PI * 2,
      spin: (random() - .5) * (shaken ? 2.2 : .9), size: .21 + random() * .1, landed: -1, rest: 4 + random() * 5, fade: initial ? 1 : 0,
      tilt: (random() - .5) * .3, parked: false });
  }
  function retire(leaf: Leaf) {
    if (leaf.reserve) { leaf.parked = true; leaf.fade = 0; } else spawn(leaf, false);
  }
  for (let i = 0; i < leafCount; i++) {
    const leaf = { reserve: i >= ambientLeaves } as Leaf; spawn(leaf, true);
    if (leaf.reserve) { leaf.parked = true; leaf.fade = 0; }
    leaves.push(leaf);
    leafMesh.setColorAt(i, palette[Math.floor(random() * palette.length)]);
  }
  const dummy = new THREE.Object3D(), yaw = new THREE.Quaternion(), flatten = new THREE.Quaternion(), bank = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0), xAxis = new THREE.Vector3(1, 0, 0), yAxis = new THREE.Vector3(0, 1, 0);
  function stepLeaves(dt: number) {
    const windX = Math.cos(time * .05) * wind * .07, windZ = Math.sin(time * .04 + 1) * wind * .05;
    for (let i = 0; i < leafCount; i++) {
      const leaf = leaves[i];
      let swing = 0;
      if (leaf.parked) {
        dummy.scale.setScalar(0); dummy.updateMatrix(); leafMesh.setMatrixAt(i, dummy.matrix); fade.setX(i, 0);
        continue;
      }
      if (leaf.landed < 0) {
        leaf.t += dt;
        const w = leaf.freq * leaf.t + leaf.phase;
        swing = Math.sin(w);
        const glide = Math.cos(w) * leaf.amp * leaf.freq * (.7 + .3 * wind);
        leaf.heading += leaf.spin * dt;
        leaf.x += (Math.cos(leaf.heading) * glide + windX) * dt;
        leaf.z += (-Math.sin(leaf.heading) * glide + windZ) * dt;
        // Leaves glide through the middle of each swing and drop at the turns.
        leaf.y -= leaf.fall * (.5 + .95 * swing * swing) * dt;
        const r = Math.hypot(leaf.x, leaf.z);
        const clearance = leaf.y < .4 ? 1.02 : leaf.y < 2.9 ? 1.32 : leaf.y < 3.8 ? 1.12 : leaf.y < 4.6 ? .9 : 0;
        if (r < clearance) { const k = clearance / Math.max(r, 1e-3); leaf.x *= k; leaf.z *= k; }
        leaf.fade = Math.min(1, leaf.fade + dt * 1.6);
        if (leaf.y <= PLINTH_TOP + .012 && r < PLINTH_RADIUS) { leaf.y = PLINTH_TOP + .012; leaf.landed = 0; }
        else if (leaf.y < -1.8) retire(leaf);
      } else {
        leaf.landed += dt;
        if (leaf.landed > leaf.rest) { leaf.fade -= dt * .7; if (leaf.fade <= 0) retire(leaf); }
      }
      const settle = leaf.landed < 0 ? 0 : Math.min(1, leaf.landed * 3);
      const w = leaf.freq * leaf.t + leaf.phase;
      yaw.setFromAxisAngle(up, leaf.heading);
      flatten.setFromAxisAngle(xAxis, -Math.PI / 2 + (1 - settle) * .22 * Math.sin(2 * w + 1) + settle * leaf.tilt * .2);
      bank.setFromAxisAngle(yAxis, (1 - settle) * swing * .95 + settle * leaf.tilt);
      dummy.position.set(leaf.x, leaf.y, leaf.z);
      dummy.quaternion.copy(yaw).multiply(flatten).multiply(bank);
      dummy.scale.setScalar(leaf.size);
      dummy.updateMatrix();
      leafMesh.setMatrixAt(i, dummy.matrix);
      fade.setX(i, Math.max(0, leaf.fade));
    }
    leafMesh.instanceMatrix.needsUpdate = true;
    fade.needsUpdate = true;
  }
  stepLeaves(0);

  const moteDay = new THREE.Color(1.9, 1.7, 1.25), moteNight = new THREE.Color(.75, .95, 1.2);
  const beamDay = new THREE.Color(2.2, 1.95, 1.45), beamNight = new THREE.Color(.9, 1.15, 1.5);
  const glowPosition = new THREE.Vector3();
  const glowColor = new THREE.Vector3(.85, .95, .38);

  return {
    root,
    /** Current breeze, for the ears and the leaf hat. */
    get wind() { return wind; },
    /** A shake of the tree: a gust races through the canopy and loosens leaves. */
    poke() {
      gust = Math.max(gust, 1.35);
      let loosened = 0;
      for (const leaf of leaves) if (leaf.parked && loosened < reserveLeaves * .7) { spawn(leaf, false, true); loosened++; }
    },
    /** Shows every effect for one shader warm-up; the next update restores visibility. */
    prepareCompile() { root.visible = true; fireflyPoints.visible = true; },
    update(dt: number, frame: AtmosphereFrame) {
      const step = frame.animated ? dt : 0;
      time += step;
      gust *= Math.exp(-step * .75);
      wind = windAt(time) + gust;
      // Gusts quicken the canopy, so the dappled light dances with the breeze.
      forest.uniforms.forestTime.value += step * (.55 + .45 * wind);
      visibility = damp(visibility, frame.visible ? 1 : 0, 7, dt);
      if (Math.abs(visibility - (frame.visible ? 1 : 0)) < .002) visibility = frame.visible ? 1 : 0;
      root.visible = visibility > 0;
      const night = frame.night, day = 1 - night, clear = 1 - frame.rain;
      // Overcast skies soften the dapples; rain washes dust and sunbeams away.
      forest.uniforms.forestCanopy.value = visibility * (.95 - .25 * night) * (1 - .72 * frame.rain);
      forest.uniforms.forestWetness.value = visibility * frame.wetness;
      (forest.uniforms.forestCanopyRange.value as THREE.Vector2).set(.5 + .08 * night, 1.42 - .2 * night);
      (forest.uniforms.forestCanopyShade.value as THREE.Color).setRGB(.8 + .12 * night, 1, .7 + .3 * night);
      beamMaterial.uniforms.time.value = time;
      beamMaterial.uniforms.intensity.value = visibility * (.085 * day + .1 * night) * clear * clear;
      (beamMaterial.uniforms.color.value as THREE.Color).copy(beamDay).lerp(beamNight, night);
      (beamMaterial.uniforms.viewport.value as THREE.Vector2).set(frame.viewportWidth, frame.viewportHeight);
      moteMaterial.uniforms.time.value = time;
      moteMaterial.uniforms.pixelScale.value = frame.pixelRatio;
      moteMaterial.uniforms.focus.value = o.camera.position.distanceTo(FOCUS);
      moteMaterial.uniforms.intensity.value = visibility * (.9 * day + .35 * night) * (1 - .85 * frame.rain);
      (moteMaterial.uniforms.color.value as THREE.Color).copy(moteDay).lerp(moteNight, night);
      fireflyMaterial.uniforms.time.value = time;
      fireflyMaterial.uniforms.pixelScale.value = frame.pixelRatio;
      fireflyMaterial.uniforms.intensity.value = visibility * THREE.MathUtils.smoothstep(night, .25, .9) * (1 - .65 * frame.rain);
      fireflyPoints.visible = night > .2;
      viewportHeight.value = frame.viewportHeight;
      leafVisibility.value = visibility;
      if (step > 0 && root.visible) stepLeaves(step);
      // Hero fireflies light the fur. Positions go to view space for the BRDF.
      const glowStrength = visibility * THREE.MathUtils.smoothstep(night, .3, .95) * (1 - .65 * frame.rain);
      forest.uniforms.forestGlowActive.value = glowStrength > .001 ? 1 : 0;
      o.camera.updateMatrixWorld();
      for (let i = 0; i < FOREST_GLOWS; i++) {
        const f = fireflies[i];
        fireflyPosition(f, time, glowPosition).applyMatrix4(o.camera.matrixWorldInverse);
        forest.uniforms.forestGlowPositions.value[i].copy(glowPosition);
        forest.uniforms.forestGlowColors.value[i].copy(glowColor).multiplyScalar(glowStrength * (.12 + fireflyFlash(f, time)) * 1.6);
      }
      return visibility > 0 && visibility < 1;
    },
    dispose() {
      root.removeFromParent();
      geometries.forEach(g => g.dispose());
      materials.forEach(m => m.dispose());
      leafMesh.dispose();
    },
  };
}
export type ForestAtmosphere = ReturnType<typeof createForestAtmosphere>;
