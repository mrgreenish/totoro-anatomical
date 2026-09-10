import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { defaultEyeOptions, eyeOptics, normalizeEyeOptions, photoreceptorResponse, spectrumColor, type EyePart, type EyeViewOptions } from './eye-optics';
import { createIrisMaterial, createOpticalMaterial, createPhotoreceptorMaterial, createRetinaMaterial, createScleraMaterial, createSignalMaterial, type EyeMaps } from './eye-materials';

type Options = {
  renderer: THREE.WebGLRenderer; environment: THREE.Texture | null; signal: AbortSignal;
  canvas: HTMLCanvasElement; camera: THREE.PerspectiveCamera; controls: OrbitControls;
  wake(): void; reduced: boolean;
};
const TAU = Math.PI * 2;
const BASE = '/models/eye-detail/';

/** Z is the optical axis. The cutaway removes the positive-X hemisphere. */
export function ocularShell(radius: number, start: number, end: number, segments: number, rows: number, half = false) {
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let y=0;y<=rows;y++) for(let x=0;x<=segments;x++) {
    const theta=start+(end-start)*y/rows, phi=half?Math.PI/2+Math.PI*x/segments:TAU*x/segments;
    positions.push(radius*Math.sin(theta)*Math.cos(phi),radius*Math.sin(theta)*Math.sin(phi),radius*Math.cos(theta));
    uv.push(phi/TAU,y/rows);
    if (x<segments&&y<rows) {const a=y*(segments+1)+x,b=a+segments+1;indices.push(a,b,a+1,b,b+1,a+1);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
}
function annulus(inner: number, outer: number, segments: number, rows=8) {
  const p:number[]=[],uv:number[]=[],ix:number[]=[];
  for(let y=0;y<=rows;y++)for(let x=0;x<=segments;x++) {
    const angle=x/segments*TAU,r=inner+(outer-inner)*y/rows;
    p.push(Math.cos(angle)*r,Math.sin(angle)*r,0);uv.push(x/segments,y/rows);
    if(x<segments&&y<rows){const a=y*(segments+1)+x,b=a+segments+1;ix.push(a,b,a+1,b,b+1,a+1);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();return g;
}
function coatEdge(inner:number,outer:number,start:number,rows:number) {
  const positions:number[]=[],indices:number[]=[];
  for(const sign of [-1,1])for(let i=0;i<=rows;i++) {
    const t=start+(Math.PI-start)*i/rows;
    for(const r of [inner,outer])positions.push(0,Math.sin(t)*r*sign,Math.cos(t)*r);
    if(i<rows){const a=(sign===-1?0:(rows+1)*2)+i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return g;
}
function randomSource() {let seed=41291;return()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);}

export function createEyeDetail(o: Options) {
  const scene=new THREE.Scene();scene.environment=o.environment;scene.environmentIntensity=.55;
  const root=new THREE.Group();root.name='Isolated_eye';scene.add(root);
  const globe=new THREE.Group(),micro=new THREE.Group(),rays=new THREE.Group(),signals=new THREE.Group();
  globe.name='Ocular_anatomy';micro.name='Magnified_retina';rays.name='Light_paths';signals.name='Optic_messages';
  root.add(globe,micro,rays,signals);
  const key=new THREE.DirectionalLight(0xfff2df,3.4);key.position.set(-2.5,3.6,4);
  const fill=new THREE.DirectionalLight(0xc6e4ff,.82);fill.position.set(3,1,2);
  const rim=new THREE.DirectionalLight(0xb9dced,2.5);rim.position.set(1,1,-3);
  scene.add(key,fill,rim,new THREE.HemisphereLight(0xe8eff6,0x382320,.65));
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
  const shells:{mesh:THREE.Mesh;full:THREE.BufferGeometry;half:THREE.BufferGeometry}[]=[];
  const interiors:THREE.Object3D[]=[],edges:THREE.Mesh[]=[],labels:{element:HTMLSpanElement;position:THREE.Vector3;mode:'eye'|'micro';part?:EyePart}[]=[];
  const parts=new Map<EyePart,THREE.Object3D[]>();
  const geo=<T extends THREE.BufferGeometry>(g:T):T=>{geometries.add(g);return g;};
  const mat=<T extends THREE.Material>(m:T):T=>{materials.add(m);return m;};
  const uniforms={pupilRadius:{value:.13},lensDepth:{value:.145}};
  let options=defaultEyeOptions(),ready=false,disposed=false,interactive=false,mobile=false;
  let promise:Promise<void>|undefined,time=0,needsSync=true;
  let blobCache:Blob[]|undefined;
  const abort=new AbortController();const abortParent=()=>abort.abort();o.signal.addEventListener('abort',abortParent,{once:true});
  let iris:THREE.Mesh,lens:THREE.Mesh,ciliary:THREE.Group,zonules:THREE.LineSegments,cornea:THREE.Mesh,pupil:THREE.Mesh;
  let rayLine:THREE.LineSegments,rayDots:THREE.Points,retinalSpot:THREE.Mesh,nerveDots:THREE.Points;
  let cones:THREE.InstancedMesh,rods:THREE.InstancedMesh;
  let coneBodies:THREE.Mesh,rodBodies:THREE.Mesh;
  let coneTypes:number[]=[];
  const direction=new THREE.Vector3(),projected=new THREE.Vector3();
  const labelLayer=document.createElement('div');labelLayer.className='eye-label-layer';labelLayer.hidden=true;
  labelLayer.setAttribute('aria-hidden','true');o.canvas.parentElement?.appendChild(labelLayer);

  function add(g:THREE.BufferGeometry,m:THREE.Material,name:string,parent:THREE.Object3D=globe,part?:EyePart) {
    const mesh=new THREE.Mesh(geo(g),mat(m));mesh.name=name;parent.add(mesh);
    if(part){const list=parts.get(part)??[];list.push(mesh);parts.set(part,list);}
    return mesh;
  }
  function label(text:string,position:readonly[number,number,number],mode:'eye'|'micro'='eye',part?:EyePart) {
    const element=document.createElement('span');element.className='eye-model-label';element.textContent=text;labelLayer.appendChild(element);
    labels.push({element,position:new THREE.Vector3(...position),mode,part});
  }
  function shell(r:number,start:number,m:THREE.Material,name:string,part:EyePart,internal=false) {
    const segments=mobile?64:112,rows=mobile?40:64;
    const full=geo(ocularShell(r,start,Math.PI,segments,rows)),half=geo(ocularShell(r,start,Math.PI,segments/2,rows,true));
    const mesh=add(full,m,name,globe,part);shells.push({mesh,full,half});if(internal)interiors.push(mesh);return mesh;
  }
  function makeVessels() {
    const random=randomSource(),tubes:THREE.BufferGeometry[]=[];
    const toSurface=(x:number,y:number)=>new THREE.Vector3(x,y,-Math.sqrt(Math.max(.02,.933**2-x*x-y*y)));
    for(let branch=0;branch<12;branch++) {
      const sign=branch%2===0?1:-1,points:THREE.Vector3[]=[];
      for(let i=0;i<10;i++) {
        const t=i/9,x=.18-t*(.18+random()*.1)+(Math.sin(t*2.5+branch)*t*.28),y=sign*t*(.36+(branch%6)*.085);
        points.push(toSurface(x,y));
      }
      tubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),24,.0035+random()*.0035,5,false));
      for(let j=3;j<8;j+=2) {
        const p=points[j],end=p.clone();end.x-=.14+random()*.13;end.y+=sign*.08;
        const path=[p,p.clone().lerp(end,.5),toSurface(end.x,end.y)];
        tubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path),10,.002,4,false));
      }
    }
    const merged=mergeGeometries(tubes);tubes.forEach(g=>g.dispose());
    if(merged){const mesh=add(merged,new THREE.MeshPhysicalMaterial({color:0x82312a,roughness:.37,clearcoat:.35}),'Retinal_vessels');interiors.push(mesh);}
  }
  function buildEye(maps:EyeMaps) {
    shell(1,.505,createScleraMaterial(maps),'Sclera','sclera');
    shell(.968,.53,new THREE.MeshPhysicalMaterial({color:0x351d1b,map:maps.retina,roughness:.56,side:THREE.DoubleSide}),'Choroid','choroid',true);
    shell(.94,.60,createRetinaMaterial(maps),'Retina','retina',true);
    for(const [inner,outer,color,start] of [[.968,1,0xd9c5a9,.505],[.94,.968,0x542820,.53],[.933,.94,0xd08452,.60]]) {
      edges.push(add(coatEdge(inner,outer,start,72),new THREE.MeshStandardMaterial({color,roughness:.57,side:THREE.DoubleSide}),'Cut_edge'));
    }
    const cap=ocularShell(.65,0,.84,mobile?64:112,mobile?24:40);cap.translate(0,0,.43);
    cornea=add(cap,createOpticalMaterial('cornea',mobile,uniforms),'Corneal_dome',globe,'cornea');
    const halfCap=geo(ocularShell(.65,0,.84,mobile?32:56,mobile?24:40,true));halfCap.translate(0,0,.43);
    shells.push({mesh:cornea,full:cap,half:halfCap});
    cornea.renderOrder=4;
    iris=add(annulus(.13,.475,mobile?96:160,22),createIrisMaterial(maps.iris,uniforms),'Iris',globe,'iris');iris.position.z=.805;
    // Deep absorbing chamber visible through the actual annular iris opening.
    pupil=add(new THREE.CircleGeometry(.31,64),new THREE.MeshBasicMaterial({color:0x020201,side:THREE.DoubleSide}),'Pupil_dark_chamber',globe,'pupil');pupil.position.z=.76;
    lens=add(new THREE.SphereGeometry(1,mobile?48:80,mobile?24:40),createOpticalMaterial('lens',mobile,uniforms),'Crystalline_lens',globe,'lens');
    lens.scale.set(.365,.365,1);lens.position.z=.585;lens.renderOrder=3;interiors.push(lens);
    ciliary=new THREE.Group();ciliary.name='Ciliary_muscle';ciliary.position.z=.59;globe.add(ciliary);interiors.push(ciliary);
    const ring=add(new THREE.TorusGeometry(.485,.052,12,96),new THREE.MeshPhysicalMaterial({color:0x5c2925,roughness:.41,clearcoat:.3}),'Ciliary_ring',ciliary,'ciliary');
    const processGeometry=geo(new THREE.SphereGeometry(1,10,8));
    const processes=new THREE.InstancedMesh(processGeometry,ring.material,64);ciliary.add(processes);
    const dummy=new THREE.Object3D();
    for(let i=0;i<64;i++){const a=i/64*TAU;dummy.position.set(Math.cos(a)*.475,Math.sin(a)*.475,0);dummy.rotation.set(0,0,a);dummy.scale.set(.054,.011,.031);dummy.updateMatrix();processes.setMatrixAt(i,dummy.matrix);}
    const zg=geo(new THREE.BufferGeometry());zg.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(96*2*3),3));
    zonules=new THREE.LineSegments(zg,mat(new THREE.LineBasicMaterial({color:0xe1c9a4,transparent:true,opacity:.52})));zonules.name='Zonular_fibers';globe.add(zonules);interiors.push(zonules);
    const gel=add(ocularShell(.921,.98,Math.PI,mobile?40:64,32,true),new THREE.MeshPhysicalMaterial({color:0xa9d5d2,roughness:.09,transparent:true,opacity:.045,depthWrite:false,side:THREE.BackSide,clearcoat:.3}),'Vitreous_gel',globe,'fluid');interiors.push(gel);
    const nervePath=new THREE.CatmullRomCurve3([new THREE.Vector3(.18,0,-.92),new THREE.Vector3(.18,-.025,-1.14),new THREE.Vector3(.27,-.08,-1.42),new THREE.Vector3(.48,-.10,-1.63)]);
    add(new THREE.TubeGeometry(nervePath,36,.092,16,false),new THREE.MeshPhysicalMaterial({color:0xd9ba83,normalMap:maps.normal,normalScale:new THREE.Vector2(.24,.24),roughness:.56,clearcoat:.2}),'Optic_nerve',globe,'nerve');
    const disc=add(new THREE.SphereGeometry(1,28,16),new THREE.MeshStandardMaterial({color:0xeec084,roughness:.53}),'Optic_disc',globe,'nerve');disc.position.set(.18,0,-.912);disc.scale.set(.078,.089,.013);interiors.push(disc);
    const fovea=add(new THREE.SphereGeometry(1,28,16),new THREE.MeshPhysicalMaterial({color:0x673124,roughness:.45,clearcoat:.23}),'Macula_and_fovea',globe,'fovea');fovea.position.set(-.105,-.01,-.932);fovea.scale.set(.065,.052,.009);interiors.push(fovea);
    makeVessels();
    const neuralRoute=new THREE.CatmullRomCurve3([new THREE.Vector3(-.105,-.01,-.917),new THREE.Vector3(.02,.025,-.915),...nervePath.points]);
    const neuralPoints=neuralRoute.getPoints(160),ng=geo(new THREE.BufferGeometry().setFromPoints(neuralPoints));ng.setAttribute('travel',new THREE.Float32BufferAttribute(neuralPoints.map((_,i)=>i/160),1));
    nerveDots=new THREE.Points(ng,mat(createSignalMaterial(0x80dfc3,mobile)));signals.add(nerveDots);
    const pathArray=new Float32Array(3*3*2*3),rg=geo(new THREE.BufferGeometry());rg.setAttribute('position',new THREE.BufferAttribute(pathArray,3));
    rayLine=new THREE.LineSegments(rg,mat(new THREE.LineBasicMaterial({color:0xffd99b,transparent:true,opacity:.55})));rays.add(rayLine);
    const dg=geo(new THREE.BufferGeometry());dg.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(3*100*3),3));dg.setAttribute('travel',new THREE.Float32BufferAttribute(new Float32Array(300),1));
    rayDots=new THREE.Points(dg,mat(createSignalMaterial(0xffe1a2,mobile)));rays.add(rayDots);
    retinalSpot=add(new THREE.SphereGeometry(1,24,12),new THREE.MeshBasicMaterial({color:0xffd6a0,transparent:true,opacity:.8,depthWrite:false}),'Retinal_light_spot',rays);retinalSpot.position.set(.025,-.1,-.925);
    label('CORNEA',[.10,.36,1.0],'eye','cornea');label('IRIS',[-.31,.25,.82],'eye','iris');
    label('LENS',[.17,-.26,.59],'eye','lens');label('RETINA',[.015,.67,-.62],'eye','retina');
    label('OPTIC NERVE',[.35,-.20,-1.36],'eye','nerve');
    label('FOCUSING MUSCLE',[.06,-.51,.57],'eye','ciliary');
  }
  function buildMicro(maps:EyeMaps) {
    const random=randomSource(),dummy=new THREE.Object3D();
    const bed=add(new THREE.BoxGeometry(2.45,.16,1.7,32,1,24),new THREE.MeshPhysicalMaterial({color:0x633726,map:maps.retina,roughness:.62,normalMap:maps.normal,normalScale:new THREE.Vector2(.3,.3)}),'Retinal_pigment_layer',micro);bed.position.y=-.34;
    const count=mobile?88:180,rodCount=mobile?176:360;
    cones=new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(.041,.019,.37,12,3)),mat(createPhotoreceptorMaterial(0xffffff)),count);cones.name='Cone_outer_segments';micro.add(cones);
    rods=new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(.016,.014,.43,9,2)),mat(createPhotoreceptorMaterial(0xbcaea7)),rodCount);rods.name='Rod_outer_segments';micro.add(rods);
    coneTypes=[];const coneStalks:THREE.BufferGeometry[]=[],rodStalks:THREE.BufferGeometry[]=[];
    for(let i=0;i<count+rodCount;i++) {
      const isCone=i<count,index=isCone?i:i-count,mesh=isCone?cones:rods;
      // Even jittered packing keeps cell membranes from intersecting.
      const placement=i*197%(count+rodCount),cols=mobile?22:30,col=placement%cols,row=Math.floor(placement/cols),rows=Math.ceil((count+rodCount)/cols);
      const x=(col/(cols-1)-.5)*2.28+(random()-.5)*.018,z=(row/(rows-1)-.5)*1.51+(random()-.5)*.018;
      const scale=.88+random()*.22,y=-.06;
      dummy.position.set(x,y,z);dummy.rotation.set((random()-.5)*.045,0,(random()-.5)*.045);dummy.scale.setScalar(scale);dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);
      if(isCone)coneTypes.push(i%11===0?0:i%3===0?1:2);
      if(i%3===0) {
        const stalks=isCone?coneStalks:rodStalks;
        const g=new THREE.CylinderGeometry(.009,.015,.32,5);g.translate(x,.26,z);stalks.push(g);
        const body=new THREE.SphereGeometry(.031,8,6);body.scale(.8,1.8,.8);body.translate(x,.43,z);stalks.push(body);
      }
    }
    // Shared merged inner-segment tissue; outer photoreceptors point toward pigment.
    const bodyMaterial=new THREE.MeshPhysicalMaterial({color:0xcba090,roughness:.5,clearcoat:.22});
    const coneGeometry=mergeGeometries(coneStalks)!,rodGeometry=mergeGeometries(rodStalks)!;
    [...coneStalks,...rodStalks].forEach(g=>g.dispose());
    coneBodies=add(coneGeometry,bodyMaterial,'Cone_inner_segments',micro);
    rodBodies=add(rodGeometry,bodyMaterial,'Rod_inner_segments',micro);
    const lightGeo=geo(new THREE.BufferGeometry());const p:number[]=[],travel:number[]=[];
    for(let lane=0;lane<14;lane++)for(let j=0;j<30;j++) {p.push((lane/13-.5)*2.1,.98-j/29*1.12,.17);travel.push(j/29+lane*.035);}
    lightGeo.setAttribute('position',new THREE.Float32BufferAttribute(p,3));lightGeo.setAttribute('travel',new THREE.Float32BufferAttribute(travel,1));
    micro.add(new THREE.Points(lightGeo,mat(createSignalMaterial(0xffdda2,mobile))));
    label('LIGHT ARRIVES FROM ABOVE',[0,1.02,.1],'micro');
    label('RODS',[.76,.02,.7],'micro');label('CONES',[-.83,.03,-.62],'micro');
    label('PIGMENT LAYER',[.77,-.34,.84],'micro');
  }
  function updateRays() {
    const optics=eyeOptics(options),line=rayLine.geometry.attributes.position,dots=rayDots.geometry.attributes.position,travel=rayDots.geometry.attributes.travel;
    let n=0;
    for(let beam=0;beam<3;beam++) {
      const y=(beam-1)*Math.min(optics.pupil*.77,.14);
      // A schematic off-axis point demonstrates image inversion and two bends.
      const lensPoint=new THREE.Vector3(.025,y,.585),virtualFocus=new THREE.Vector3(.025,-.10,optics.focusZ);
      // Absorption stops light at the retina even when its virtual focus is beyond it.
      const retinalPoint=lensPoint.clone().lerp(virtualFocus,(-.925-.585)/(optics.focusZ-.585));
      const nodes=[new THREE.Vector3(.025,.32,2.12-options.near/100*.30),new THREE.Vector3(.025,y+.05,1.065),lensPoint,retinalPoint];
      for(let j=0;j<3;j++){line.setXYZ(n++,...nodes[j].toArray());line.setXYZ(n++,...nodes[j+1].toArray());}
      const lengths=[nodes[0].distanceTo(nodes[1]),nodes[1].distanceTo(nodes[2]),nodes[2].distanceTo(nodes[3])],total=lengths.reduce((a,b)=>a+b);
      for(let i=0;i<100;i++) {
        let distance=i/99*total,segment=0;while(segment<2&&distance>lengths[segment])distance-=lengths[segment++];
        direction.lerpVectors(nodes[segment],nodes[segment+1],distance/lengths[segment]);dots.setXYZ(beam*100+i,direction.x,direction.y,direction.z);travel.setX(beam*100+i,i/99);
      }
    }
    line.needsUpdate=dots.needsUpdate=travel.needsUpdate=true;
    rayLine.geometry.computeBoundingSphere();rayDots.geometry.computeBoundingSphere();
    retinalSpot.scale.set(.011+optics.blur*.075,.013+optics.blur*.075,.005);
    (retinalSpot.material as THREE.MeshBasicMaterial).opacity=.8-optics.blur*.48;
  }
  function sync() {
    if(!ready)return;
    const inside=options.mode==='cutaway',retina=options.mode==='retina',optics=eyeOptics(options);
    globe.visible=!retina;micro.visible=retina;
    shells.forEach(({mesh,half,full})=>mesh.geometry=inside?half:full);
    interiors.forEach(mesh=>mesh.visible=inside);edges.forEach(mesh=>mesh.visible=inside);
    cornea.visible=true;iris.visible=true;pupil.visible=!inside;
    // Cut the iris too, so no opaque surface hides the lens demonstration.
    const irisMaterial=iris.material as THREE.MeshPhysicalMaterial;
    if((irisMaterial.clippingPlanes?.length??0)!==(inside?1:0)) {
      irisMaterial.clippingPlanes=inside?[new THREE.Plane(new THREE.Vector3(-1,0,0),0)]:[];
      irisMaterial.needsUpdate=true;
    }
    ciliary.scale.setScalar(optics.ciliaryRadius/.485);
    uniforms.pupilRadius.value=optics.pupil;uniforms.lensDepth.value=optics.lensDepth;
    lens.scale.set(optics.lensRadius,optics.lensRadius,1);
    (lens.material as THREE.MeshPhysicalMaterial).thickness=optics.lensDepth*2;
    const zp=zonules.geometry.attributes.position;
    for(let i=0;i<96;i++){const a=i/96*TAU,c=Math.cos(a),s=Math.sin(a),z=.585+(i%2===0?-.035:.035);
      zp.setXYZ(i*2,c*optics.lensRadius,s*optics.lensRadius,z);zp.setXYZ(i*2+1,c*optics.ciliaryRadius,s*optics.ciliaryRadius,.59);}
    zp.needsUpdate=true;zonules.geometry.computeBoundingSphere();
    rays.visible=inside&&['light','focus'].includes(options.lesson);signals.visible=inside&&options.lesson==='signal';
    updateRays();
    cones.visible=coneBodies.visible=options.cones;rods.visible=rodBodies.visible=options.rods;
    const response=photoreceptorResponse(options.wavelength),values=[response.s,response.m,response.l],colors=[0x6e9cdd,0x76bba1,0xd48c78];
    const intensity=options.light/100,color=new THREE.Color();
    for(let i=0;i<cones.count;i++) {
      color.setHex(colors[coneTypes[i]]).multiplyScalar(.26+values[coneTypes[i]]*Math.min(1,intensity*1.8)*1.2);cones.setColorAt(i,color);
    }
    if(cones.instanceColor)cones.instanceColor.needsUpdate=true;
    (rods.material as THREE.MeshPhysicalMaterial).color.setHex(0xbcaea7).multiplyScalar(.5+response.rod*(1-intensity)*.8);
    for(const [part,objects] of parts)for(const object of objects)if(object instanceof THREE.Mesh&&object.material instanceof THREE.MeshStandardMaterial) {
      object.material.emissive.setHex(part===options.part&&options.lesson==='parts'&&options.mode==='cutaway'?0x75542b:0x000000);
      object.material.emissiveIntensity=.16;
    }
    const lightColor=new THREE.Color().setRGB(...spectrumColor(options.wavelength));
    micro.traverse(node=>{if(node instanceof THREE.Points)(node.material as THREE.ShaderMaterial).uniforms.tint.value.copy(lightColor);});
    needsSync=false;
  }
  function frame() {
    const retina=options.mode==='retina',inside=options.mode==='cutaway';
    const aspect=Math.max(.38,o.camera.aspect);
    const distance=Math.max(retina?3.8:4.6,(retina?2.5:2.2)/(2*Math.tan(o.camera.fov*Math.PI/360)*aspect))*1.10;
    const look=retina?new THREE.Vector3(0,.15,0):inside?new THREE.Vector3(0,0,.1):new THREE.Vector3(0,0,.04);
    const vector=(retina?new THREE.Vector3(.8,1.25,2.2):inside?new THREE.Vector3(3,.45,1.25):new THREE.Vector3(.20,.12,3)).normalize();
    o.controls.target.copy(look);o.camera.position.copy(look).addScaledVector(vector,distance);
    o.controls.minDistance=retina?1.8:2.0;o.controls.maxDistance=distance*2.2;
    o.camera.near=.025;o.camera.far=100;o.camera.updateProjectionMatrix();o.camera.lookAt(look);o.camera.updateMatrixWorld(true);o.wake();
  }
  function positionLabels() {
    labelLayer.hidden=!interactive||!options.labels;
    if(labelLayer.hidden)return;
    for(const item of labels) {
      const retina=options.mode==='retina';
      let visible=(item.mode==='micro')===retina;
      if(!retina&&options.mode==='surface')visible=visible&&['iris','cornea'].includes(item.part??'');
      if(mobile&&!retina&&options.mode==='cutaway')visible=visible&&['lens','retina','cornea'].includes(item.part??'');
      projected.copy(item.position).project(o.camera);
      visible=visible&&projected.z>-1&&projected.z<1&&Math.abs(projected.x)<.93&&Math.abs(projected.y)<.93;
      // Globe labels are intended for the cut face; hide interior labels from behind.
      if(!retina&&options.mode==='cutaway'&&o.camera.position.x<.1)visible=false;
      item.element.hidden=!visible;
      if(visible){item.element.style.left=`${(projected.x*.5+.5)*100}%`;item.element.style.top=`${(-projected.y*.5+.5)*100}%`;}
    }
  }
  function release() {
    root.traverse(node=>{if(node instanceof THREE.InstancedMesh)node.dispose();});
    globe.clear();micro.clear();rays.clear();signals.clear();shells.length=interiors.length=edges.length=0;parts.clear();
    labelLayer.replaceChildren();labels.length=0;labelLayer.hidden=true;
    geometries.forEach(g=>g.dispose());geometries.clear();materials.forEach(m=>m.dispose());materials.clear();
    textures.forEach(t=>{t.dispose();(t.image as ImageBitmap)?.close?.();});textures.clear();ready=false;
  }
  async function load(width:number) {
    if(ready||disposed)return;if(promise)return promise;
    const task=(async()=>{
      mobile=width<768;options=defaultEyeOptions();
      if(!blobCache) {
        const results=await Promise.allSettled(['iris-color.webp','sclera-color.webp','sclera-normal.webp','retina-color.webp'].map(async name=>{
          const r=await fetch(`${BASE}${name}?v=eye-1`,{signal:abort.signal});if(!r.ok)throw new Error('Eye texture unavailable');return r.blob();
        }));
        const failure=results.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
        blobCache=results.map(r=>(r as PromiseFulfilledResult<Blob>).value);
      }
      const decoded=await Promise.allSettled(blobCache.map(async (blob,i)=>{
        const bitmap=await createImageBitmap(blob,{resizeWidth:mobile?1024:undefined,imageOrientation:'none',premultiplyAlpha:'none'});
        if(disposed||o.signal.aborted){bitmap.close();throw new Error('Disposed');}
        const texture=new THREE.Texture(bitmap);texture.colorSpace=i===2?THREE.NoColorSpace:THREE.SRGBColorSpace;
        texture.anisotropy=Math.min(mobile?4:8,o.renderer.capabilities.getMaxAnisotropy());texture.needsUpdate=true;textures.add(texture);return texture;
      }));
      const failed=decoded.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
      const [iris,sclera,normal,retina]=decoded.map(r=>(r as PromiseFulfilledResult<THREE.Texture>).value),maps={iris,sclera,normal,retina};
      buildEye(maps);buildMicro(maps);root.updateMatrixWorld(true);ready=true;needsSync=true;sync();
    })();
    promise=task;
    try{await task;}catch(error){release();throw error;}finally{if(promise===task)promise=undefined;}
  }
  return {scene,root,load,frame,get ready(){return ready;},get options(){return {...options};},
    setInteractive(value:boolean){interactive=value;labelLayer.hidden=!value||!options.labels;},
    setOptions(value:Partial<EyeViewOptions>){const old=options.mode;options=normalizeEyeOptions({...options,...value});needsSync=true;sync();if(options.mode!==old)frame();o.wake();},
    update(dt:number,animated:boolean) {
      if(!ready)return false;if(needsSync)sync();
      const moving=animated&&!o.reduced&&(rays.visible||signals.visible||micro.visible);
      if(moving)time+=dt;
      for(const material of materials)if(material instanceof THREE.ShaderMaterial&&material.uniforms.time)material.uniforms.time.value=time;
      positionLabels();return moving;
    },
    unload(){interactive=false;if(ready&&!disposed)release();},
    dispose(){if(disposed)return;disposed=true;abort.abort();o.signal.removeEventListener('abort',abortParent);blobCache=undefined;release();labelLayer.remove();},
  };
}
export type EyeDetail=ReturnType<typeof createEyeDetail>;
