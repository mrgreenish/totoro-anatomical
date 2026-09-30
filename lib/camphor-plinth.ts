import * as THREE from 'three';
import type { ForestLight } from './forest-light';

/**
 * The plinth is a slice of the great camphor tree: oiled growth rings with
 * darker heartwood, radial drying checks, a bark rim and moss creeping over
 * one side. Everything is procedural in object space, so there are no
 * texture downloads and no seams. After dark, a few moss specks glow.
 */
export const PLINTH_RADIUS = 2.13;
const HEIGHT = .13;

/** Irregular growth outline; applied identically to the side and the cap rims. */
function barkRadius(angle: number) {
  return 1 + .011 * Math.sin(angle * 3 + .7) + .007 * Math.sin(angle * 7 + 2.1) + .003 * Math.sin(angle * 23 + .4);
}

const PARS = /* glsl */`
  varying vec3 vPlinthPosition;
  varying vec3 vPlinthNormal;
  uniform float plinthNight;
  float plinthHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  float plinthNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(plinthHash(i), plinthHash(i + vec2(1, 0)), f.x), mix(plinthHash(i + vec2(0, 1)), plinthHash(i + vec2(1, 1)), f.x), f.y);
  }
  float plinthFbm(vec2 p) { return plinthNoise(p) * .55 + plinthNoise(p * 2.13 + 7.1) * .3 + plinthNoise(p * 4.37 - 3.3) * .15; }
`;

const SURFACE = /* glsl */`
  vec3 plinthP = vPlinthPosition;
  float plinthTop = step(.5, vPlinthNormal.y);
  float plinthSide = 1. - plinthTop - step(vPlinthNormal.y, -.5);
  float plinthR = length(plinthP.xz);
  float plinthAngle = atan(plinthP.z, plinthP.x);
  vec2 pith = plinthP.xz - vec2(.13, -.08);
  float ringR = length(pith), ringAngle = atan(pith.y, pith.x);
  // Growth rings wander with the seasons of a very old tree.
  float wobble = (plinthFbm(vec2(ringAngle * 1.6, ringR * 1.2)) - .5) * .16 + (plinthNoise(vec2(ringAngle * 9., ringR * 3.)) - .5) * .03;
  float ringCoord = (ringR + wobble) * 15.5;
  float ringFrac = fract(ringCoord), ringId = floor(ringCoord);
  float ringDensity = fwidth(ringCoord);
  float latewood = smoothstep(.58, .9, ringFrac) * (1. - smoothstep(.93, 1., ringFrac)) * (1. - smoothstep(.3, .85, ringDensity));
  float ringTone = plinthHash(vec2(ringId, 3.7));
  // Linear albedos for oiled camphor: honey earlywood, darker latewood lines.
  vec3 wood = mix(vec3(.43, .25, .12), vec3(.53, .33, .16), ringTone);
  wood = mix(wood, vec3(.2, .095, .04), latewood * .8);
  float heartwood = 1. - smoothstep(1.05, 1.4, ringR + wobble);
  wood = mix(wood, wood * vec3(.82, .64, .52), heartwood * .65);
  float rays = smoothstep(.93, 1., plinthNoise(vec2(ringAngle * 70., ringR * 1.1)));
  wood *= (.93 + .1 * plinthNoise(plinthP.xz * vec2(95., 11.))) * (1. - rays * .07);
  // Radial drying checks, widest at the rim.
  float check = 0.;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float checkAngle = plinthHash(vec2(fi, 1.3)) * 6.2831853;
    float reach = .25 + plinthHash(vec2(fi, 8.1)) * .8;
    float arc = abs(mod(ringAngle - checkAngle + 3.1415927, 6.2831853) - 3.1415927) * ringR;
    arc += (plinthNoise(vec2(ringR * 7., fi * 3.)) - .5) * .035;
    float start = 2.08 - reach;
    float width = .014 * smoothstep(start, 2.08, ringR) + .001;
    check = max(check, (1. - smoothstep(width * .25, width, arc)) * smoothstep(start - .02, start + .06, ringR));
  }
  wood = mix(wood, vec3(.035, .018, .01), check * .92);
  // Bark rim with a pale cambium line just inside it.
  float barkEdge = ${PLINTH_RADIUS.toFixed(3)} - .09 - plinthNoise(vec2(plinthAngle * 11., 1.3)) * .035;
  float barkTop = smoothstep(barkEdge - .01, barkEdge + .012, plinthR);
  float cambium = smoothstep(barkEdge - .04, barkEdge - .012, plinthR) * (1. - barkTop);
  float ridges = plinthFbm(vec2(plinthAngle * 38., plinthP.y * 9. + plinthR * 3.));
  float furrow = smoothstep(.35, .62, ridges);
  vec3 bark = mix(vec3(.022, .016, .012), vec3(.12, .095, .075), furrow) * (.8 + .4 * plinthNoise(plinthP.xz * 40. + plinthP.y * 30.));
  float barkMask = max(plinthSide, plinthTop * barkTop);
  vec3 surface = mix(mix(wood, vec3(.72, .52, .3), cambium * .55), bark, barkMask);
  // Moss creeps over the bark on the shaded side and just onto the top.
  float mossRegion = plinthFbm(vec2(plinthAngle * 2.2 + 4., .5)) + .12 * sin(plinthAngle + 2.4);
  float mossBody = plinthFbm(plinthP.xz * 9. + plinthP.y * 12.);
  float mossReach = barkMask + plinthTop * smoothstep(barkEdge - .18, barkEdge, plinthR) * .9;
  float moss = smoothstep(.74, .9, mossRegion + mossBody * .35) * clamp(mossReach, 0., 1.);
  vec3 mossColor = mix(vec3(.045, .085, .012), vec3(.15, .24, .035), plinthNoise(plinthP.xz * 55. + plinthP.y * 40.));
  surface = mix(surface, mossColor, moss);
  // Night keeps the stage low so the sculpture stays the brightest thing.
  surface *= mix(vec3(1.), vec3(.34, .4, .46), plinthNight);
  diffuseColor.rgb *= surface;
  float plinthHeight = -check * .012 + latewood * .0012 * (1. - barkMask) + furrow * .02 * barkMask + moss * mossBody * .012;
`;

