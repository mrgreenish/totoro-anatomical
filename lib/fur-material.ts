import * as THREE from 'three';

/**
 * Fur shading for the exterior coat.
 *
 * Every coat surface is lit as hair rather than as a smooth shell: a
 * Kajiya-Kay style model (Scheuermann 2004) spreads light along each hair's
 * direction, with a pale primary highlight and a broader, color-tinted
 * secondary one shifted toward the root, a wrapped diffuse term for light
 * scattered through the coat, and a glow at the edges when the light is
 * behind. Hair direction follows the same groom as the Blender strands: the
 * skin uses that flow field, and each strand ribbon projects it onto its own
 * plane, which keeps the strand's lift and gives every hair its own glint.
 *
 * The skin under the strands carries the dense undercoat. A small tiling 3D
 * texture, generated at load, gives fine hairs, locks and the darker partings
 * between them. It is sampled in the skin's rest pose, so the pattern moves
 * with breathing, and mipmapping fades it smoothly with distance.
 */

export type FurKind = 'torso' | 'limb' | 'tail' | 'ear';
const KIND_INDEX: Record<FurKind, number> = { torso: 0, limb: 1, tail: 2, ear: 3 };

export function furKindOf(name: string): FurKind {
  if (name.startsWith('Tail')) return 'tail';
  if (name.startsWith('Ear_')) return 'ear';
  if (name.startsWith('Arm_') || name.startsWith('Foot_')) return 'limb';
  return 'torso';
}

