import * as THREE from 'three';

/**
 * A small cinematic HDR pipeline for the gallery canvas.
 *
 * The scene renders into a multisampled half-float target (with the stencil
 * the anatomy section caps need), then a mip-chain bloom and one composite
 * pass apply AgX tone mapping, a per-scene grade, vignette, lens fringing,
 * grain and dithering. The canvas stays transparent: objects keep their
 * coverage and bloom that leaves an object is written as additive light over
 * the gallery background.
 */
export type GradeName = 'day' | 'night' | 'rain' | 'anatomy' | 'brain' | 'heart' | 'eye' | 'lung';
type Triple = [number, number, number];
type Grade = {
  bloom: number; threshold: number; knee: number; radius: number;
  /** How much bloom may spill past covered pixels onto the page background. */
  spill: number;
  saturation: number; contrast: number;
  lift: Triple; gain: Triple; shadows: Triple; highlights: Triple;
  vignette: number; aberration: number; grain: number;
};

export const GRADES: Record<GradeName, Grade> = {
  // Leaf-filtered daylight: golden highlights over faintly green shade.
  day: { bloom: .3, threshold: 1.35, knee: .55, radius: .8, spill: .22, saturation: 1.05, contrast: .12,
    lift: [.004, .006, .004], gain: [1.004, 1.0, .99], shadows: [.985, 1.0, 1.005], highlights: [1.012, 1.004, .985],
    vignette: .1, aberration: 0, grain: .012 },
  // Moonlight: cool, deeper shade and wide halos for the fireflies.
  night: { bloom: .8, threshold: 1.5, knee: .5, radius: .88, spill: 1, saturation: .94, contrast: .14,
    lift: [.002, .005, .009], gain: [.985, 1.0, 1.02], shadows: [.96, 1.0, 1.04], highlights: [1.0, 1.01, .985],
    vignette: .16, aberration: 0, grain: .016 },
  // A soft, silvery shower: cooler shade, gentler contrast, damp greens.
  rain: { bloom: .34, threshold: 1.3, knee: .55, radius: .85, spill: .35, saturation: .9, contrast: .1,
    lift: [.008, .011, .014], gain: [.985, 1.0, 1.015], shadows: [.95, 1.0, 1.05], highlights: [1.0, 1.005, 1.0],
    vignette: .14, aberration: 0, grain: .016 },
  // Anatomy stays close to neutral so tissue colors remain readable.
  anatomy: { bloom: .2, threshold: 1.3, knee: .6, radius: .75, spill: .2, saturation: 1.03, contrast: .08,
    lift: [.004, .004, .004], gain: [1, 1, 1], shadows: [1, 1, 1], highlights: [1, 1, 1],
    vignette: .08, aberration: 0, grain: .008 },
  brain: { bloom: .55, threshold: .8, knee: .6, radius: .85, spill: 1, saturation: 1.01, contrast: .12,
    lift: [.006, .005, .006], gain: [1.008, 1, .995], shadows: [1.0, .99, 1.0], highlights: [1.01, 1, .99],
    vignette: .3, aberration: .5, grain: .016 },
  heart: { bloom: .5, threshold: .85, knee: .6, radius: .85, spill: 1, saturation: 1.05, contrast: .14,
    lift: [.012, .005, .007], gain: [1.02, .99, .98], shadows: [1.03, .97, .99], highlights: [1.02, .995, .97],
    vignette: .3, aberration: .5, grain: .016 },
  // The white sclera is bright; keep its halo to the wet highlights.
  eye: { bloom: .3, threshold: 1.6, knee: .5, radius: .8, spill: .6, saturation: 1.05, contrast: .12,
    lift: [.004, .010, .012], gain: [.99, 1.0, 1.02], shadows: [.96, 1.0, 1.03], highlights: [1.02, 1.0, .98],
    vignette: .28, aberration: .45, grain: .014 },
  lung: { bloom: .5, threshold: .85, knee: .6, radius: .85, spill: 1, saturation: 1.04, contrast: .12,
    lift: [.010, .007, .010], gain: [1.01, .995, .99], shadows: [1.0, .98, 1.02], highlights: [1.02, 1.0, .98],
    vignette: .28, aberration: .45, grain: .014 },
};

