import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cardiacCycle, HEART_DEFORMATION } from './heart-cycle';

export type HeartAnatomy = {
  vessels: Record<string, { points: number[][]; radius: number[]; kind: string }>;
  chambers: Record<string, { center: number[]; scale: number[]; side: number }>;
  valves: Record<string, { center: number[]; radius: number; leaflets: number; gate: 'av' | 'out'; side: number }>;
};
type Uniforms = { heartContraction: { value: number }; heartInterior: { value: number } };
export type FlowRoute = {
  positions: Float32Array; tangents: Float32Array; normals: Float32Array; binormals: Float32Array;
  widths: Float32Array; distances: Float32Array; length: number; av: number; out: number; side: number;
};
const SAMPLES = 384;
const point = new THREE.Vector3(), tangent = new THREE.Vector3(), normal = new THREE.Vector3(), binormal = new THREE.Vector3();

/** Cubic centerlines share the authored lumens. Valves are actual barriers. */
export function createFlowRoutes(anatomy: HeartAnatomy): FlowRoute[] {
  const right = [
    [-.46,.83,-.07],[-.49,.60,-.02],[-.43,.31,.015],[-.32,.125,.125],
    [-.29,-.065,.20],[-.32,-.30,.20],[-.19,-.43,.18],[-.08,-.23,.20],
    [-.14,.13,.21],[-.065,.33,.261],[.06,.56,.255],[.18,.68,.13],[.36,.68,.01],[.54,.64,-.13],[.65,.59,-.19],
  ];
  const left = [
    [.63,.465,-.43],[.54,.47,-.34],[.37,.44,-.24],[.23,.34,-.20],[.225,.135,-.10],
    [.14,-.12,-.005],[.16,-.43,.01],[.28,-.60,-.005],[.34,-.40,-.07],[.22,-.18,-.11],
    [-.055,.28,-.025],[-.06,.355,-.01],[-.12,.55,.045],[-.10,.82,.015],[.12,.99,-.10],[.37,.87,-.255],[.40,.57,-.29],[.38,.38,-.29],
  ];
  const rightLow = [[-.47,-.14,-.22],[-.48,.05,-.12],[-.43,.29,.015],...right.slice(3,11),[.18,.68,.11],[.08,.69,-.14],[-.22,.61,-.23],[-.48,.56,-.24]];
  const leftLow = [[-.19,.305,-.43],[-.10,.315,-.34],[0,.28,-.20],[.23,.34,-.20],...left.slice(4)];
  return [right,left,rightLow,leftLow].map((points,index) => {
    const side=index%2;
    const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3().fromArray(p)),false,'catmullrom',.35);
    const frames=curve.computeFrenetFrames(SAMPLES-1,false);
    const positions=new Float32Array(SAMPLES*3),tangents=new Float32Array(SAMPLES*3),normals=new Float32Array(SAMPLES*3),binormals=new Float32Array(SAMPLES*3);
    const widths=new Float32Array(SAMPLES),distances=new Float32Array(SAMPLES);
    const avPoint=new THREE.Vector3().fromArray(anatomy.valves[side?'mitral':'tricuspid'].center);
    const outPoint=new THREE.Vector3().fromArray(anatomy.valves[side?'aortic':'pulmonary'].center);
    let avIndex=0,outIndex=0,avDistance=Infinity,outDistance=Infinity;
    const previous=new THREE.Vector3();
    for(let i=0;i<SAMPLES;i++) {
      curve.getPoint(i/(SAMPLES-1),point);point.toArray(positions,i*3);
      if(i)distances[i]=distances[i-1]+point.distanceTo(previous);
      previous.copy(point);frames.tangents[i].toArray(tangents,i*3);frames.normals[i].toArray(normals,i*3);frames.binormals[i].toArray(binormals,i*3);
      const av=point.distanceToSquared(avPoint),out=point.distanceToSquared(outPoint);
      if(av<avDistance){avDistance=av;avIndex=i;}if(out<outDistance){outDistance=out;outIndex=i;}
      // Vessel wall boundary is more restrictive than the cellular display radius.
      widths[i]=i/(SAMPLES-1)<.2 ? .027 : .041;
    }
    for(let i=0;i<SAMPLES;i++) {
      if(i>avIndex+12&&i<outIndex-14) widths[i]=.060;
      const gateDistance=Math.min(Math.abs(distances[i]-distances[avIndex]),Math.abs(distances[i]-distances[outIndex]));
      widths[i]*=THREE.MathUtils.lerp(.50,1,THREE.MathUtils.smoothstep(gateDistance,.01,.12));
    }
    return {positions,tangents,normals,binormals,widths,distances,length:distances[SAMPLES-1],av:distances[avIndex],out:distances[outIndex],side};
  });
}