/** Tiling white noise in four channels: hair tone, lock tone, and two direction jitters. */
function createFurVolume(size: number) {
  const data = new Uint8Array(size * size * size * 4);
  let state = 0x2f6b1d;
  for (let i = 0; i < data.length; i++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    data[i] = (state >>> 0) & 255;
  }
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

// The groom: the same flow field build_totoro.py gives the strands, in the
// glTF's Y-up rest space. Blender (x, y, z) is (x, -z, y) here.
const FLOW = /* glsl */`
  uniform int furKind;
  vec3 furFlowField( vec3 p, vec3 n ) {
    vec3 d;
    if ( furKind == 2 ) d = vec3( p.x * .25, -.25, -1. );          // tail: combed back
    else if ( furKind == 3 ) d = vec3( p.x * .08, 1., -.12 );      // ears: toward the tips
    else {
      float sweep = .24 * sin( p.x * 2.3 + p.y * 1.8 );
      if ( furKind == 0 ) {
        // Cheeks sweep outward and the chest fans out, on the front only.
        float front = smoothstep( -.15, .15, p.z );
        sweep += front * p.x * mix( .22 * smoothstep( .3, .5, p.y ), .5, smoothstep( 2.6, 2.8, p.y ) );
      }
      d = vec3( sweep, -1., -.1 * sin( p.x * 3. - p.z * 2. ) );
    }
    vec3 f = d - n * dot( d, n );
    float len2 = dot( f, f );
    // At the crown and soles the flow points into the surface; any tangent will do.
    return len2 > 1e-4 ? f * inversesqrt( len2 ) : normalize( cross( n, vec3( 1., 0., 0. ) ) );
  }
`;

const BRDF = /* glsl */`
  vec3 furT;          // hair direction, view space
  float furGloss;     // highlight strength of the hairs at this fragment
  float furOcclusion; // light reaching this depth of the coat
  uniform vec4 furLobes;      // primary shift, primary exponent, secondary shift, secondary exponent
  uniform vec4 furStrength;   // primary, secondary, backlit scatter, wrap
  uniform float furRoughness; // dry roughness; rain lowers it
  // sin(t, h)^e = (1 - cos²)^(e/2) ≈ exp(-e/2 · cos²): one exp2 instead of log2 and exp2.
  float furKajiya( float th, float exponent ) {
    return smoothstep( -1., 0., th ) * exp2( -.7213 * exponent * th * th );
  }
  void RE_Direct_Fur( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
    vec3 l = directLight.direction, n = geometryNormal, v = geometryViewDir;
    float nl = dot( n, l );
    // A coat scatters light past the terminator, and hairs lit side-on catch the most.
    float wrap = furStrength.w;
    float tl = dot( furT, l );
    float diffuse = clamp( ( nl + wrap ) / ( 1. + wrap ), 0., 1. ) * ( 1. - .35 * tl * tl );
    reflectedLight.directDiffuse += directLight.color * diffuse * furOcclusion * BRDF_Lambert( material.diffuseColor );
    // Rain slicks the coat: glossier, tighter highlights.
    float wet = clamp( ( furRoughness - material.roughness ) / max( furRoughness - .42, .01 ), 0., 1. );
    vec3 h = normalize( l + v );
    // Both lobes tilt the hair toward the normal; with t ⟂ n the tilted tangent
    // has length sqrt(1 + shift²), folded into the dot products here.
    float th = dot( furT, h ), nh = dot( n, h );
    float primary = furKajiya( ( th + furLobes.x * nh ) * inversesqrt( 1. + furLobes.x * furLobes.x ), furLobes.y * ( 1. + 2. * wet ) );
    float secondary = furKajiya( ( th + furLobes.z * nh ) * inversesqrt( 1. + furLobes.z * furLobes.z ), furLobes.w );
    vec3 highlight = vec3( primary * furStrength.x * ( 1. + 2.5 * wet ) ) + material.diffuseColor * ( secondary * furStrength.y );
    // Light behind the coat scatters forward through the tips at the outline.
    float behind = clamp( - dot( v, l ), 0., 1. ), edge = 1. - clamp( dot( n, v ), 0., 1. );
    behind *= behind; edge *= edge;
    float lit = smoothstep( -.2, .35, nl );
    reflectedLight.directSpecular += directLight.color * RECIPROCAL_PI * ( highlight * lit * furGloss + material.diffuseColor * ( behind * behind * edge * furStrength.z ) );
  }
`;

const SKIN = /* glsl */`
  uniform highp sampler3D furVolume;
  uniform int furKind;
  uniform vec4 furGrain;      // hair across, hair along, lock across, lock along (texture tiles per unit)
  uniform vec3 furTone;       // hair contrast, lock contrast, parting depth
  // Hairs stretch along the groom: down the body, back along the tail.
  vec3 furStretch( float across, float along ) {
    return furKind == 2 ? vec3( across, across, along ) : vec3( across, along, across );
  }
`;

export type FurMaterialOptions = {
  source: THREE.MeshStandardMaterial; fibers: boolean; kind: FurKind; vertexColors: boolean;
};

export function createFurShading() {
  const volume = createFurVolume(64);
  const shared = {
    furVolume: { value: volume },
    furLobes: { value: new THREE.Vector4(.1, 48, -.2, 12) },
    furStrength: { value: new THREE.Vector4(.08, .15, .5, .35) },
    furTone: { value: new THREE.Vector3(.5, .22, .22) },
    furGrain: { value: new THREE.Vector4(2.4, .8, .5, .25) },
    furRoughness: { value: .9 },
  };
  function create({ source, fibers, kind, vertexColors }: FurMaterialOptions) {
    const material = new THREE.MeshStandardMaterial({
      name: source.name, color: source.color, vertexColors,
      roughness: shared.furRoughness.value, metalness: 0,
      side: fibers ? THREE.DoubleSide : THREE.FrontSide,
    });
    const uniforms = { ...shared, furKind: { value: KIND_INDEX[kind] } };
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          ${FLOW}
          varying vec3 vFurPosition;
          varying vec3 vFurFlow;`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          vec3 furFlowObject = furFlowField( position, normal );`)
        .replace('#include <skinnormal_vertex>', `#include <skinnormal_vertex>
          #ifdef USE_SKINNING
            furFlowObject = ( skinMatrix * vec4( furFlowObject, 0. ) ).xyz;
          #endif`)
        .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
          vFurFlow = normalize( ( modelViewMatrix * vec4( furFlowObject, 0. ) ).xyz );`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vFurPosition = position;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vFurPosition;
          varying vec3 vFurFlow;
          ${fibers ? '' : SKIN}`)
        .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
          ${BRDF}
          #undef RE_Direct
          #define RE_Direct RE_Direct_Fur`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          ${fibers ? `
            // Strands carry their own root-to-tip color and occlusion.
            furGloss = 1.;
            furOcclusion = 1.;
          ` : `
            // Fine hairs sit inside combed locks; partings between locks are darker.
            vec4 furHair = texture( furVolume, vFurPosition * furStretch( furGrain.x, furGrain.y ) );
            vec4 furLock = texture( furVolume, vFurPosition * furStretch( furGrain.z, furGrain.w ) + .37 );
            // The face keeps short, even fur around the features, and the light
            // belly coat is softer; both show less of the lock structure.
            float furFace = furKind == 0 ? smoothstep( 0., .25, vFurPosition.z ) * smoothstep( 2.7, 2.95, vFurPosition.y )
              * ( 1. - smoothstep( .95, 1.2, abs( vFurPosition.x ) ) ) : 0.;
            float furSoft = max( furFace, .6 * smoothstep( .25, .55, dot( diffuseColor.rgb, vec3( .3, .59, .11 ) ) ) );
            float furStrandTone = ( furHair.r - .5 ) * ( 1. - .35 * furSoft );
            float furLockTone = ( furLock.g - .5 ) * ( 1. - .6 * furSoft );
            float furDepth = clamp( .5 + furLockTone * 1.6 + furStrandTone * .6, 0., 1. );
            furOcclusion = mix( 1. - furTone.z, 1., furDepth );
            furGloss = .35 + 1.3 * furDepth * ( .5 + furHair.r );
            diffuseColor.rgb *= ( 1. + furTone.x * furStrandTone ) * ( 1. + furTone.y * furLockTone );
          `}`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
          ${fibers ? `
            // Strand normals are the skin's, authored for both faces of the
            // ribbon: undo the back-face flip so every strand shades with its root.
            #ifdef DOUBLE_SIDED
              normal *= faceDirection;
            #endif
          ` : ''}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          vec3 furFlow = normalize( vFurFlow - normal * dot( vFurFlow, normal ) );
          ${fibers ? `
            // Each ribbon's plane holds its strand, so projecting the groom onto it
            // recovers the strand's lift and a little of its own direction.
            vec3 furPlane = cross( dFdx( - vViewPosition ), dFdy( - vViewPosition ) );
            vec3 furAlong = furFlow - furPlane * ( dot( furFlow, furPlane ) / max( dot( furPlane, furPlane ), 1e-30 ) );
            furT = dot( furAlong, furAlong ) > .01 ? normalize( furAlong ) : furFlow;
          ` : `
            // Individual hairs stray from the groom and lift off the skin.
            vec3 furAcross = cross( normal, furFlow );
            furT = normalize( furFlow + furAcross * ( furHair.b - .5 ) * .9 + normal * ( .2 + ( furHair.a - .5 ) * .3 ) );
            // Locks bulge between the partings.
            vec3 furSx = normalize( dFdx( - vViewPosition ) ), furSy = normalize( dFdy( - vViewPosition ) );
            vec3 furR1 = cross( furSy, normal ), furR2 = cross( normal, furSx );
            float furDet = dot( furSx, furR1 ) * faceDirection;
            vec3 furGrad = sign( furDet ) * ( dFdx( furDepth ) * furR1 + dFdy( furDepth ) * furR2 );
            normal = normalize( max( abs( furDet ), 1e-5 ) * normal - furGrad * .09 );
          `}`)
        .replace('#include <aomap_fragment>', `
          reflectedLight.indirectDiffuse *= furOcclusion;
          reflectedLight.indirectSpecular *= furOcclusion;
          #include <aomap_fragment>`);
    };
    material.customProgramCacheKey = () => `fur-v1-${fibers}`;
    return material;
  }
  return { create, uniforms: shared, dispose() { volume.dispose(); } };
}
export type FurShading = ReturnType<typeof createFurShading>;
