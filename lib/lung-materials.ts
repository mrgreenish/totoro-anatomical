import * as THREE from 'three';
export type LungMaps={color:THREE.Texture;normal:THREE.Texture;roughness:THREE.Texture};
export function createPleuralMaterial(maps:LungMaps) {
  const material=new THREE.MeshPhysicalMaterial({name:'Moist_pleural_tissue',map:maps.color,normalMap:maps.normal,
    normalScale:new THREE.Vector2(.65,.65),roughnessMap:maps.roughness,roughness:.94,
    color:0xffeeee,metalness:0,clearcoat:.30,clearcoatRoughness:.29,ior:1.38,
    specularIntensity:.65,envMapIntensity:.6,side:THREE.DoubleSide});
  material.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
      // A restrained thin-tissue wrap: warm scattered light at grazing angles.
      float tissueRim = pow(1.0 - max(dot(normal, geometryViewDir), 0.0), 3.0);
      outgoingLight += diffuseColor.rgb * vec3(.18,.045,.025) * tissueRim;
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey=()=> 'lung-pleura-wrap-v1';return material;
}
export function createAlveolarMaterial(maps:LungMaps,mobile:boolean) {
  return new THREE.MeshPhysicalMaterial({name:'Thin_moist_alveolar_membrane',color:0xffffff,map:maps.color,
    normalMap:maps.normal,normalScale:new THREE.Vector2(.4,.4),roughness:.48,
    clearcoat:.35,clearcoatRoughness:.23,transmission:mobile?0:.18,thickness:.018,
    ior:1.34,attenuationColor:new THREE.Color(0xdba6a0),attenuationDistance:.6,
    transparent:true,opacity:.55,depthWrite:false,side:THREE.DoubleSide,envMapIntensity:.45});
}
/** Uniform-only movement: a pre-sampled airway graph is uploaded once. */
export function createAirMaterial(mobile:boolean) {
  return new THREE.ShaderMaterial({name:'Directional_air_flow',transparent:true,depthWrite:false,depthTest:false,
    uniforms:{travel:{value:0},flow:{value:0},pointScale:{value:mobile?38:44}},
    vertexShader:`attribute float along; attribute float lane; varying float lightness;
      uniform float travel; uniform float flow; uniform float pointScale;
      void main(){
        float wave=fract(along*4.0-travel+lane);
        lightness=smoothstep(.83,.92,wave)*(1.0-smoothstep(.92,1.0,wave))*smoothstep(.015,.16,abs(flow));
        vec4 mv=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mv;
        gl_PointSize=clamp(pointScale/max(1.0,-mv.z),2.0,12.0);
      }`,
    fragmentShader:`varying float lightness; uniform float flow;
      void main(){float d=length(gl_PointCoord-.5)*2.0;if(d>1.0||lightness<.01)discard;
        vec3 color=flow>=0.0?vec3(.12,.70,1.0):vec3(1.0,.44,.08);
        gl_FragColor=vec4(color,lightness*(1.0-smoothstep(.35,1.0,d)));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
}
export function createDiaphragmMaterial(maps:LungMaps,uniforms:{inflation:{value:number}}) {
  const material=new THREE.MeshPhysicalMaterial({name:'Radial_diaphragm_muscle',color:0x984c45,roughness:.53,
    clearcoat:.22,normalMap:maps.normal,normalScale:new THREE.Vector2(.20,.20),side:THREE.DoubleSide});
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform float inflation;varying vec2 diaphragmUv;')
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        diaphragmUv=uv;
        transformed.y-=inflation*(.28+.22*(1.0-uv.y*uv.y));`)
      .replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
        float radial=uv.y;
        objectNormal=normalize(vec3(position.x*(.35-.22*inflation)*2.0/(1.74*1.74),1.0,position.z*(.35-.22*inflation)*2.0/(.88*.88)));`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 diaphragmUv;')
      .replace('#include <color_fragment>',`#include <color_fragment>
        float fiber=.93+.07*sin(diaphragmUv.x*6.2831853*220.0+diaphragmUv.y*15.0);
        diffuseColor.rgb*=fiber;
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.57,.43,.34),1.0-smoothstep(.13,.40,diaphragmUv.y));`);
  };
  material.customProgramCacheKey=()=> 'lung-diaphragm-v1';return material;
}
