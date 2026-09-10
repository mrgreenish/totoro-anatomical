import * as THREE from 'three';

export type EyeMaps = { iris: THREE.Texture; sclera: THREE.Texture; normal: THREE.Texture; retina: THREE.Texture };
export type EyeUniforms = { pupilRadius: {value:number}; lensDepth: {value:number} };

/** Polar mesh UVs stay attached to the stroma while the pupil dilates. */
export function createIrisMaterial(map: THREE.Texture, uniforms: EyeUniforms) {
  const material = new THREE.MeshPhysicalMaterial({
    name:'Iris_stroma',map,roughness:.64,metalness:0,clearcoat:.12,
    clearcoatRoughness:.24,envMapIntensity:.45,side:THREE.DoubleSide,
  });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `
      #include <common>
      uniform float pupilRadius;
      varying vec2 eyePolar;
    `).replace('#include <begin_vertex>', `
      #include <begin_vertex>
      eyePolar = uv;
      float eyeRadius = mix(pupilRadius, .475, uv.y);
      transformed.xy = normalize(position.xy) * eyeRadius;
      transformed.z += sin(uv.y * 3.14159265) * .018;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      varying vec2 eyePolar;
    `).replace('#include <map_fragment>', `
      // Sample the authored iris disk radially, independent of pupil diameter.
      float a = eyePolar.x * 6.2831853;
      float r = mix(.123, .46, eyePolar.y);
      vec2 eyeTextureUv = vec2(.499,.497) + vec2(cos(a), sin(a)) * r;
      vec4 sampledDiffuseColor = texture2D(map, eyeTextureUv);
      diffuseColor *= sampledDiffuseColor;
      float rim = smoothstep(.0,.045,eyePolar.y) * (1.0 - smoothstep(.96,1.0,eyePolar.y));
      diffuseColor.rgb *= .32 + .68 * rim;
    `).replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      // Fine radial crypt relief catches light beneath the corneal surface.
      float irisHeight = dot(sampledDiffuseColor.rgb, vec3(.25,.5,.25)) * .0013;
      vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
      vec3 rx = cross(dy,normal), ry = cross(normal,dx);
      float det = dot(dx,rx);
      normal = normalize(abs(det)*normal - sign(det)*(dFdx(irisHeight)*rx+dFdy(irisHeight)*ry));
    `);
  };
  material.customProgramCacheKey = () => 'eye-radial-iris-v1';
  return material;
}

export function createScleraMaterial(maps: EyeMaps) {
  const material = new THREE.MeshPhysicalMaterial({
    name:'Sclera_and_tear_film',map:maps.sclera,normalMap:maps.normal,
    normalScale:new THREE.Vector2(.21,.21),roughness:.43,metalness:0,
    clearcoat:.85,clearcoatRoughness:.085,ior:1.376,specularIntensity:.72,
    envMapIntensity:.6,side:THREE.DoubleSide,
  });
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', `
      #include <lights_physical_pars_fragment>
      void RE_Direct_Eye(const in IncidentLight light, const in vec3 p, const in vec3 n,
        const in vec3 v, const in vec3 coatNormal, const in PhysicalMaterial tissue, inout ReflectedLight reflected) {
        RE_Direct_Physical(light,p,n,v,coatNormal,tissue,reflected);
        float wrap = saturate((dot(n,light.direction)+.36)/1.36);
        float back = pow(saturate(dot(v,-normalize(light.direction+n*.4))),3.0);
        reflected.directDiffuse += light.color*tissue.diffuseColor*vec3(1.0,.39,.26)*(wrap*.075+back*.16)*RECIPROCAL_PI;
      }
      #undef RE_Direct
      #define RE_Direct RE_Direct_Eye
    `);
  };
  material.customProgramCacheKey = () => 'eye-sclera-transport-v1';
  return material;
}

/** Three's physical transmission pass refracts the scene through each surface.
 * Cornea: absolute effective index. Lens: relative to the surrounding aqueous
 * (1.406 / 1.336), because the real lens is immersed, not suspended in air.
 * Dispersion is restrained and disabled on the mobile tier.
 */
export function createOpticalMaterial(kind: 'cornea' | 'lens', mobile: boolean, uniforms: EyeUniforms) {
  const cornea = kind === 'cornea';
  const material = new THREE.MeshPhysicalMaterial({
    name:cornea?'Cornea_refractive':'Crystalline_lens_refractive',
    color:cornea?0xffffff:0xfff9e8,roughness:cornea?.025:.045,
    metalness:0,transmission:1,thickness:cornea?.05:.29,
    ior:cornea?1.376:1.406/1.336,dispersion:mobile?0:cornea?.025:.035,
    attenuationColor:new THREE.Color(cornea?0xf8ffff:0xf4e9bc),attenuationDistance:cornea?5:3,
    clearcoat:cornea?.65:.12,clearcoatRoughness:.035,
    envMapIntensity:cornea?.85:.6,specularIntensity:1,
    side:THREE.FrontSide,
  });
  if (!cornea) {
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms,uniforms);
      shader.vertexShader = shader.vertexShader.replace('#include <common>','#include <common>\nuniform float lensDepth;')
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          objectNormal = normalize(vec3(objectNormal.xy, objectNormal.z / lensDepth));`)
        .replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed.z *= lensDepth;');
    };
    material.customProgramCacheKey = () => 'eye-accommodating-lens-v1';
  }
  return material;
}

export function createRetinaMaterial(maps: EyeMaps) {
  return new THREE.MeshPhysicalMaterial({name:'Retina',map:maps.retina,normalMap:maps.normal,
    normalScale:new THREE.Vector2(.11,.11),roughness:.43,clearcoat:.32,
    clearcoatRoughness:.2,envMapIntensity:.4,side:THREE.DoubleSide});
}

/** Outer-segment membrane stacks are shaded, avoiding thousands of ring meshes. */
export function createPhotoreceptorMaterial(color:number) {
  const material=new THREE.MeshPhysicalMaterial({color,roughness:.42,clearcoat:.38,clearcoatRoughness:.22});
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying float cellHeight;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\ncellHeight=position.y;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float cellHeight;')
      .replace('#include <map_fragment>',`#include <map_fragment>
        float band=sin(cellHeight*2100.0)*(1.0-smoothstep(.8,3.14,fwidth(cellHeight)*2100.0));
        float membrane=band*.5+.5;
        diffuseColor.rgb *= .78 + membrane*.22;`)
      .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor+=.13*(1.0-membrane);');
  };
  material.customProgramCacheKey=()=> 'eye-photoreceptor-membranes-v1';return material;
}

/** Lightweight animated photons and electrical signals on prebuilt paths. */
export function createSignalMaterial(color: number, mobile: boolean) {
  return new THREE.ShaderMaterial({
    uniforms:{time:{value:0},tint:{value:new THREE.Color(color)},pixelScale:{value:mobile?1:1.4}},
    vertexShader:`attribute float travel; uniform float time; uniform float pixelScale; varying float alpha;
      void main(){ vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;
        float phase=fract(travel-time*.42);
        alpha=pow(max(0.,1.-abs(phase-.5)*2.),14.);
        gl_PointSize=clamp(22.*pixelScale/-mv.z,2.,8.); }`,
    fragmentShader:`uniform vec3 tint;varying float alpha;void main(){float r=length(gl_PointCoord-.5)*2.;
      gl_FragColor=vec4(tint,(1.-smoothstep(.1,1.,r))*alpha);}`,
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
  });
}
