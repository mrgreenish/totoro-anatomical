import * as THREE from 'three';

type TissuePreset = {
  tint?: number; roughness?: number; clearcoat?: number; coatRoughness?: number;
  normal?: number; environment?: number; sheen?: number; sheenColor?: number; sheenRoughness?: number;
};

/** Only existing material inputs change: no additional maps, lights, or shader features. */
export const TISSUE_PRESETS: Record<string, TissuePreset> = {
  Anatomy_cortical_bone: { tint: 0xfff5e3, roughness: 1, environment: .6, clearcoat: .025, coatRoughness: .55 },
  Anatomy_muscle: { tint: 0xffded8, roughness: 1, normal: .58, sheen: .07, sheenColor: 0x8c463e, sheenRoughness: .82, clearcoat: .015, coatRoughness: .54 },
  Anatomy_tendon: { tint: 0xfff8e9, roughness: .9, normal: .52, sheen: .16, sheenColor: 0xe3d5ba, sheenRoughness: .72, clearcoat: .025, coatRoughness: .54 },
  Anatomy_myocardium: { tint: 0xffe6e0, roughness: .9, clearcoat: .09, coatRoughness: .4 },
  Anatomy_liver: { tint: 0xf0d0c4, roughness: .78, clearcoat: .09, coatRoughness: .38 },
  Anatomy_kidney: { tint: 0xf6d6d2, roughness: .85, clearcoat: .09, coatRoughness: .38 },
  Anatomy_spleen: { tint: 0xf2d9e8, roughness: .9, clearcoat: .09, coatRoughness: .42 },
  Anatomy_lungs: { tint: 0xffeeee, roughness: 1, clearcoat: .07, coatRoughness: .5 },
  Anatomy_stomach: { tint: 0xffeee2, roughness: .95, clearcoat: .08, coatRoughness: .45 },
  Anatomy_intestine: { tint: 0xffeadd, roughness: .95, clearcoat: .08, coatRoughness: .45 },
  Anatomy_glands: { roughness: 1, clearcoat: .07, coatRoughness: .5 },
  Anatomy_brain: { tint: 0xffeee8, roughness: .28, clearcoat: .8, coatRoughness: .12, normal: .32, environment: 1.2 },
  detail_cortex: { tint: 0xffeee8, roughness: .72, clearcoat: .9, coatRoughness: .19, environment: 1.1 },
  detail_vessel: { roughness: .32, clearcoat: .75, coatRoughness: .16 },
};

export const BRAIN_SURFACE = {
  roughness: [.23, .36], clearcoat: [.65, .85], coatRoughness: [.09, .17],
} as const;

export function applyTissuePreset(material: THREE.MeshStandardMaterial, name = material.name) {
  const preset = TISSUE_PRESETS[name];
  if (!preset) return;
  if (preset.tint !== undefined) material.color.multiply(new THREE.Color(preset.tint));
  if (preset.roughness !== undefined) material.roughness = preset.roughness;
  if (preset.environment !== undefined) material.envMapIntensity = preset.environment;
  if (preset.normal !== undefined && material.normalMap) material.normalScale.setScalar(preset.normal);
  if (material instanceof THREE.MeshPhysicalMaterial) {
    if (preset.clearcoat !== undefined) material.clearcoat = preset.clearcoat;
    if (preset.coatRoughness !== undefined) material.clearcoatRoughness = preset.coatRoughness;
    if (preset.sheen !== undefined) material.sheen = preset.sheen;
    if (preset.sheenColor !== undefined) material.sheenColor.set(preset.sheenColor);
    if (preset.sheenRoughness !== undefined) material.sheenRoughness = preset.sheenRoughness;
  }
}

export function sectionTint(name: string) {
  return TISSUE_PRESETS[name]?.tint ?? 0xffffff;
}