const VERTEX = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Jimenez 2014 13-tap downsample. The first pass uses a Karis average so a
// single sparkling pixel cannot make the whole halo flicker.
const DOWNSAMPLE = /* glsl */`
  uniform sampler2D tInput; uniform vec2 texel; uniform vec3 curve; uniform float threshold;
  varying vec2 vUv;
  vec3 tap(vec2 offset) { return texture2D(tInput, vUv + texel * offset).rgb; }
  float karis(vec3 c) { return 1.0 / (1.0 + dot(c, vec3(.2126, .7152, .0722)) * .25); }
  void main() {
    vec3 a = tap(vec2(-2., 2.)), b = tap(vec2(0., 2.)), c = tap(vec2(2., 2.));
    vec3 d = tap(vec2(-2., 0.)), e = tap(vec2(0.)), f = tap(vec2(2., 0.));
    vec3 g = tap(vec2(-2., -2.)), h = tap(vec2(0., -2.)), i = tap(vec2(2., -2.));
    vec3 j = tap(vec2(-1., 1.)), k = tap(vec2(1., 1.)), l = tap(vec2(-1., -1.)), m = tap(vec2(1., -1.));
    #ifdef PREFILTER
      vec3 g0 = (a + b + d + e) * .25, g1 = (b + c + e + f) * .25;
      vec3 g2 = (d + e + g + h) * .25, g3 = (e + f + h + i) * .25, g4 = (j + k + l + m) * .25;
      float w0 = .125 * karis(g0), w1 = .125 * karis(g1), w2 = .125 * karis(g2), w3 = .125 * karis(g3), w4 = .5 * karis(g4);
      vec3 color = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
      // Quadratic soft knee: highlights fade in rather than switching on.
      float brightness = max(color.r, max(color.g, color.b));
      float soft = clamp(brightness - curve.x, 0.0, curve.y);
      soft = soft * soft * curve.z;
      color *= max(soft, brightness - threshold) / max(brightness, 1e-4);
    #else
      vec3 color = e * .125 + (a + c + g + i) * .03125 + (b + d + f + h) * .0625 + (j + k + l + m) * .125;
    #endif
    gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
  }
`;

// 3x3 tent upsample, accumulated additively into the next larger mip.
const UPSAMPLE = /* glsl */`
  uniform sampler2D tInput; uniform vec2 texel; uniform float radius;
  varying vec2 vUv;
  vec3 tap(vec2 offset) { return texture2D(tInput, vUv + texel * offset * radius).rgb; }
  void main() {
    vec3 color = tap(vec2(0.)) * 4.0
      + (tap(vec2(0., 1.)) + tap(vec2(-1., 0.)) + tap(vec2(1., 0.)) + tap(vec2(0., -1.))) * 2.0
      + tap(vec2(-1., 1.)) + tap(vec2(1., 1.)) + tap(vec2(-1., -1.)) + tap(vec2(1., -1.));
    gl_FragColor = vec4(color / 16.0, 1.0);
  }
`;

