import * as THREE from 'three';

/**
 * Split-view finish. Tissue that meets the cutting plane gets a thin warm
 * rim, as if the section had been cut with light, and the flat section caps
 * gain fine cellular mottling and a moist sheen. Both are shader-only: the
 * clipping plane, stencil passes and part metadata are untouched.
 */
const RIM_COLOR = new THREE.Color(1.6, 1.18, .78);
const rim = { value: RIM_COLOR };

function chain(material: THREE.Material, key: string, apply: (shader: THREE.WebGLProgramParametersWithUniforms) => void) {
  const previous = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => { previous(shader, renderer); apply(shader); };
  material.customProgramCacheKey = () => `${previousKey}|${key}`;
}

/** Adds the glowing section rim to a lit material that may be clipped. */
export function applySectionRim(material: THREE.Material) {
  if (!(material instanceof THREE.MeshStandardMaterial) || material.userData.sectionRim) return;
  material.userData.sectionRim = true;
  chain(material, 'section-rim-v1', shader => {
    shader.uniforms.sectionRimColor = rim;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 sectionRimColor;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #if NUM_CLIPPING_PLANES > 0
          // Distance to the live plane in pixels keeps the line crisp at any zoom.
          float sectionDepth = clippingPlanes[ 0 ].w - dot( vClipPosition, clippingPlanes[ 0 ].xyz );
          float sectionPixel = max( fwidth( sectionDepth ), 1e-5 );
          float sectionLine = 1. - smoothstep( 0., sectionPixel * 1.8, sectionDepth );
          float sectionHalo = 1. - smoothstep( 0., sectionPixel * 10., sectionDepth );
          totalEmissiveRadiance += sectionRimColor * ( sectionLine * .85 + sectionHalo * sectionHalo * .16 );
        #endif`);
  });
}

/** Cellular mottling and a moist, uneven sheen for a section cap. */
export function applySectionCapDetail(material: THREE.MeshStandardMaterial) {
  chain(material, 'section-cap-v1', shader => {
    // The cap plane only slides along its normal, so its local XY are stable
    // in-plane coordinates in world units.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSectionPlane;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSectionPlane = position.xy;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vSectionPlane;
        vec2 sectionCell( vec2 p ) {
          vec2 cell = floor( p ), local = fract( p );
          float nearest = 8., second = 8.;
          for ( int x = -1; x <= 1; x ++ ) for ( int y = -1; y <= 1; y ++ ) {
            vec2 offset = vec2( x, y );
            vec2 jitter = fract( sin( vec2( dot( cell + offset, vec2( 127.1, 311.7 ) ), dot( cell + offset, vec2( 269.5, 183.3 ) ) ) ) * 43758.5453 );
            float d = length( offset + jitter - local );
            if ( d < nearest ) { second = nearest; nearest = d; } else if ( d < second ) second = d;
          }
          return vec2( nearest, second );
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 sectionCells = sectionCell( vSectionPlane * 38. );
        float sectionWall = 1. - smoothstep( .02, .09, sectionCells.y - sectionCells.x );
        vec2 sectionCoarse = vSectionPlane * 6.;
        vec2 sectionI = floor( sectionCoarse ), sectionF = fract( sectionCoarse );
        sectionF = sectionF * sectionF * ( 3. - 2. * sectionF );
        vec4 sectionCorners = fract( sin( vec4( dot( sectionI, vec2( 12.9898, 78.233 ) ), dot( sectionI + vec2( 1., 0. ), vec2( 12.9898, 78.233 ) ),
          dot( sectionI + vec2( 0., 1. ), vec2( 12.9898, 78.233 ) ), dot( sectionI + 1., vec2( 12.9898, 78.233 ) ) ) ) * 43758.5453 );
        float sectionMottle = mix( mix( sectionCorners.x, sectionCorners.y, sectionF.x ), mix( sectionCorners.z, sectionCorners.w, sectionF.x ), sectionF.y );
        diffuseColor.rgb *= ( .9 + .14 * sectionMottle ) * ( 1. - sectionWall * .16 );`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix( .38, .72, sectionMottle ) + sectionWall * .1;`);
  });
}
