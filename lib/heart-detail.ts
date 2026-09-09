import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createHeartFlow, type HeartAnatomy } from './heart-flow';
import { cardiacCycle, HEART_DEFORMATION } from './heart-cycle';

export type HeartViewOptions = { translucent: boolean; blood: boolean; cells: boolean };
type Options = { renderer: THREE.WebGLRenderer; environment: THREE.Texture | null; signal: AbortSignal; canvas: HTMLCanvasElement; wake(): void; reduced: boolean };
const BASE='/models/heart-detail/';
type Cache = {size:number;bytes:ArrayBuffer;anatomy:HeartAnatomy;color:Blob;normal:Blob;surface:Blob};
type Uniforms = {heartContraction:{value:number};heartInterior:{value:number};heartAv:{value:number};heartOutflow:{value:number}};

export function heartTextureSize(width: number, max: number) { return width<768||max<4096?2048:4096; }

export function bakeHeartTransform(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4) {
  // KHR_mesh_quantization uses normalized integer attributes. Transforming them
  // in place wraps coordinates above 1 (the arch) to negative integer values.
  for(const name of ['position','normal'] as const) {
    const source=geometry.getAttribute(name);
    if(!source)continue;
    const data=new THREE.Float32BufferAttribute(new Float32Array(source.count*3),3);
    for(let i=0;i<source.count;i++)data.setXYZ(i,source.getX(i),source.getY(i),source.getZ(i));
    geometry.setAttribute(name,data);
  }
  geometry.applyMatrix4(matrix);geometry.computeBoundingBox();geometry.computeBoundingSphere();
}

/** Layered wet tissue over a diffuse body, with inexpensive thickness transport. */
export function createCardiacMaterial(kind: string, source: THREE.MeshStandardMaterial, maps: {color:THREE.Texture;normal:THREE.Texture;surface:THREE.Texture}, uniforms: Uniforms, valve?: HeartAnatomy['valves'][string]) {
  const tissue=kind==='myocardium'||kind==='atrium';
  const internal=['endocardium','chordae','valve'].includes(kind);
  const fat=kind==='fat',vein=kind.includes('vein')||kind==='vena_cava';
  const material=new THREE.MeshPhysicalMaterial({
    name:source.name,color:tissue?0xffffff:source.color,
    map:tissue?maps.color:null,normalMap:maps.normal,normalScale:new THREE.Vector2(tissue?.38:.25,tissue?.38:.25),
    roughness:tissue?1:fat?.47:valve?.40:.33,roughnessMap:tissue?maps.surface:null,
    aoMap:tissue?maps.surface:null,aoMapIntensity:.60,metalness:0,
    clearcoat:fat?.38:internal?.52:.72,clearcoatRoughness:fat?.25:.18,
    ior:1.38,specularIntensity:.72,envMapIntensity:.74,
    transparent:true,opacity:1,side:THREE.DoubleSide,forceSinglePass:true,
  });
  material.onBeforeCompile=shader=> {
    Object.assign(shader.uniforms,uniforms);
    shader.uniforms.heartSurface={value:maps.surface};
    shader.uniforms.heartTransparent={value:material.opacity<1?1:0};
    // Keep the uniform reference accessible without recompilation on toggles.
    material.userData.transparency=shader.uniforms.heartTransparent;
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\n${HEART_DEFORMATION}\nvarying vec2 vHeartUv;`);
    let deformation='transformed=heartDeform(transformed);';
    if(valve) {
      const center=new THREE.Vector3().fromArray(valve.center);
      shader.uniforms.valveCenter={value:center};shader.uniforms.valveRadius={value:valve.radius};
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\nuniform vec3 valveCenter;uniform float valveRadius;uniform float heartAv;uniform float heartOutflow;`);
      deformation=`
        vec3 local=transformed-valveCenter;
        float radius=length(local.xz);
        float freeEdge=1.0-clamp(radius/valveRadius,0.0,1.0);
        float gate=${valve.gate==='av'?'heartAv':'heartOutflow'};
        local.xz*=1.0+gate*freeEdge*valveRadius*.78/max(radius,.003);
        local.y-=gate*freeEdge*${valve.gate==='av'?'.12':'.06'};
        transformed=heartDeform(valveCenter+local);
      `;
    }
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>\nvHeartUv=uv;\n${deformation}`);
    if(!valve)shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nobjectNormal=heartNormal(position,objectNormal);');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec2 vHeartUv;uniform sampler2D heartSurface;uniform float heartTransparent;`)
      .replace('#include <lights_physical_pars_fragment>',`
        #include <lights_physical_pars_fragment>
        void RE_Direct_Heart(const in IncidentLight light,const in vec3 p,const in vec3 n,
          const in vec3 v,const in vec3 coatNormal,const in PhysicalMaterial tissue,inout ReflectedLight reflected) {
          RE_Direct_Physical(light,p,n,v,coatNormal,tissue,reflected);
          float depth=texture2D(heartSurface,vHeartUv).b;
          vec3 transport=exp(-vec3(1.4,3.8,5.0)*depth*${kind==='atrium'||vein?'.65':'1.0'});
          float back=pow(saturate(dot(v,-normalize(light.direction+n*.36))),3.0);
          float wrap=saturate((dot(n,light.direction)+.4)/1.4);
          reflected.directDiffuse+=light.color*tissue.diffuseColor*transport*(back*.42+wrap*.12)*RECIPROCAL_PI;
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Heart
      `).replace('#include <opaque_fragment>',`
        float grazing=pow(1.0-saturate(abs(dot(normal,normalize(vViewPosition)))),2.0);
        diffuseColor.a*=mix(1.0,.48+.52*grazing,heartTransparent);
        #include <opaque_fragment>
      `);
  };
  material.customProgramCacheKey=()=>`heart-${kind}-${valve?.gate??'wall'}-v1`;
  return material;
}