const COMPOSITE = /* glsl */`
  uniform sampler2D tScene; uniform sampler2D tBloom;
  uniform vec2 resolution; uniform float pixelRatio; uniform float time; uniform float exposure;
  uniform float bloomStrength; uniform float spillStrength; uniform float saturation; uniform float contrast;
  uniform vec3 lift; uniform vec3 gain; uniform vec3 shadows; uniform vec3 highlights;
  uniform float vignette; uniform float aberration; uniform float grain;
  varying vec2 vUv;

  // AgX, matching three's implementation so the pipeline keeps the gallery's
  // established response while bloom and grading happen in linear light.
  const mat3 SRGB_TO_REC2020 = mat3(vec3(.6274, .0691, .0164), vec3(.3293, .9195, .0880), vec3(.0433, .0113, .8956));
  const mat3 REC2020_TO_SRGB = mat3(vec3(1.6605, -.1246, -.0182), vec3(-.5876, 1.1329, -.1006), vec3(-.0728, -.0083, 1.1187));
  vec3 agxContrast(vec3 x) {
    vec3 x2 = x * x, x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + .4298 * x2 + .1191 * x - .00232;
  }
  vec3 agx(vec3 color) {
    const mat3 inset = mat3(vec3(.856627153315983, .137318972929847, .11189821299995),
      vec3(.0951212405381588, .761241990602591, .0767994186031903), vec3(.0482516061458583, .101439036467562, .811302368396859));
    const mat3 outset = mat3(vec3(1.1271005818144368, -.1413297634984383, -.14132976349843826),
      vec3(-.11060664309660323, 1.157823702216272, -.11060664309660294), vec3(-.016493938717834573, -.016493938717834257, 1.2519364065950405));
    color = inset * (SRGB_TO_REC2020 * (color * exposure));
    color = clamp((log2(max(color, 1e-10)) + 12.47393) / 16.49999, 0.0, 1.0);
    color = outset * agxContrast(color);
    return clamp(REC2020_TO_SRGB * pow(max(color, vec3(0.0)), vec3(2.2)), 0.0, 1.0);
  }
  vec3 encode(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - .055, step(.0031308, c)); }
  float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }

  vec3 grade(vec3 c) {
    c = c * gain + lift * (1.0 - c);
    float luma = dot(c, vec3(.2126, .7152, .0722));
    c *= mix(shadows, highlights, smoothstep(.12, .82, luma));
    c = clamp(c, 0.0, 1.0);
    c = mix(c, c * c * (3.0 - 2.0 * c), contrast);
    luma = dot(c, vec3(.2126, .7152, .0722));
    return clamp(mix(vec3(luma), c, saturation), 0.0, 1.0);
  }

  void main() {
    vec2 centered = vUv - .5;
    vec4 scene = texture2D(tScene, vUv);
    if (aberration > 0.0) {
      // Lateral fringing grows toward the frame edge, like a fast macro lens.
      vec2 shift = centered * dot(centered, centered) * aberration * .018;
      scene.r = texture2D(tScene, vUv + shift).r;
      scene.b = texture2D(tScene, vUv - shift).b;
    }
    vec3 bloom = texture2D(tBloom, vUv).rgb * bloomStrength;
    float alpha = clamp(scene.a, 0.0, 1.0);
    // Scene colors are premultiplied. Tone map the covered surface and the
    // light that spills past it separately, then recombine by coverage.
    vec3 surface = grade(encode(agx(scene.rgb / max(alpha, 1e-4) + bloom)));
    // Glow onto the page fades out before the canvas edge so the rectangle
    // never shows, and daylight keeps it faint over the pale paper.
    vec2 edge = min(vUv, 1.0 - vUv) * resolution / max(pixelRatio, 1.0);
    vec3 spill = encode(agx(bloom)) * spillStrength * smoothstep(0.0, 90.0, min(edge.x, edge.y));
    float vignetteShade = mix(1.0, smoothstep(1.02, .22, length(centered * vec2(1.0, .82)) * 1.35), vignette);
    vec2 pixel = floor(gl_FragCoord.xy / max(pixelRatio, 1.0));
    float noise = hash(pixel + fract(time * 7.13) * 431.0) - .5;
    float luma = dot(surface, vec3(.2126, .7152, .0722));
    surface += noise * grain * (1.0 - abs(luma - .45) * 1.4);
    vec3 color = (alpha * surface + (1.0 - alpha) * spill) * vignetteShade;
    // Triangular dither hides 8-bit banding in the dark halos.
    float dither = hash(gl_FragCoord.xy + 17.0) + hash(gl_FragCoord.xy * 1.37 + 3.1) - 1.0;
    color += dither / 255.0 * step(1e-3, alpha + color.r + color.g + color.b);
    gl_FragColor = vec4(clamp(color, 0.0, 1.0), alpha);
  }
`;

type Options = { maxBloomLevels?: number };