export function advanceBlood(distance: number, dt: number, route: Pick<FlowRoute,'av'|'out'|'length'>, phase: ReturnType<typeof cardiacCycle>, radial: number) {
  const inVentricle=distance>=route.av&&distance<route.out;
  // Blunted laminar profile in great vessels; filling jets roll into the chamber.
  const profile=1.35-.60*radial*radial;
  const velocity=distance>=route.out ? .30+1.55*phase.outflow : inVentricle ? .20+1.35*phase.outflow+.45*phase.filling : .24+.58*phase.filling;
  let next=distance+dt*velocity*profile;
  if(distance<route.av && next>=route.av && phase.av<.2)next=route.av-.00001;
  if(distance<route.out && next>=route.out && phase.outflow<.2)next=route.out-.00001;
  return next>=route.length ? next-route.length : next;
}

function lumenMaterial(color: number, uniforms: Uniforms, clock: {value:number}, ejection: {value:number}) {
  const material=new THREE.MeshPhysicalMaterial({color,roughness:.34,clearcoat:.28,clearcoatRoughness:.22,metalness:0,transparent:true,opacity:.46,depthWrite:false,side:THREE.BackSide});
  material.onBeforeCompile=shader=> {
    Object.assign(shader.uniforms,uniforms);
    shader.uniforms.bloodTime=clock;shader.uniforms.bloodEjection=ejection;
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\n${HEART_DEFORMATION}\nvarying vec3 vBloodRest;`)
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvBloodRest=transformed;transformed=heartDeform(transformed);')
      .replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nobjectNormal=heartNormal(position,objectNormal);');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec3 vBloodRest;uniform float bloodTime;uniform float bloodEjection;
      float bloodField(vec3 p) {
        return sin(p.x*1.27+sin(p.y*.91))*sin(p.y*1.13+sin(p.z*.87))*sin(p.z*1.21+sin(p.x*.73));
      }
    `).replace('#include <color_fragment>',`#include <color_fragment>
      // Advected density striations make bulk flow legible without enlarged
      // cells. Rotation represents chamber recirculation; the axial term
      // strengthens during the same ejection window used by the valve gates.
      vec3 q=vBloodRest;
      float swirl=bloodTime*.65+q.y*5.0;
      q.xz=mat2(cos(swirl),-sin(swirl),sin(swirl),cos(swirl))*q.xz;
      q.y-=bloodTime*.24+bloodEjection*.13;
      float density=.5+.32*bloodField(q*24.0)+.18*bloodField(q*53.0);
      diffuseColor.rgb*=mix(.48,1.65,density);
      diffuseColor.a*=.72+.28*density;
    `);
  };
  material.customProgramCacheKey=()=> 'heart-fluid-lumen-v2';return material;
}