export function createHeartDetail(o: Options) {
  const scene=new THREE.Scene();scene.environment=o.environment;scene.environmentIntensity=.35;
  const root=new THREE.Group();root.name='Isolated_heart';scene.add(root);
  const ambient=new THREE.HemisphereLight(0xf2e9e6,0x382329,.30);
  const key=new THREE.DirectionalLight(0xfff1e8,2.8);key.position.set(-2.5,3,3.5);key.castShadow=true;
  key.shadow.mapSize.set(1536,1536);Object.assign(key.shadow.camera,{left:-1.4,right:1.4,top:1.5,bottom:-1.3,near:.1,far:10});
  key.shadow.bias=-.00012;key.shadow.normalBias=.0012;
  const fill=new THREE.DirectionalLight(0xe1e9f5,.60);fill.position.set(2,.5,3);
  const rim=new THREE.DirectionalLight(0xf4d6cd,1.9);rim.position.set(2,1,-3);
  scene.add(ambient,key,fill,rim);
  const options: HeartViewOptions={translucent:false,blood:true,cells:false};
  const common={heartContraction:{value:0},heartAv:{value:1},heartOutflow:{value:0}};
  const outer={...common,heartInterior:{value:0}},inner={...common,heartInterior:{value:1}};
  const textures=new Set<THREE.Texture>(),materials=new Set<THREE.Material>(),geometries=new Set<THREE.BufferGeometry>();
  const meshes: {mesh:THREE.Mesh;kind:string;internal:boolean}[]=[];
  let flow:ReturnType<typeof createHeartFlow>|undefined;
  let cache:Cache|undefined,promise:Promise<void>|undefined,ready=false,disposed=false,time=0,lastPhase='';
  const abort=new AbortController();const abortParent=()=>abort.abort();o.signal.addEventListener('abort',abortParent,{once:true});
  async function get(name:string) {
    const r=await fetch(`${BASE}${name}?v=heart-study-1`,{signal:abort.signal});
    if(!r.ok)throw new Error('The heart study could not load.');return r;
  }
  async function texture(blob:Blob,color=false) {
    const bitmap=await createImageBitmap(blob,{imageOrientation:'none',premultiplyAlpha:'none'});
    if(disposed||o.signal.aborted){bitmap.close();throw new Error('Disposed');}
    const t=new THREE.Texture(bitmap);t.flipY=false;t.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;
    t.anisotropy=Math.min(8,o.renderer.capabilities.getMaxAnisotropy());t.needsUpdate=true;textures.add(t);return t;
  }
  function release() {
    flow?.dispose();flow=undefined;root.clear();meshes.length=0;
    geometries.forEach(g=>g.dispose());geometries.clear();materials.forEach(m=>m.dispose());materials.clear();
    textures.forEach(t=>{t.dispose();(t.image as ImageBitmap)?.close?.();});textures.clear();key.shadow.dispose();ready=false;
  }
  function syncOptions() {
    for(const {mesh,kind,internal} of meshes) {
      mesh.visible=!internal||options.translucent;
      const m=mesh.material as THREE.MeshPhysicalMaterial;
      m.opacity=internal?(kind==='valve'||kind==='chordae'?.78:.055):options.translucent?(kind==='fat'?.055:.16):1;
      m.depthWrite=!options.translucent||kind==='valve'||kind==='chordae';
      if(m.userData.transparency)m.userData.transparency.value=options.translucent?1:0;
      mesh.castShadow=!options.translucent&&!internal;mesh.receiveShadow=!options.translucent;
      mesh.renderOrder=internal?(kind==='valve'||kind==='chordae'?3:1):4;
    }
    flow?.setVisible(options.translucent&&options.blood,options.cells);
    key.castShadow=!options.translucent;
  }
  async function load(width:number) {
    if(ready||disposed)return;if(promise)return promise;
    const loading=(async()=>{
      const size=heartTextureSize(width,o.renderer.capabilities.maxTextureSize);
      if(cache?.size!==size)cache=undefined;
      if(!cache) {
        const result=await Promise.allSettled([
          get(size===2048?'heart-detail-mobile.glb':'heart-detail.glb').then(r=>r.arrayBuffer()),get('anatomy.json').then(r=>r.json()),
          get(`basecolor-${size}.webp`).then(r=>r.blob()),get('normal-2048.webp').then(r=>r.blob()),get('surface.webp').then(r=>r.blob()),
        ]);
        const failure=result.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
        const [bytes,anatomy,color,normal,surface]=result.map(r=>(r as PromiseFulfilledResult<unknown>).value) as [ArrayBuffer,HeartAnatomy,Blob,Blob,Blob];
        cache={size,bytes,anatomy,color,normal,surface};
      }
      if(disposed||o.signal.aborted)throw new Error('Disposed');
      // Wait for every decode before cleanup, including partial image failure.
      const decoded=await Promise.allSettled([texture(cache.color,true),texture(cache.normal),texture(cache.surface)]);
      const failed=decoded.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
      const [color,normal,surface]=decoded.map(r=>(r as PromiseFulfilledResult<THREE.Texture>).value);
      const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(cache.bytes,BASE);
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(node=>{
        if(!(node instanceof THREE.Mesh))return;
        // Bake quantization transforms once. All optical/deformation fields use
        // the same physical coordinates as the blood and valve landmarks.
        bakeHeartTransform(node.geometry,node.matrixWorld);geometries.add(node.geometry);
        const source=(Array.isArray(node.material)?node.material[0]:node.material) as THREE.MeshStandardMaterial;
        const kind=source.name.replace('Heart_','');
        const internal=['endocardium','chordae','valve'].includes(kind);
        const valve=node.userData.valve?cache!.anatomy.valves[node.userData.valve]:undefined;
        const material=createCardiacMaterial(kind,source,{color,normal,surface},internal?inner:outer,valve);materials.add(material);
        const mesh=new THREE.Mesh(node.geometry,material);mesh.name=node.name;mesh.userData={...node.userData};root.add(mesh);
        const depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
        depth.onBeforeCompile=shader=>{Object.assign(shader.uniforms,outer);shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\n${HEART_DEFORMATION}`).replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed=heartDeform(transformed);');};
        depth.customProgramCacheKey=()=> 'heart-shadow-v1';materials.add(depth);mesh.customDepthMaterial=depth;
        meshes.push({mesh,kind,internal});source.dispose();
      });
      if(disposed||o.signal.aborted)throw new Error('Disposed');
      flow=createHeartFlow(cache.anatomy,width<768,inner);root.add(flow.root);syncOptions();root.updateMatrixWorld(true);ready=true;
    })();
    promise=loading;
    try{await loading;}catch(error){release();throw error;}finally{if(promise===loading)promise=undefined;}
  }
  return {scene,root,load,get ready(){return ready;},
    setInteractive(_value:boolean){},
    setOptions(value:Partial<HeartViewOptions>){Object.assign(options,value);syncOptions();o.wake();},
    get options(){return {...options};},
    update(dt:number,animated:boolean){
      const moving=animated&&!o.reduced;if(moving)time+=dt;
      const cycle=cardiacCycle(time);common.heartContraction.value=cycle.contraction;common.heartAv.value=cycle.av;common.heartOutflow.value=cycle.outflow;
      if(flow?.root.visible)flow.update(dt,moving,time);
      if(lastPhase!==cycle.label){lastPhase=cycle.label;o.canvas.dispatchEvent(new CustomEvent('heart-phase',{detail:cycle.label,bubbles:true}));}
      return moving;
    },
    unload(){if(!disposed&&ready)release();},
    dispose(){if(disposed)return;disposed=true;cache=undefined;abort.abort();o.signal.removeEventListener('abort',abortParent);release();},
  };
}
export type HeartDetail=ReturnType<typeof createHeartDetail>;
