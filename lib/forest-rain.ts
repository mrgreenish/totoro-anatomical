import * as THREE from 'three';

/**
 * A rain shower over the sculpture, after the bus-stop evening in the film.
 * One instanced draw: each drop is a pixel-wide, motion-blurred streak that
 * turns into a tiny splash crown where it lands, on the plinth or on
 * Totoro's head. Drops never fall through him: the ones above his crown stop
 * there, the rest fall around him. Everything is evaluated on the GPU from a
 * clock, so the CPU only eases the weather in and out.
 */
type Options = { scene: THREE.Scene; camera: THREE.PerspectiveCamera; mobile: boolean; lightDirection: THREE.Vector3 };
export type RainFrame = {
  animated: boolean; raining: boolean; visible: boolean; night: number; wind: number;
  viewportWidth: number; viewportHeight: number;
};

const TOP = 7.4;

const VERTEX = /* glsl */`
  attribute vec4 drop; attribute float dropFloor;
  uniform float time; uniform float rain; uniform vec2 slant; uniform float streak; uniform float pixelWorld;
  uniform vec3 lightDirection;
  varying vec2 vQuad; varying float vSplash; varying float vFade; varying float vLight;
  void main() {
    float speed = 8.2 + 3.6 * drop.w;
    float span = ${TOP.toFixed(1)} - dropFloor + 1.1;
    float fallen = mod(drop.z * span + time * speed, span);
    float y = ${TOP.toFixed(1)} - fallen;
    float landed = dropFloor - y;
    vec3 drift = vec3(slant.x, 0., slant.y);
    vec3 head = vec3(drop.x, max(y, dropFloor), drop.y) + drift * max(y - dropFloor, 0.);
    // Denser rain simply enables more of the same drops.
    bool dropActive = fract(drop.w * 7.31 + drop.z * 3.7) < rain;
    vec3 world;
    vSplash = 0.; vFade = 1.;
    if (landed > 0.) {
      float age = landed / speed;
      dropActive = dropActive && age < .1 && dropFloor > -1.;
      vSplash = 1.; vFade = 1. - smoothstep(0., .1, age);
      vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      float size = .035 + .06 * smoothstep(0., .1, age);
      world = head + right * position.x * size * 2.2 + vec3(0., (position.y + .5) * size * 1.3, 0.);
    } else {
      vec3 axis = normalize(vec3(-slant.x, 1., -slant.y));
      float len = min(streak, ${TOP.toFixed(1)} - y + .001);
      vec3 centre = head + axis * len * (position.y + .5);
      // About one device pixel wide at any distance, so rain stays fine.
      float width = distance(centre, cameraPosition) * pixelWorld * 1.15;
      world = centre + normalize(cross(axis, cameraPosition - centre)) * position.x * width;
      vFade = smoothstep(${TOP.toFixed(1)}, ${(TOP - 1.4).toFixed(1)}, y);
    }
    vQuad = position.xy * 2.;
    vLight = .55 + .45 * pow(max(dot(normalize(world - cameraPosition), lightDirection), 0.), 4.);
    gl_Position = dropActive ? projectionMatrix * viewMatrix * vec4(world, 1.) : vec4(2., 2., 2., 1.);
  }
`;