export function createCamphorPlinth(forest: ForestLight) {
  const geometry = new THREE.CylinderGeometry(PLINTH_RADIUS, PLINTH_RADIUS, HEIGHT, 224, 2);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i), r = Math.hypot(x, z);
    if (r < PLINTH_RADIUS * .999) continue;
    const scale = barkRadius(Math.atan2(z, x));
    position.setXYZ(i, x * scale, position.getY(i), z * scale);
  }
  geometry.computeVertexNormals();
  const night = { value: 0 };
  const material = new THREE.MeshPhysicalMaterial({ name: 'Camphor plinth', color: 0xffffff, roughness: .58, metalness: 0,
    clearcoat: .3, clearcoatRoughness: .38, sheen: .25, sheenRoughness: .8, sheenColor: 0x5d7a2c, envMapIntensity: .75 });
  material.onBeforeCompile = shader => {
    shader.uniforms.plinthNight = night;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPlinthPosition;\nvarying vec3 vPlinthNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPlinthPosition = position;\nvPlinthNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${SURFACE}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(mix(.5 + .12 * latewood, .9, barkMask), .95, moss) + check * .25;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 plinthDx = dFdx(-vViewPosition), plinthDy = dFdy(-vViewPosition);
        vec3 plinthR1 = cross(plinthDy, normal), plinthR2 = cross(normal, plinthDx);
        float plinthDet = dot(plinthDx, plinthR1) * faceDirection;
        vec3 plinthGradient = sign(plinthDet) * (dFdx(plinthHeight) * plinthR1 + dFdy(plinthHeight) * plinthR2);
        normal = normalize(abs(plinthDet) * normal - plinthGradient);`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        // Oiled end grain carries a thin coat; bark, checks and moss do not.
        material.clearcoat *= plinthTop * (1. - barkMask) * (1. - moss) * (1. - check);
        material.sheenColor *= moss;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec2 speckCell = floor(plinthP.xz * 46. + plinthP.y * 31.);
        float speck = step(.955, plinthHash(speckCell)) * (1. - smoothstep(.12, .42, length(fract(plinthP.xz * 46. + plinthP.y * 31.) - .5)));
        float speckPulse = .55 + .45 * sin(plinthHash(speckCell + 3.) * 40. + forestTime * (.6 + plinthHash(speckCell + 9.)));
        totalEmissiveRadiance += vec3(.45, 1., .62) * speck * speckPulse * moss * plinthNight * 2.4;`);
  };
  material.customProgramCacheKey = () => 'camphor-plinth-v1';
  forest.patch(material);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Camphor plinth';
  mesh.position.y = -.095;
  mesh.receiveShadow = true;
  return {
    mesh, material,
    setNight(value: number) { night.value = value; },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}