export function createRenderPipeline(renderer: THREE.WebGLRenderer, options: Options = {}) {
  const extensions = renderer.extensions;
  const floatTargets = extensions.has('EXT_color_buffer_float') || extensions.has('EXT_color_buffer_half_float');
  const drawing = new THREE.Vector2();
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: true,
    // Only color is sampled later. Skipping the depth/stencil resolve saves a
    // full-screen blit and keeps D3D-backed ANGLE off its slow stencil path.
    resolveDepthBuffer: false, resolveStencilBuffer: false,
    samples: Math.min(4, renderer.capabilities.maxSamples), generateMipmaps: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  target.texture.name = 'Gallery HDR';
  // Some drivers cannot multisample a half-float target. Check the real
  // framebuffer so those devices fall back to direct rendering, not black.
  const supported = floatTargets && (() => {
    const gl = renderer.getContext(), previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    renderer.setRenderTarget(previous);
    return complete;
  })();
  const mips: THREE.WebGLRenderTarget[] = [];
  const maxLevels = options.maxBloomLevels ?? 6;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(geometry);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);

  const pass = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, string> = {}, additive = false) => new THREE.ShaderMaterial({
    vertexShader: VERTEX, fragmentShader, uniforms, defines, depthTest: false, depthWrite: false, toneMapped: false,
    blending: additive ? THREE.CustomBlending : THREE.NoBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
  });
  const prefilter = pass(DOWNSAMPLE, { tInput: { value: null }, texel: { value: new THREE.Vector2() },
    curve: { value: new THREE.Vector3() }, threshold: { value: 1 } }, { PREFILTER: '' });
  const downsample = pass(DOWNSAMPLE, { tInput: { value: null }, texel: { value: new THREE.Vector2() },
    curve: { value: new THREE.Vector3() }, threshold: { value: 1 } });
  const upsample = pass(UPSAMPLE, { tInput: { value: null }, texel: { value: new THREE.Vector2() }, radius: { value: .85 } }, {}, true);
  const composite = pass(COMPOSITE, {
    tScene: { value: target.texture }, tBloom: { value: null }, resolution: { value: new THREE.Vector2(1, 1) },
    pixelRatio: { value: 1 }, time: { value: 0 }, exposure: { value: 1 }, bloomStrength: { value: 0 }, spillStrength: { value: 1 },
    saturation: { value: 1 }, contrast: { value: 0 }, lift: { value: new THREE.Vector3() }, gain: { value: new THREE.Vector3(1, 1, 1) },
    shadows: { value: new THREE.Vector3(1, 1, 1) }, highlights: { value: new THREE.Vector3(1, 1, 1) },
    vignette: { value: 0 }, aberration: { value: 0 }, grain: { value: 0 },
  });
  const u = composite.uniforms;

  // Current grade values ease toward the requested preset.
  let gradeName: GradeName = 'day';
  const current: Grade = structuredClone(GRADES.day);
  let exposureScale = 1, exposureTarget = 1, time = 0, settling = false;
  const vectors = { lift: u.lift.value as THREE.Vector3, gain: u.gain.value as THREE.Vector3,
    shadows: u.shadows.value as THREE.Vector3, highlights: u.highlights.value as THREE.Vector3 };

  function resize() {
    renderer.getDrawingBufferSize(drawing);
    const width = Math.max(1, drawing.x), height = Math.max(1, drawing.y);
    if (target.width === width && target.height === height && mips.length) return;
    target.setSize(width, height);
    for (const mip of mips) mip.dispose();
    mips.length = 0;
    let w = Math.max(1, width >> 1), h = Math.max(1, height >> 1);
    while (mips.length < maxLevels && Math.min(w, h) >= 6) {
      const mip = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false,
        generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      mip.texture.name = `Gallery bloom ${mips.length}`;
      mips.push(mip);
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
    }
    (u.resolution.value as THREE.Vector2).set(width, height);
  }

  function draw(material: THREE.ShaderMaterial, output: THREE.WebGLRenderTarget | null) {
    quad.material = material;
    renderer.setRenderTarget(output);
    renderer.render(quadScene, quadCamera);
  }

  function update(dt: number) {
    time += dt;
    const goal = GRADES[gradeName];
    const k = 1 - Math.exp(-4.5 * Math.max(dt, 0));
    let delta = 0;
    for (const key of ['bloom', 'threshold', 'knee', 'radius', 'spill', 'saturation', 'contrast', 'vignette', 'aberration', 'grain'] as const) {
      delta = Math.max(delta, Math.abs(goal[key] - current[key]));
      current[key] += (goal[key] - current[key]) * k;
    }
    for (const key of ['lift', 'gain', 'shadows', 'highlights'] as const) {
      for (let i = 0; i < 3; i++) {
        delta = Math.max(delta, Math.abs(goal[key][i] - current[key][i]));
        current[key][i] += (goal[key][i] - current[key][i]) * k;
      }
    }
    delta = Math.max(delta, Math.abs(exposureTarget - exposureScale));
    exposureScale += (exposureTarget - exposureScale) * (1 - Math.exp(-2.4 * Math.max(dt, 0)));
    settling = delta > .002;
    return settling;
  }

  function render(scene: THREE.Scene, camera: THREE.Camera) {
    resize();
    const autoClear = renderer.autoClear;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.autoClear = false;
    // Bloom mip chain: prefilter + downsample, then tent upsample back up.
    const knee = Math.max(current.threshold * current.knee, 1e-4);
    for (const material of [prefilter, downsample]) {
      (material.uniforms.curve.value as THREE.Vector3).set(current.threshold - knee, knee * 2, .25 / knee);
      material.uniforms.threshold.value = current.threshold;
    }
    let input: THREE.Texture = target.texture, inputWidth = target.width, inputHeight = target.height;
    for (let i = 0; i < mips.length; i++) {
      const material = i === 0 ? prefilter : downsample;
      material.uniforms.tInput.value = input;
      (material.uniforms.texel.value as THREE.Vector2).set(1 / inputWidth, 1 / inputHeight);
      draw(material, mips[i]);
      input = mips[i].texture; inputWidth = mips[i].width; inputHeight = mips[i].height;
    }
    upsample.uniforms.radius.value = current.radius;
    for (let i = mips.length - 2; i >= 0; i--) {
      upsample.uniforms.tInput.value = mips[i + 1].texture;
      (upsample.uniforms.texel.value as THREE.Vector2).set(1 / mips[i + 1].width, 1 / mips[i + 1].height);
      draw(upsample, mips[i]);
    }
    u.tBloom.value = mips[0]?.texture ?? null;
    u.bloomStrength.value = mips.length ? current.bloom / mips.length : 0;
    u.exposure.value = renderer.toneMappingExposure * exposureScale;
    u.pixelRatio.value = renderer.getPixelRatio();
    u.time.value = time;
    u.spillStrength.value = current.spill;
    u.saturation.value = current.saturation; u.contrast.value = current.contrast;
    u.vignette.value = current.vignette; u.aberration.value = current.aberration; u.grain.value = current.grain;
    vectors.lift.fromArray(current.lift); vectors.gain.fromArray(current.gain);
    vectors.shadows.fromArray(current.shadows); vectors.highlights.fromArray(current.highlights);
    draw(composite, null);
    renderer.autoClear = autoClear;
    // Leave the HDR target bound so shader warm-up between frames compiles
    // the same program variants (linear output, no tone mapping) used here.
    renderer.setRenderTarget(target);
  }

  return {
    supported,
    target,
    get settling() { return settling; },
    get grade() { return gradeName; },
    setGrade(name: GradeName) { gradeName = name; },
    /** Halves multisampling once, for devices still slow at the lowest pixel ratio. */
    reduceQuality() {
      if (target.samples <= 2) return false;
      target.samples = 2; target.dispose();
      return true;
    },
    /** Scales exposure on top of the renderer's, for light-up transitions. */
    setExposureScale(value: number, immediate = false) { exposureTarget = value; if (immediate) exposureScale = value; },
    update,
    render,
    /** Warm programs for the HDR target rather than the default framebuffer. */
    async compile(scene: THREE.Object3D, camera: THREE.Camera, targetScene?: THREE.Scene) {
      resize();
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      try { await renderer.compileAsync(scene, camera, targetScene); } finally { renderer.setRenderTarget(previous); }
    },
    dispose() {
      renderer.setRenderTarget(null);
      target.dispose(); for (const mip of mips) mip.dispose(); mips.length = 0;
      geometry.dispose(); prefilter.dispose(); downsample.dispose(); upsample.dispose(); composite.dispose();
    },
  };
}
export type RenderPipeline = ReturnType<typeof createRenderPipeline>;