export function createHeartFlow(anatomy: HeartAnatomy, mobile: boolean, uniforms: Uniforms) {
  const root=new THREE.Group();root.name='Blood_circulation';root.visible=false;
  const clock={value:0},ejection={value:0};
  const routes=createFlowRoutes(anatomy);
  const geometries: THREE.BufferGeometry[]=[];const materials: THREE.Material[]=[];
  const fluidPieces: THREE.BufferGeometry[][]=[[],[]];
  for(const chamber of Object.values(anatomy.chambers)) {
    const g=new THREE.SphereGeometry(1,32,24);g.scale(...chamber.scale as [number,number,number]);g.translate(...chamber.center as [number,number,number]);fluidPieces[chamber.side].push(g);
  }
  // The AV inflows and LV outflow are continuous lumens, not disconnected
  // chamber ellipsoids. Their centers coincide with the moving valve annuli.
  for(const [side,points,radius] of [
    [0,[anatomy.chambers.right_atrium.center,anatomy.valves.tricuspid.center,[-.25,-.10,.18]],.083],
    [1,[anatomy.chambers.left_atrium.center,anatomy.valves.mitral.center,[.20,-.10,-.02]],.079],
    [1,[[.22,-.18,-.11],[.07,.05,-.07],[-.055,.28,-.025],anatomy.valves.aortic.center],.068],
  ] as [number,number[][],number][]) {
    const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3().fromArray(p)));
    fluidPieces[side].push(new THREE.TubeGeometry(curve,32,radius,16,false));
  }
  for(const [name,vessel] of Object.entries(anatomy.vessels)) {
    const curve=new THREE.CatmullRomCurve3(vessel.points.map(p=>new THREE.Vector3().fromArray(p)),false,'catmullrom',.5);
    // Radius follows the authored taper, including the aortic arch.
    const g=new THREE.TubeGeometry(curve,64,1,16,false),frames=curve.computeFrenetFrames(64,false),pos=g.attributes.position;
    for(let i=0;i<=64;i++) {
      curve.getPointAt(i/64,point);const f=i/64*(vessel.radius.length-1),j=Math.min(Math.floor(f),vessel.radius.length-2);
      const r=THREE.MathUtils.lerp(vessel.radius[j],vessel.radius[j+1],f-j)*.73;
      for(let k=0;k<=16;k++) {
        const a=k/16*Math.PI*2;
        tangent.copy(point).addScaledVector(frames.normals[i],-Math.cos(a)*r).addScaledVector(frames.binormals[i],Math.sin(a)*r);
        pos.setXYZ(i*17+k,tangent.x,tangent.y,tangent.z);
      }
    }
    g.computeVertexNormals();fluidPieces[name.startsWith('pulmonary_vein')||vessel.kind==='aorta'?1:0].push(g);
  }
  for(let side=0;side<2;side++) {
    const geometry=mergeGeometries(fluidPieces[side])!;fluidPieces[side].forEach(g=>g.dispose());geometries.push(geometry);
    const material=lumenMaterial(side?0xad2115:0x780e27,uniforms,clock,ejection);materials.push(material);
    const mesh=new THREE.Mesh(geometry,material);mesh.renderOrder=1;root.add(mesh);
  }

  const cellCount=mobile?240:560,flowCount=mobile?900:1800,total=cellCount+flowCount;
  const cellGeometry=new THREE.SphereGeometry(1,14,10);
  const positions=cellGeometry.attributes.position;
  for(let i=0;i<positions.count;i++) {
    const x=positions.getX(i),z=positions.getZ(i),r2=Math.min(1,x*x+z*z);
    positions.setY(i,Math.sign(positions.getY(i))*.5*Math.sqrt(1-r2)*(.207+2.003*r2-1.123*r2*r2));
  }
  cellGeometry.computeVertexNormals();geometries.push(cellGeometry);
  const cellMaterial=new THREE.MeshPhysicalMaterial({color:0xffffff,roughness:.31,clearcoat:.7,clearcoatRoughness:.18,metalness:0});
  cellMaterial.onBeforeCompile=shader=> {
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\n${HEART_DEFORMATION}`)
      .replace('#include <project_vertex>', THREE.ShaderChunk.project_vertex.replace('mvPosition = instanceMatrix * mvPosition;','mvPosition = instanceMatrix * mvPosition;\nmvPosition.xyz=heartDeform(mvPosition.xyz);'));
  };
  cellMaterial.customProgramCacheKey=()=> 'heart-biconcave-cells-v1';materials.push(cellMaterial);
  const cells=new THREE.InstancedMesh(cellGeometry,cellMaterial,cellCount);cells.name='Enlarged_erythrocytes';cells.frustumCulled=false;cells.visible=false;cells.renderOrder=2;
  cells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);root.add(cells);
  const flowPositions=new Float32Array(flowCount*3),flowColors=new Float32Array(flowCount*3);
  const flowGeometry=new THREE.BufferGeometry();flowGeometry.setAttribute('position',new THREE.BufferAttribute(flowPositions,3).setUsage(THREE.DynamicDrawUsage));flowGeometry.setAttribute('color',new THREE.BufferAttribute(flowColors,3));geometries.push(flowGeometry);
  const flowMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,vertexColors:true,uniforms:{...uniforms,pixelScale:{value:mobile?430:700}},
    vertexShader:`${HEART_DEFORMATION}\nuniform float pixelScale; varying vec3 vColor;
      void main(){vColor=color;vec4 p=modelViewMatrix*vec4(heartDeform(position),1.0);gl_Position=projectionMatrix*p;gl_PointSize=clamp(pixelScale*.020/-p.z,1.0,7.0);}`,
    fragmentShader:`varying vec3 vColor;void main(){float r=length(gl_PointCoord-.5)*2.0;float a=exp(-r*r*3.5)*.42;if(r>1.0)discard;gl_FragColor=vec4(vColor,a);#include <tonemapping_fragment>\n#include <colorspace_fragment>}`.replace(';#include',';\n#include'),
  });materials.push(flowMaterial);
  const stream=new THREE.Points(flowGeometry,flowMaterial);stream.name='Advected_blood_flow';stream.frustumCulled=false;stream.renderOrder=2;root.add(stream);
  const distances=new Float32Array(total),radii=new Float32Array(total),angles=new Float32Array(total);
  const color=new THREE.Color(),dummy=new THREE.Object3D(),rotation=new THREE.Quaternion(),spin=new THREE.Quaternion();
  const axis=new THREE.Vector3(0,1,0);
  for(let i=0;i<total;i++) {
    const route=routes[i%routes.length];distances[i]=((i*.61803398875)%1)*route.length;
    radii[i]=Math.sqrt((i*.75487766+.1)%1)*.84;angles[i]=i*2.399963;
    color.set(route.side?0xba2114:0x6e1224);
    if(i<cellCount)cells.setColorAt(i,color);else {color.set(route.side?0xdb7060:0x9f5368);color.toArray(flowColors,(i-cellCount)*3);}
  }
  let time=0;
  function update(dt: number, animated: boolean, seconds = time + (animated ? dt : 0)) {
    time=seconds;
    const phase=cardiacCycle(time);
    clock.value=time;ejection.value=phase.outflow;
    for(let i=0;i<total;i++) {
      const route=routes[i%routes.length];
      if(animated)distances[i]=advanceBlood(distances[i],dt,route,phase,radii[i]);
      const distance=distances[i];
      // Bounded binary search replaces per-particle curve allocation/evaluation.
      let lo=0,hi=SAMPLES-1;
      while(hi-lo>1){const mid=(lo+hi)>>1;if(route.distances[mid]>distance)hi=mid;else lo=mid;}
      const f=(distance-route.distances[lo])/Math.max(1e-6,route.distances[hi]-route.distances[lo]);
      point.fromArray(route.positions,lo*3).lerp(tangent.fromArray(route.positions,hi*3),f);
      tangent.fromArray(route.tangents,lo*3);normal.fromArray(route.normals,lo*3);binormal.fromArray(route.binormals,lo*3);
      const chamber=distance>route.av+.06&&distance<route.out-.09;
      const angle=angles[i]+(chamber?distance*8+time*.65:distance*1.1);
      const radius=radii[i]*THREE.MathUtils.lerp(route.widths[lo],route.widths[hi],f);
      point.addScaledVector(normal,Math.cos(angle)*radius).addScaledVector(binormal,Math.sin(angle)*radius);
      if(i<cellCount) {
        dummy.position.copy(point);rotation.setFromUnitVectors(axis,tangent);
        spin.setFromAxisAngle(axis,angles[i]+time*.7);dummy.quaternion.copy(rotation).multiply(spin);
        const fade=THREE.MathUtils.smoothstep(distance,0,.04)*(1-THREE.MathUtils.smoothstep(distance,route.length-.04,route.length));
        dummy.scale.setScalar(.0125*(.82+.32*((i*.37)%1))*fade);dummy.updateMatrix();cells.setMatrixAt(i,dummy.matrix);
      } else point.toArray(flowPositions,(i-cellCount)*3);
    }
    cells.instanceMatrix.needsUpdate=true;flowGeometry.attributes.position.needsUpdate=true;
    return root.visible&&animated;
  }
  update(0,false);
  return {root,routes,update,
    setVisible(visible: boolean,showCells: boolean){root.visible=visible;cells.visible=showCells;},
    dispose(){root.removeFromParent();cells.dispose();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());},
  };
}