const FRAGMENT = /* glsl */`
  uniform vec3 color; uniform float intensity; uniform vec2 viewport;
  varying vec2 vQuad; varying float vSplash; varying float vFade; varying float vLight;
  void main() {
    float alpha;
    if (vSplash < .5) {
      // Bright head, long soft tail.
      float across = 1. - abs(vQuad.x);
      float along = smoothstep(1., -.3, vQuad.y) * smoothstep(-1., -.75, vQuad.y);
      alpha = across * along * .42;
    } else {
      // A little crown: an open arc lifting off the surface.
      vec2 q = vec2(vQuad.x, vQuad.y * .5 + .5);
      float crown = 1. - smoothstep(.07, .2, abs(length(q * vec2(1., 1.5)) - .62));
      alpha = crown * step(.05, q.y) * .7;
    }
    vec2 screen = gl_FragCoord.xy / viewport;
    float frame = (1. - smoothstep(.72, .97, screen.y)) * smoothstep(.0, .1, screen.y)
      * smoothstep(0., .12, screen.x) * (1. - smoothstep(.88, 1., screen.x));
    alpha *= vFade * frame * intensity;
    if (alpha < .004) discard;
    gl_FragColor = vec4(color * vLight, min(alpha, 1.));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createForestRain(o: Options) {
  const count = o.mobile ? 520 : 1400;
  let seed = 97;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const drops = new Float32Array(count * 4), floors = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    let radius: number, floor: number;
    if (i < count * .1) {
      // Over the crown: these land on the leaf hat and the top of the head.
      radius = Math.sqrt(random()) * .78;
      floor = 3.95 - .55 * radius * radius;
    } else {
      radius = Math.sqrt(THREE.MathUtils.lerp(1.34 ** 2, 3.8 ** 2, random()));
      floor = radius < 2.06 ? -.03 : -1.25;
    }
    drops.set([Math.cos(angle) * radius, Math.sin(angle) * radius, random(), random()], i * 4);
    floors[i] = floor;
  }
  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  geometry.setAttribute('drop', new THREE.InstancedBufferAttribute(drops, 4));
  geometry.setAttribute('dropFloor', new THREE.InstancedBufferAttribute(floors, 1));
  geometry.instanceCount = count;
  const material = new THREE.ShaderMaterial({
    name: 'Rain', vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 }, rain: { value: 0 }, slant: { value: new THREE.Vector2() }, streak: { value: .34 },
      pixelWorld: { value: .001 }, lightDirection: { value: o.lightDirection.clone().negate() },
      color: { value: new THREE.Color() }, intensity: { value: 0 }, viewport: { value: new THREE.Vector2(1, 1) } },
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Rain'; mesh.frustumCulled = false; mesh.renderOrder = 6; mesh.visible = false;
  o.scene.add(mesh);

  let level = 0, wetness = 0, time = 0, visibility = 1;
  const dayColor = new THREE.Color(1.7, 1.78, 1.9), nightColor = new THREE.Color(.62, .74, .92);
  return {
    /** Rainfall from 0 to 1, eased. */
    get level() { return level * visibility; },
    /** Surface water, which lingers after the shower. */
    get wetness() { return wetness * visibility; },
    get time() { return time; },
    update(dt: number, frame: RainFrame) {
      const step = frame.animated ? dt : 0;
      time += step;
      level = THREE.MathUtils.damp(level, frame.raining ? 1 : 0, 1.1, dt);
      if (Math.abs(level - (frame.raining ? 1 : 0)) < .002) level = frame.raining ? 1 : 0;
      // Surfaces soak quickly and dry slowly.
      wetness += (level - wetness) * (1 - Math.exp(-(level > wetness ? .5 : .12) * dt));
      if (wetness < .002 && level === 0) wetness = 0;
      visibility = THREE.MathUtils.damp(visibility, frame.visible ? 1 : 0, 7, dt);
      if (Math.abs(visibility - (frame.visible ? 1 : 0)) < .002) visibility = frame.visible ? 1 : 0;
      mesh.visible = level * visibility > .002;
      const u = material.uniforms;
      u.time.value = time;
      u.rain.value = level;
      (u.slant.value as THREE.Vector2).set(.05 + frame.wind * .045, .02 + frame.wind * .012);
      u.intensity.value = visibility * Math.min(1, level * 1.6);
      (u.color.value as THREE.Color).copy(dayColor).lerp(nightColor, frame.night);
      u.pixelWorld.value = 2 * Math.tan(THREE.MathUtils.degToRad(o.camera.fov) / 2) / Math.max(1, frame.viewportHeight);
      (u.viewport.value as THREE.Vector2).set(frame.viewportWidth, frame.viewportHeight);
      const target = frame.raining ? 1 : 0;
      return level !== target || (visibility > 0 && visibility < 1) || (wetness > 0 && wetness < .998 && level > 0) || (wetness > 0 && level === 0);
    },
    dispose() { mesh.removeFromParent(); quad.dispose(); geometry.dispose(); material.dispose(); },
  };
}
export type ForestRain = ReturnType<typeof createForestRain>;
