import * as THREE from 'three';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createAirMaterial,createAlveolarMaterial,createDiaphragmMaterial,createPleuralMaterial,type LungMaps} from './lung-materials';
import {defaultLungOptions,lungCycle,normalizeLungOptions,type LungViewOptions} from './lung-physiology';
type Options={renderer:THREE.WebGLRenderer;environment:THREE.Texture|null;signal:AbortSignal;canvas:HTMLCanvasElement;
  camera:THREE.PerspectiveCamera;controls:OrbitControls;wake():void;reduced:boolean};
const TAU=Math.PI*2;
const randomSource=()=>{let seed=83109;return()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);};
/** Anterior is +Z. Anatomical right is viewer-left (-X).
 * The broad concave base, narrow apex and left cardiac notch are built into the surface. */
export function lungSurface(side:number,t:number,a:number) {
  const r=Math.pow(Math.max(0,Math.sin(Math.PI*t)),.43)*(1.08-.29*t),c=Math.cos(a),s=Math.sin(a);
  const width=side<0?.88:.77,notch=side>0?Math.exp(-(((t-.43)/.17)**2))*Math.max(0,-c)**3*(.65+.35*Math.max(0,s))*.38:0;
  const irregular=1+.012*Math.sin(a*3+t*15)+.007*Math.sin(a*7-t*23);
  return new THREE.Vector3(side*(.80-.23*t)+side*(c*width*r*(c<0?.80:1)*irregular+notch),
    -1.26+2.66*t+.22*Math.exp(-t*30)-.055*c*(1-t)**3,s*.68*r*irregular-.10*(1-t));
}
const oblique=(a:number)=>.45+.19*Math.cos(a)-.13*Math.sin(a);
const horizontal=(a:number)=>Math.max(oblique(a),.585-.015*Math.cos(a));
function lobeGeometry(side:number,lobe:number,segments:number,rows:number) {
  const p:number[]=[],uv:number[]=[],ix:number[]=[];
  for(let y=0;y<=rows;y++)for(let x=0;x<=segments;x++){
    const a=x/segments*TAU;
    const low=lobe===0?oblique(a):lobe===1?0:oblique(a);
    const high=lobe===0?1:lobe===1?oblique(a):horizontal(a);
    // Right upper lobe meets the middle lobe along the horizontal fissure.
    const lo=side<0&&lobe===0?horizontal(a):low;
    const edge=y/rows,t=lo+(high-lo)*edge,v=lungSurface(side,t,a);
    const fissureLow=lo>0&&edge<.08,fissureHigh=high<1&&edge>.92;
    const recess=(fissureLow?Math.exp(-edge*90):fissureHigh?Math.exp(-(1-edge)*90):0)*.016;
    v.x-=side*Math.cos(a)*recess;v.z-=Math.sin(a)*recess;
    if(fissureLow)v.y+=.0015;if(fissureHigh)v.y-=.0015;
    p.push(v.x,v.y,v.z);uv.push(x/segments,t);
    if(x<segments&&y<rows){const b=y*(segments+1)+x,n=b+segments+1;if(side>0)ix.push(b,n,b+1,n,n+1,b+1);else ix.push(b,b+1,n,n,b+1,n+1);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();return g;
}
function diaphragmGeometry(segments:number,rows:number) {
  const p:number[]=[],uv:number[]=[],ix:number[]=[];
  for(let j=0;j<=rows;j++)for(let i=0;i<=segments;i++){
    const a=i/segments*TAU,r=j/rows,x=Math.cos(a)*r*1.74,z=Math.sin(a)*r*.88;
    p.push(x,-1.55+.35*(1-r*r),z-.02);uv.push(i/segments,r);
    if(j<rows&&i<segments){const b=j*(segments+1)+i,n=b+segments+1;ix.push(b,b+1,n,n,b+1,n+1);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();return g;
}
function taperedTube(path:THREE.CatmullRomCurve3,radius:number,segments:number,radial=7,taper=.7) {
  const g=new THREE.TubeGeometry(path,segments,radius,radial,false),p=g.attributes.position;
  for(let i=0;i<=segments;i++){const center=path.getPointAt(i/segments);for(let j=0;j<=radial;j++){
    const at=i*(radial+1)+j,k=1-(1-taper)*i/segments;p.setXYZ(at,center.x+(p.getX(at)-center.x)*k,center.y+(p.getY(at)-center.y)*k,center.z+(p.getZ(at)-center.z)*k);
  }}g.computeVertexNormals();return g;
}
export function createLungDetail(o:Options) {
  const scene=new THREE.Scene();scene.environment=o.environment;scene.environmentIntensity=.42;
  const root=new THREE.Group();root.name='Isolated_lungs';scene.add(root);
  const macro=new THREE.Group(),breathing=new THREE.Group(),surface=new THREE.Group(),airways=new THREE.Group(),micro=new THREE.Group();
  macro.name='Respiratory_anatomy';breathing.name='Breathing_lung_tissue';surface.name='Five_lung_lobes';airways.name='Bronchial_tree';micro.name='Alveolar_closeup';
  root.add(macro,micro);macro.add(breathing);breathing.add(surface,airways);
  const key=new THREE.DirectionalLight(0xffeee3,2.8);key.position.set(-3,4,5);
  const fill=new THREE.DirectionalLight(0xc6deee,.8);fill.position.set(3,1,3);
  const rim=new THREE.DirectionalLight(0xf0c8b3,2.1);rim.position.set(2,3,-3);
  scene.add(key,fill,rim,new THREE.HemisphereLight(0xe7eff4,0x392228,.48));
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
  const geo=<T extends THREE.BufferGeometry>(g:T)=>{geometries.add(g);return g;};
  const mat=<T extends THREE.Material>(m:T)=>{materials.add(m);return m;};
  function add(g:THREE.BufferGeometry,m:THREE.Material,name:string,parent:THREE.Object3D=macro){const mesh=new THREE.Mesh(geo(g),mat(m));mesh.name=name;parent.add(mesh);return mesh;}
  function merged(parts:THREE.BufferGeometry[],m:THREE.Material,name:string,parent:THREE.Object3D){const g=mergeGeometries(parts)!;parts.forEach(p=>p.dispose());return add(g,m,name,parent);}
  const labelLayer=document.createElement('div');labelLayer.className='lung-label-layer';labelLayer.hidden=true;labelLayer.setAttribute('aria-hidden','true');o.canvas.parentElement?.appendChild(labelLayer);
  const breathHud=document.createElement('span');breathHud.className='lung-breath-hud';
  const labels:{el:HTMLSpanElement;p:THREE.Vector3;micro:boolean}[]=[];
  function label(text:string,p:[number,number,number],small=false){const el=document.createElement('span');el.className='lung-model-label';el.textContent=text;labelLayer.appendChild(el);labels.push({el,p:new THREE.Vector3(...p),micro:small});}
  const abort=new AbortController(),abortParent=()=>abort.abort();o.signal.addEventListener('abort',abortParent,{once:true});
  const inflation={value:0};let options=defaultLungOptions(),phase=options.phase,ready=false,disposed=false,mobile=false,interactive=false;
  let promise:Promise<void>|undefined,blobCache:Blob[]|undefined,air:THREE.Points,airTop:THREE.Points;
  let ghost:THREE.MeshPhysicalMaterial,pleura:THREE.MeshPhysicalMaterial;
  let mapsCache:LungMaps|undefined,microBuilt=false;
  let blood:THREE.InstancedMesh,oxygen:THREE.InstancedMesh,carbon:THREE.InstancedMesh,bloodTime=0,travel=0,running=false;
  const bloodRoutes:THREE.CatmullRomCurve3[]=[],dummy=new THREE.Object3D(),point=new THREE.Vector3(),tangent=new THREE.Vector3(),axis=new THREE.Vector3(0,1,0),color=new THREE.Color();
  function makeAir(paths:THREE.CatmullRomCurve3[],parent:THREE.Object3D,name:string) {
    const p:number[]=[],along:number[]=[],lane:number[]=[];
    paths.forEach((path,j)=>{const length=path.getLength();if(length<.14&&j%4!==0)return;
      const steps=Math.max(5,Math.ceil(length*(mobile?38:52)));for(let i=0;i<=steps;i++){const v=path.getPointAt(i/steps);p.push(v.x,v.y,v.z);along.push(i/steps*length*.65);lane.push(j*.173);}});
    const g=geo(new THREE.BufferGeometry());g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('along',new THREE.Float32BufferAttribute(along,1));g.setAttribute('lane',new THREE.Float32BufferAttribute(lane,1));
    const dots=new THREE.Points(g,mat(createAirMaterial(mobile)));dots.name=name;dots.renderOrder=5;parent.add(dots);return dots;
  }
  function buildMacro(maps:LungMaps) {
    labelLayer.appendChild(breathHud);
    pleura=mat(createPleuralMaterial(maps));
    ghost=mat(new THREE.MeshPhysicalMaterial({name:'Illustrative_lung_envelope',color:0xd7a3a1,roughness:.4,transparent:true,opacity:.085,depthWrite:false,side:THREE.FrontSide,clearcoat:.2}));
    for(const side of [-1,1])for(let lobe=0;lobe<(side<0?3:2);lobe++){
      add(lobeGeometry(side,lobe,mobile?64:104,mobile?24:40),pleura,`${side<0?'Right':'Left'}_${['upper','lower','middle'][lobe]}_lobe`,surface);
    }
    const airwayMat=mat(new THREE.MeshPhysicalMaterial({name:'Bronchial_mucosa',color:0xd4b8a1,roughness:.42,normalMap:maps.normal,normalScale:new THREE.Vector2(.24,.24),clearcoat:.28}));
    const cartilageMat=mat(new THREE.MeshPhysicalMaterial({color:0xded1b7,roughness:.51,normalMap:maps.normal,normalScale:new THREE.Vector2(.17,.17),clearcoat:.15}));
    const tracheaPath=new THREE.CatmullRomCurve3([new THREE.Vector3(0,2.02,0),new THREE.Vector3(0,1.42,.005),new THREE.Vector3(0,.82,.02)]);
    add(taperedTube(tracheaPath,.117,30,18,.9),airwayMat,'Tracheal_wall');
    const rings:THREE.BufferGeometry[]=[];
    // Cartilage is C-shaped: the posterior membranous wall remains flexible.
    for(let i=0;i<16;i++){const g=new THREE.TorusGeometry(.121,.014,6,26,Math.PI*1.72);g.rotateZ(-Math.PI*.36);g.rotateX(Math.PI/2);g.translate(0,.86+i*.072,0);rings.push(g);}
    merged(rings,cartilageMat,'C_shaped_cartilage',macro);
    const rimG=new THREE.TorusGeometry(.114,.008,8,40);rimG.rotateX(Math.PI/2);rimG.translate(0,2.018,0);add(rimG,airwayMat,'Tracheal_rim');
    const dark=new THREE.CircleGeometry(.102,36);dark.rotateX(-Math.PI/2);dark.translate(0,1.93,0);add(dark,new THREE.MeshBasicMaterial({color:0x342628,side:THREE.DoubleSide}),'Tracheal_lumen');
    const paths:THREE.CatmullRomCurve3[]=[],tubes:THREE.BufferGeometry[]=[],mainTubes:THREE.BufferGeometry[]=[],bronchialRings:THREE.BufferGeometry[]=[],random=randomSource();
    function branch(start:THREE.Vector3,end:THREE.Vector3,r:number,depth=0) {
      const mid=start.clone().lerp(end,.48);mid.z+=.025;const path=new THREE.CatmullRomCurve3([start,mid,end]);
      paths.push(path);(depth<0?mainTubes:tubes).push(taperedTube(path,r,depth>2?7:20,depth>2?5:14));
      if(depth<2){const length=path.getLength(),count=Math.floor(length/.055);for(let i=1;i<count;i++){
        const p=i/count,g=new THREE.TorusGeometry(r*(1-.3*p)+.003,Math.max(.003,r*.085),5,14,Math.PI*1.7);
        path.getPointAt(p,point);path.getTangentAt(p,tangent);const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),tangent);
        g.applyQuaternion(q);g.translate(point.x,point.y,point.z);bronchialRings.push(g);
      }}
    }
    function divide(start:THREE.Vector3,ends:THREE.Vector3[],radius:number,depth:number) {
      const center=new THREE.Vector3();ends.forEach(p=>center.add(p));center.multiplyScalar(1/ends.length);
      branch(start,center,radius,depth);if(ends.length<2)return;
      const bounds=new THREE.Box3().setFromPoints(ends),size=bounds.getSize(new THREE.Vector3());
      const key:sizeKey=size.x>size.y&&size.x>size.z?'x':size.y>size.z?'y':'z';
      ends.sort((a,b)=>a[key]-b[key]);const n=Math.ceil(ends.length/2);
      divide(center,ends.slice(0,n),radius*.64,depth+1);divide(center,ends.slice(n),radius*.64,depth+1);
    }
    type sizeKey='x'|'y'|'z';
    for(const side of [-1,1]){
      const hilum=new THREE.Vector3(side*.37,.35,.0);branch(new THREE.Vector3(0,.82,.02),hilum,side<0?.085:.072,-1);
      for(let lobe=0;lobe<(side<0?3:2);lobe++){
        const ends:THREE.Vector3[]=[];
        for(let i=0;i<(mobile?48:96);i++){
          const a=lobe===2?.15+random()*2.8:random()*TAU;
          const t=lobe===0?.64+random()*.26:lobe===1?.10+random()*.23:.37+random()*.16;
          const v=lungSurface(side,t,a),center=side*(.80-.23*t);v.x=center+(v.x-center)*(.55+random()*.32);v.z*=.70+random()*.15;ends.push(v);
        }
        divide(hilum,ends,lobe===0?.06:.056,0);
      }
    }
    merged(tubes,airwayMat,'Branching_bronchi_and_bronchioles',airways);
    merged(mainTubes,airwayMat,'Main_bronchi',breathing);
    merged(bronchialRings,cartilageMat,'Bronchial_cartilage',airways);
    air=makeAir(paths,airways,'Air_in_branching_airways');airTop=makeAir([new THREE.CatmullRomCurve3([new THREE.Vector3(0,2.28,.15),new THREE.Vector3(0,1.50,.15),new THREE.Vector3(0,.82,.15)])],macro,'Air_at_windpipe');
    add(diaphragmGeometry(mobile?64:96,24),createDiaphragmMaterial(maps,{inflation}),'Diaphragm');
    label(mobile?'WINDPIPE':'WINDPIPE · AIR IN / OUT',[.35,1.92,.13]);label(mobile?'RIGHT · 3 LOBES':'RIGHT LUNG · 3 LOBES',[-1.26,.65,.62]);
    label(mobile?'LEFT · 2 LOBES':'LEFT LUNG · 2 LOBES',[1.25,.62,.61]);label('DIAPHRAGM',[0,-1.53,.76]);
  }
  function buildMicro(maps:LungMaps) {
    const membrane=mat(createAlveolarMaterial(maps,mobile));
    // A cut-open alveolus is surrounded by smaller members of its alveolar sac.
    const cut=new THREE.SphereGeometry(.88,mobile?48:72,mobile?30:44,0,TAU,Math.PI*.30,Math.PI*.70);
    cut.rotateX(Math.PI/2);add(cut,membrane,'Open_alveolar_air_sac',micro);
    const edge=new THREE.TorusGeometry(.88*Math.sin(Math.PI*.30),.018,8,72);edge.translate(0,0,.88*Math.cos(Math.PI*.30));
    add(edge,new THREE.MeshPhysicalMaterial({color:0xc39188,roughness:.50,clearcoat:.22,normalMap:maps.normal,normalScale:new THREE.Vector2(.25,.25)}),'Cut_membrane_edge',micro);
    const sacGeometry=geo(new THREE.SphereGeometry(1,mobile?20:28,mobile?14:20)),sacPositions=sacGeometry.attributes.position;
    for(let i=0;i<sacPositions.count;i++){const x=sacPositions.getX(i),y=sacPositions.getY(i),z=sacPositions.getZ(i),k=1+.036*Math.sin(x*9+y*4)*Math.sin(z*7-y*3);sacPositions.setXYZ(i,x*k,y*k,z*k);}sacGeometry.computeVertexNormals();
    const alveoli=new THREE.InstancedMesh(sacGeometry,membrane,14);alveoli.name='Neighboring_alveoli';micro.add(alveoli);
    for(let i=0;i<14;i++){const a=i/14*TAU;dummy.position.set(Math.cos(a)*.95,Math.sin(a)*.83,-.38-(i%3)*.08);dummy.scale.set(.28+(i%3)*.035,.29+(i%2)*.045,.31);dummy.rotation.set(0,a,.2);dummy.updateMatrix();alveoli.setMatrixAt(i,dummy.matrix);}
    const vesselParts:THREE.BufferGeometry[]=[],venousParts:THREE.BufferGeometry[]=[];
    for(let j=0;j<9;j++){
      const pts:THREE.Vector3[]=[];
      for(let i=0;i<=18;i++){
        const t=i/18,x=-1.18+t*2.36,band=(j-4)*.155;
        const wave=Math.sin(t*23+j*1.17)*.041+Math.sin(t*41+j*2.3)*.016;
        const y=t<.14?THREE.MathUtils.lerp(-.74,band,t/.14):t>.86?THREE.MathUtils.lerp(band,.68,(t-.86)/.14):band+wave;
        // The net follows the OUTSIDE of the posterior wall. The front is cut open.
        // It must never bridge across the exposed air space like a cage.
        const z=-Math.sqrt(Math.max(.015,.905**2-x*x-y*y))-.018;
        pts.push(new THREE.Vector3(x,y,z));
      }
      const path=new THREE.CatmullRomCurve3(pts);bloodRoutes.push(path);
      const first=new THREE.CatmullRomCurve3(path.getPoints(36).slice(0,19)),last=new THREE.CatmullRomCurve3(path.getPoints(36).slice(18));
      venousParts.push(new THREE.TubeGeometry(first,28,.015,7,false));vesselParts.push(new THREE.TubeGeometry(last,28,.015,7,false));
    }
    // Anastomosing capillaries form a net over the thin alveolar membrane.
    for(let j=0;j<8;j++)for(let i=3;i<16;i+=3){
      const p=bloodRoutes[j].getPoint(i/18),q=bloodRoutes[j+1].getPoint((i+(j%2?.5:-.5))/18);
      const mid=p.clone().lerp(q,.5);mid.x+=.015;mid.z=-Math.sqrt(Math.max(.015,.905**2-mid.x**2-mid.y**2))-.018;
      const g=new THREE.TubeGeometry(new THREE.CatmullRomCurve3([p,mid,q]),8,.008,5,false);
      (i<9?venousParts:vesselParts).push(g);
    }
    const capillary=(c:number)=>new THREE.MeshPhysicalMaterial({color:c,roughness:.48,clearcoat:.25,transparent:true,opacity:.54,depthWrite:false,normalMap:maps.normal,normalScale:new THREE.Vector2(.12,.12)});
    merged(venousParts,capillary(0x672934),'Capillaries_with_less_oxygen',micro);merged(vesselParts,capillary(0xb83e3b),'Capillaries_with_more_oxygen',micro);
    // Enlarged erythrocytes retain biconcave geometry and move continuously through the net.
    const cell=geo(new THREE.SphereGeometry(1,14,10)),cp=cell.attributes.position;
    for(let i=0;i<cp.count;i++){const y=cp.getY(i),rad=Math.hypot(cp.getX(i),cp.getZ(i));cp.setY(i,y*(.17+.24*Math.min(1,rad*rad)));}cell.computeVertexNormals();
    blood=new THREE.InstancedMesh(cell,mat(new THREE.MeshPhysicalMaterial({color:0xffffff,roughness:.43,clearcoat:.25})),mobile?36:63);blood.name='Moving_red_blood_cells';micro.add(blood);blood.instanceMatrix.setUsage(THREE.DynamicDrawUsage);blood.frustumCulled=false;
    const dot=geo(new THREE.SphereGeometry(.033,10,7));
    oxygen=new THREE.InstancedMesh(dot,mat(new THREE.MeshPhysicalMaterial({color:0x8ae4ed,emissive:0x1d8e9e,emissiveIntensity:.5,roughness:.2})),10);
    carbon=new THREE.InstancedMesh(dot,mat(new THREE.MeshPhysicalMaterial({color:0xeec28b,emissive:0x925e1e,emissiveIntensity:.35,roughness:.25})),10);
    oxygen.name='Oxygen_diffusing_into_blood';carbon.name='Carbon_dioxide_diffusing_into_air';micro.add(oxygen,carbon);
    oxygen.instanceMatrix.setUsage(THREE.DynamicDrawUsage);carbon.instanceMatrix.setUsage(THREE.DynamicDrawUsage);oxygen.frustumCulled=carbon.frustumCulled=false;
    // Flattened epithelial nuclei: a subtle second scale of real tissue structure.
    const nuclei=new THREE.InstancedMesh(geo(new THREE.SphereGeometry(1,9,7)),mat(new THREE.MeshPhysicalMaterial({color:0x995f71,roughness:.62,transparent:true,opacity:.35,depthWrite:false})),mobile?50:90);
    nuclei.name='Alveolar_epithelial_nuclei';micro.add(nuclei);const random=randomSource();
    for(let i=0;i<nuclei.count;i++){
      const a=random()*TAU,r=Math.sqrt(random())*.81,x=Math.cos(a)*r,y=Math.sin(a)*r,z=-Math.sqrt(.88**2-x*x-y*y)+.006;
      dummy.position.set(x,y,z);dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),dummy.position.clone().normalize());dummy.scale.set(.018,.011,.004);dummy.updateMatrix();nuclei.setMatrixAt(i,dummy.matrix);
    }
    label('AIR SPACE',[0,.43,.05],true);label('THIN, MOIST WALL',[-.88,.84,.3],true);
    label('O₂ → BLOOD',[.50,.06,.15],true);label('CO₂ → AIR',[-.37,-.20,.15],true);
    label('BLOOD ARRIVES',[-1.25,-.84,.35],true);label('BLOOD LEAVES',[1.19,-.84,.35],true);
  }
  function updateMicro() {
    for(let i=0;i<blood.count;i++){
      const p=(bloodTime*.115+i*.137)%1,route=bloodRoutes[i%bloodRoutes.length];route.getPointAt(p,point);route.getTangentAt(p,tangent);
      dummy.position.copy(point);dummy.quaternion.setFromUnitVectors(axis,tangent);dummy.scale.set(.023,.023,.023);dummy.updateMatrix();blood.setMatrixAt(i,dummy.matrix);
      color.setRGB(.19+.43*THREE.MathUtils.smoothstep(p,.35,.68),.017,.029);blood.setColorAt(i,color);
    }
    blood.instanceMatrix.needsUpdate=true;if(blood.instanceColor)blood.instanceColor.needsUpdate=true;
    for(let i=0;i<10;i++){
      const t=(bloodTime*.24+i/10)%1,x=-.49+(i%5)*.23,y=(i<5?-.24:.20),z=-Math.sqrt(.905**2-x*x-y*y)-.018;
      dummy.quaternion.identity();dummy.scale.setScalar(Math.sin(Math.PI*t)*.85+.15);
      dummy.position.set(x-.12*(1-t),y+.05*(1-t),z+.47*(1-t));dummy.updateMatrix();oxygen.setMatrixAt(i,dummy.matrix);
      dummy.position.set(x+.065+.12*t,y+.09,z+.47*t);dummy.updateMatrix();carbon.setMatrixAt(i,dummy.matrix);
    }
    oxygen.instanceMatrix.needsUpdate=carbon.instanceMatrix.needsUpdate=true;
  }
  function sync() {
    if(!ready)return;const small=options.mode==='alveoli',inside=options.mode==='airways';
    macro.visible=!small;micro.visible=small;airways.visible=inside;
    surface.children.forEach(mesh=>{(mesh as THREE.Mesh).material=inside?ghost:pleura;});
    const c=lungCycle(phase);inflation.value=c.inflation;
    breathing.scale.set(1+c.inflation*.065,1+c.inflation*.072,1+c.inflation*.09);breathing.position.y=-.82*c.inflation*.072;
    for(const dots of [air,airTop]){const m=dots.material as THREE.ShaderMaterial;m.uniforms.flow.value=c.flow;m.uniforms.travel.value=travel;}
    if(small){if(!microBuilt&&mapsCache){buildMicro(mapsCache);microBuilt=true;}micro.scale.setScalar(1+c.inflation*.022);updateMicro();}
    root.updateMatrixWorld(true);
  }
  function frame() {
    const small=options.mode==='alveoli',aspect=Math.max(.35,o.camera.aspect),height=small?2.8:4.65,width=small?3.55:3.90;
    const distance=Math.max(height,width/aspect)/(2*Math.tan(o.camera.fov*Math.PI/360));
    const look=new THREE.Vector3(0,small?0:.20,0),dir=new THREE.Vector3(small?.85:.15,small?.18:.13,3).normalize();
    o.controls.target.copy(look);o.camera.position.copy(look).addScaledVector(dir,distance);
    o.controls.minDistance=small?2:3.0;o.controls.maxDistance=distance*2.2;o.controls.minPolarAngle=.05;o.controls.maxPolarAngle=Math.PI-.05;
    o.camera.near=.025;o.camera.far=100;o.camera.updateProjectionMatrix();o.camera.lookAt(look);o.camera.updateMatrixWorld(true);o.wake();
  }
  const projected=new THREE.Vector3();
  function positionLabels() {
    labelLayer.hidden=!interactive||!options.labels;if(labelLayer.hidden)return;
    const c=lungCycle(phase);breathHud.hidden=options.mode==='alveoli';
    breathHud.textContent=c.inhaling?'Breathe in · more room':'Breathe out · less room';
    breathHud.className=`lung-breath-hud ${c.inhaling?'':'is-exhaling'}`;
    for(const item of labels){projected.copy(item.p);if(!item.micro&&item.p.y< -1.5)projected.y-=inflation.value*.28;projected.project(o.camera);
      const visible=item.micro===(options.mode==='alveoli')&&projected.z>-1&&projected.z<1&&Math.abs(projected.x)<.94&&Math.abs(projected.y)<.95;
      item.el.hidden=!visible;if(visible){item.el.style.left=`${(projected.x*.5+.5)*100}%`;item.el.style.top=`${(-projected.y*.5+.5)*100}%`;}
    }
  }
  function release() {
    root.traverse(n=>{if(n instanceof THREE.InstancedMesh)n.dispose();});
    surface.clear();airways.clear();breathing.clear();macro.clear();micro.clear();breathing.add(surface,airways);macro.add(breathing);
    geometries.forEach(g=>g.dispose());geometries.clear();materials.forEach(m=>m.dispose());materials.clear();
    textures.forEach(t=>{t.dispose();(t.image as ImageBitmap)?.close?.();});textures.clear();
    labels.length=bloodRoutes.length=0;labelLayer.replaceChildren();labelLayer.hidden=true;ready=false;running=false;microBuilt=false;mapsCache=undefined;
  }
  async function load(width:number) {
    if(ready||disposed)return;if(promise)return promise;
    const task=(async()=>{
      mobile=width<768;options=defaultLungOptions();options.playing=!o.reduced;phase=options.phase;bloodTime=travel=0;
      if(!blobCache){const results=await Promise.allSettled(['pleura-photoreal.webp','pleura-normal.webp','pleura-roughness.webp'].map(async name=>{
        const response=await fetch(`/models/lung-detail/${name}?v=lung-1`,{signal:abort.signal});if(!response.ok)throw new Error('Lung texture unavailable');return response.blob();
      }));const failure=results.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason;blobCache=results.map(r=>(r as PromiseFulfilledResult<Blob>).value);}
      const decoded=await Promise.allSettled(blobCache.map(async(blob,i)=>{
        const bitmap=await createImageBitmap(blob,{resizeWidth:mobile?1024:undefined,imageOrientation:'none',premultiplyAlpha:'none'});
        if(disposed||o.signal.aborted){bitmap.close();throw new Error('Disposed');}
        const texture=new THREE.Texture(bitmap);texture.colorSpace=i===0?THREE.SRGBColorSpace:THREE.NoColorSpace;
        texture.wrapS=i===0?THREE.MirroredRepeatWrapping:THREE.RepeatWrapping;
        if(i===0)texture.repeat.set(2,1);
        texture.anisotropy=Math.min(mobile?4:8,o.renderer.capabilities.getMaxAnisotropy());texture.needsUpdate=true;textures.add(texture);return texture;
      }));const failure=decoded.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
      const [color,normal,roughness]=decoded.map(r=>(r as PromiseFulfilledResult<THREE.Texture>).value),maps={color,normal,roughness};
      mapsCache=maps;buildMacro(maps);ready=true;sync();
    })();promise=task;
    try{await task;}catch(error){release();throw error;}finally{if(promise===task)promise=undefined;}
  }
  return {scene,root,load,frame,get ready(){return ready;},get options(){return {...options};},
    get snapshot(){return {...lungCycle(phase),running,mode:options.mode};},
    setOptions(value:Partial<LungViewOptions>){const old=options.mode;options=normalizeLungOptions({...options,...value});
      if(value.phase!==undefined){phase=options.phase;travel=lungCycle(phase).inflation*1.9;}
      sync();if(old!==options.mode)frame();o.wake();},
    setInteractive(value:boolean){interactive=value;labelLayer.hidden=!value||!options.labels;},
    update(dt:number,animated:boolean){if(!ready)return false;running=animated&&options.playing&&!o.reduced;
      if(running){const delta=Math.min(.1,Math.max(0,dt))*options.speed;phase=(phase+delta/5)%1;bloodTime+=delta;travel+=lungCycle(phase).flow*delta*1.7;sync();}
      positionLabels();return running;},
    unload(){interactive=false;if(ready&&!disposed)release();},
    dispose(){if(disposed)return;disposed=true;abort.abort();o.signal.removeEventListener('abort',abortParent);blobCache=undefined;release();labelLayer.remove();},
  };
}
export type LungDetail=ReturnType<typeof createLungDetail>;
