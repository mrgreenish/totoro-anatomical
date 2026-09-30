import * as THREE from 'three';

/**
 * Forest light for the exterior materials.
 *
 * Komorebi: the key light passes through two swaying canopy layers before it
 * reaches Totoro, the plinth and the falling leaves. The canopy is a tiling
 * mask projected along the light direction, so the dappling behaves like a
 * gobo instead of a screen overlay and costs two texture reads per fragment.
 * Firefly glows are evaluated with each material's own BRDF, so wet eyes and
 * teeth pick up tiny highlights while the fur receives a soft warm pool.
 */
export const FOREST_GLOWS = 2;

const PARS = /* glsl */`
  uniform sampler2D forestCanopyMap;
  uniform float forestTime;
  uniform float forestCanopy;
  uniform vec2 forestCanopyRange;
  uniform vec3 forestCanopyShade;
  uniform vec3 forestLightRight;
  uniform vec3 forestLightUp;
  uniform float forestGlowActive;
  uniform vec3 forestGlowPositions[ ${FOREST_GLOWS} ];
  uniform vec3 forestGlowColors[ ${FOREST_GLOWS} ];
  uniform float forestGlowFalloff;
  float forestCanopyOpening( vec3 world ) {
    vec2 p = vec2( dot( world, forestLightRight ), dot( world, forestLightUp ) );
    float t = forestTime;
    // Upper boughs sway slowly; the lower layer answers faster and wider, so
    // the gaps between them open, close and drift like real leaf light.
    vec2 upper = p * .2 + vec2( sin( t * .31 + p.y * .5 ), cos( t * .23 + p.x * .41 ) ) * .01 + vec2( t * .0017, t * .0011 );
    vec2 lower = p * .34 + vec2( .37, .61 ) + vec2( sin( t * .57 + p.y * .9 + 1.3 ), cos( t * .49 - p.x * .8 ) ) * .014;
    return smoothstep( .34, .66, texture2D( forestCanopyMap, upper ).r ) * smoothstep( .32, .68, texture2D( forestCanopyMap, lower ).g );
  }
  // Shade is not black: some sun still filters through the leaves, turning green.
  vec3 forestCanopyLight( vec3 world ) {
    vec3 light = mix( forestCanopyShade * forestCanopyRange.x, vec3( forestCanopyRange.y ), forestCanopyOpening( world ) );
    return mix( vec3( 1.0 ), light, forestCanopy );
  }
`;

const DIRECT_CALL = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
const LIGHTS = (() => {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const directional = chunk.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )');
  const call = chunk.indexOf(DIRECT_CALL, directional);
  const end = chunk.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 )', call);
  if (directional < 0 || call < 0 || end < 0) return undefined;
  return /* glsl */`
    vec3 forestWorldPosition = transpose( mat3( viewMatrix ) ) * ( - vViewPosition - viewMatrix[ 3 ].xyz );
    ${chunk.slice(0, call)}
    // The shadow-casting key light is sorted first, so index 0 is the sun.
    #if UNROLLED_LOOP_INDEX == 0
      directLight.color *= forestCanopyLight( forestWorldPosition );
    #endif
    ${chunk.slice(call, end)}
    #if defined( RE_Direct )
      if ( forestGlowActive > 0.0 ) {
        for ( int glow = 0; glow < ${FOREST_GLOWS}; glow ++ ) {
          vec3 toGlow = forestGlowPositions[ glow ] - geometryPosition;
          float glowDistance2 = max( dot( toGlow, toGlow ), 1e-5 );
          directLight.direction = toGlow * inversesqrt( glowDistance2 );
          directLight.color = forestGlowColors[ glow ] / ( 1.0 + glowDistance2 * forestGlowFalloff );
          directLight.visible = true;
          ${DIRECT_CALL}
        }
      }
    #endif
    ${chunk.slice(end)}
  `;
})();

/** A seamless two-layer canopy mask: red is the high boughs, green the low branches. */
function createCanopyTexture(size: number) {
  const paint = (seed: number, clusters: number, radius: readonly [number, number], leaves: readonly [number, number]) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return new Uint8ClampedArray(size * size * 4).fill(255);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, size, size);
    let state = seed;
    const random = () => { state = (state * 16807) % 2147483647; return state / 2147483647; };
    for (let c = 0; c < clusters; c++) {
      const cx = random() * size, cy = random() * size, spread = size * radius[1] * 1.7;
      const count = leaves[0] + Math.floor(random() * (leaves[1] - leaves[0] + 1));
      for (let l = 0; l < count; l++) {
        const r = size * (radius[0] + random() * (radius[1] - radius[0]));
        const x = cx + (random() - .5) * spread, y = cy + (random() - .5) * spread;
        const angle = random() * Math.PI, aspect = .38 + random() * .4, depth = .55 + random() * .4;
        for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
          if (x + ox + r < 0 || x + ox - r > size || y + oy + r < 0 || y + oy - r > size) continue;
          context.save();
          context.translate(x + ox, y + oy); context.rotate(angle); context.scale(1, aspect);
          const gradient = context.createRadialGradient(0, 0, r * .12, 0, 0, r);
          gradient.addColorStop(0, `rgba(0,0,0,${depth})`);
          gradient.addColorStop(.62, `rgba(0,0,0,${depth * .72})`);
          gradient.addColorStop(1, 'rgba(0,0,0,0)');
          context.fillStyle = gradient;
          context.beginPath(); context.arc(0, 0, r, 0, Math.PI * 2); context.fill();
          context.restore();
        }
      }
    }
    return context.getImageData(0, 0, size, size).data;
  };
  // Tuned for roughly 45% open sky: distinct sun flecks without losing the sculpture in shade.
  const upper = paint(29, 36, [.035, .095], [3, 7]);
  const lower = paint(83, 56, [.025, .06], [2, 5]);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = upper[i * 4]; data[i * 4 + 1] = lower[i * 4]; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createForestLight(lightPosition: THREE.Vector3, lightTarget: THREE.Vector3) {
  const direction = lightTarget.clone().sub(lightPosition).normalize();
  const right = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, direction).normalize();
  const canopy = createCanopyTexture(256);
  const uniforms = {
    forestCanopyMap: { value: canopy },
    forestTime: { value: 0 },
    forestCanopy: { value: 1 },
    forestCanopyRange: { value: new THREE.Vector2(.5, 1.42) },
    forestCanopyShade: { value: new THREE.Color(.8, 1, .7) },
    forestLightRight: { value: right },
    forestLightUp: { value: up },
    forestGlowActive: { value: 0 },
    forestGlowPositions: { value: Array.from({ length: FOREST_GLOWS }, () => new THREE.Vector3()) },
    forestGlowColors: { value: Array.from({ length: FOREST_GLOWS }, () => new THREE.Vector3()) },
    forestGlowFalloff: { value: 7 },
  };
  /** Adds the canopy and firefly light to a lit built-in material. */
  function patch(material: THREE.Material, extra?: (shader: THREE.WebGLProgramParametersWithUniforms) => void, extraKey = '') {
    if (!LIGHTS) return;
    const previous = material.onBeforeCompile.bind(material);
    const key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      previous(shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${PARS}`)
        .replace('#include <lights_fragment_begin>', LIGHTS);
      extra?.(shader);
    };
    material.customProgramCacheKey = () => `${key}|forest-light-v1|${extraKey}`;
  }
  return {
    uniforms, patch, direction,
    /** Shared GLSL for custom shaders that want the same canopy. */
    glsl: PARS,
    dispose() { canopy.dispose(); },
  };
}
export type ForestLight = ReturnType<typeof createForestLight>;