/** Cardiac tissue over the existing atlas: opaque muscle under a thin fluid film. */
export function createHeartTissueMaterial(source: THREE.MeshStandardMaterial) {
  const material = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(material, source);
  // StandardMaterial.copy also copies its defines, so restore the physical path.
  Object.assign(material, { defines: { STANDARD: '', PHYSICAL: '' } });
  const vessel = source.name === 'Anatomy_coronary_vessels';
  const valve = source.name === 'Anatomy_cartilage';
  material.metalness = 0;
  material.roughness = .5;
  material.ior = 1.36;
  material.specularIntensity = vessel ? .52 : .68;
  material.clearcoat = .22;
  material.clearcoatRoughness = .23;
  material.envMapIntensity = .55;
  material.normalScale.setScalar(.42);
  if (vessel) material.color.setRGB(.105, .012, .021);
  if (valve) material.color.setRGB(.52, .39, .29);
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `
      #include <common>
      varying vec3 vHeartPosition;
    `).replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vHeartPosition = position;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      varying vec3 vHeartPosition;
      float cardiacHash(vec3 p) {
        p = fract(p * .3183099 + vec3(.17, .31, .53));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float cardiacNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(cardiacHash(i), cardiacHash(i + vec3(1,0,0)), f.x),
                       mix(cardiacHash(i + vec3(0,1,0)), cardiacHash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(cardiacHash(i + vec3(0,0,1)), cardiacHash(i + vec3(1,0,1)), f.x),
                       mix(cardiacHash(i + vec3(0,1,1)), cardiacHash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float cardiacSegment(vec2 p, vec2 a, vec2 b) {
        vec2 ab = b - a;
        return length(p - a - ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0));
      }
    `).replace('#include <lights_physical_pars_fragment>', `
      #include <lights_physical_pars_fragment>
      // A restrained red diffuse wrap approximates shallow tissue scattering.
      // It receives each light's actual attenuation and shadow, with no emission
      // or transmission pass that could reveal organs behind the heart.
      void RE_Direct_Cardiac(const in IncidentLight light, const in vec3 p,
        const in vec3 n, const in vec3 v, const in vec3 coatNormal,
        const in PhysicalMaterial tissue, inout ReflectedLight reflected) {
        RE_Direct_Physical(light, p, n, v, coatNormal, tissue, reflected);
        float ndl = dot(n, light.direction);
        float wrap = max(0.0, (ndl + .38) / 1.38) - max(0.0, ndl);
        vec3 absorption = vec3(1.0, .24, .12);
        reflected.directDiffuse += light.color * tissue.diffuseColor * absorption *
          wrap * ${valve ? '.12' : '.42'} * RECIPROCAL_PI;
      }
      #undef RE_Direct
      #define RE_Direct RE_Direct_Cardiac
    `).replace('#include <map_fragment>', `
      #include <map_fragment>
      // Rest-space detail stays attached through heartbeat and separation, and
      // remains continuous across the existing atlas seams.
      vec3 cardiacP = vHeartPosition;
      float cardiacMacro = cardiacNoise(cardiacP * 4.8);
      float cardiacMottle = cardiacNoise(cardiacP * 19.0 + cardiacMacro * 2.0);
      float cardiacFine = cardiacNoise(cardiacP * 115.0);
      float cardiacMoisture = cardiacNoise(cardiacP * 9.0 + 13.0);
      float cardiacPerfusion = smoothstep(.08, .92, cardiacMacro * .62 + cardiacMottle * .38);
      // Fine, gently curving muscle bundles beneath the epicardium. Derivative
      // filtering fades the striae before they become moire at overview scale.
      float cardiacPhase = (cardiacP.y + .38 * cardiacP.x + .22 * cardiacP.z * cardiacP.z
        + .08 * cardiacMottle) * 620.0;
      float cardiacFibers = sin(cardiacPhase) * (1.0 - smoothstep(.7, 2.8, fwidth(cardiacPhase)));
      diffuseColor.rgb *= mix(vec3(.49, .34, .40), vec3(.90, .72, .67), cardiacPerfusion);
      diffuseColor.rgb *= .97 + .06 * cardiacFine + cardiacFibers * ${vessel || valve ? '.003' : '.014'};
      float cardiacFat = 0.0;
      ${vessel || valve ? '' : `
      // Thin, lobulated epicardial deposits follow this asset's existing
      // coronary grooves in normalized rest coordinates, on the anterior face.
      float coronaryGroove = min(
        cardiacSegment(cardiacP.xy, vec2(-.05,.32), vec2(-.33,.28)),
        cardiacSegment(cardiacP.xy, vec2(-.05,.32), vec2(.21,.28)));
      coronaryGroove = min(coronaryGroove,
        cardiacSegment(cardiacP.xy, vec2(-.33,.28), vec2(-.51,.16)));
      coronaryGroove = min(coronaryGroove,
        cardiacSegment(cardiacP.xy, vec2(.21,.28), vec2(.46,.16)));
      float fatLobules = .6 * cardiacNoise(cardiacP * 30.0) + .4 * cardiacNoise(cardiacP * 94.0);
      cardiacFat = (1.0 - smoothstep(.012, .046, coronaryGroove))
        * smoothstep(.20, .39, cardiacP.z) * smoothstep(.28, .73, fatLobules);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.48, .32, .16), cardiacFat * .16);
      `}
    `).replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      // Use an absolute tissue range instead of multiplying the glTF factor
      // by the smooth capsule atlas, which produced the polished resin look.
      roughnessFactor = clamp(mix(.43, .59, cardiacMoisture)
        + (roughnessFactor - .2) * .12, .4, .63);
    `).replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      float cardiacRelief = cardiacFine * .000065 + cardiacMottle * .00028
        + cardiacFibers * ${vessel || valve ? '.000006' : '.000018'} + cardiacFat * .0005;
      vec3 cardiacDx = dFdx(-vViewPosition), cardiacDy = dFdy(-vViewPosition);
      vec3 cardiacR1 = cross(cardiacDy, normal), cardiacR2 = cross(normal, cardiacDx);
      float cardiacDet = dot(cardiacDx, cardiacR1);
      vec3 cardiacGradient = dFdx(cardiacRelief) * cardiacR1 + dFdy(cardiacRelief) * cardiacR2;
      // Guard degenerate derivatives at silhouettes and tiny projected vessels.
      if (abs(cardiacDet) > 1e-12) {
        normal = normalize(abs(cardiacDet) * normal - sign(cardiacDet) * cardiacGradient);
      }
    `).replace('#include <clearcoat_normal_fragment_maps>', `
      #include <clearcoat_normal_fragment_maps>
      // The fluid film follows the tissue, rather than a perfectly smooth shell.
      clearcoatNormal = normalize(mix(clearcoatNormal, normal, .68));
    `).replace('#include <lights_physical_fragment>', `
      #include <lights_physical_fragment>
      material.clearcoat = mix(.10, .26, cardiacMoisture);
      material.clearcoatRoughness = mix(.19, .31, cardiacFine);
    `);
  };
  material.customProgramCacheKey = () => `cardiac-tissue-v3-${vessel ? 'vessel' : valve ? 'valve' : 'muscle'}`;
  return material;
}
