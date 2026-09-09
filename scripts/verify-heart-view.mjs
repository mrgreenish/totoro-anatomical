import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import * as THREE from 'three';
import {Document,NodeIO} from '@gltf-transform/core';
import {moduleURLFor} from './load-typescript.mjs';

const {createAnatomyExplorer}=await import(await moduleURLFor('lib/totoro-anatomy.ts'));
const {cardiacCycle,HEART_BPM}=await import(await moduleURLFor('lib/heart-cycle.ts'));
const {createFlowRoutes,advanceBlood}=await import(await moduleURLFor('lib/heart-flow.ts'));
const {heartTextureSize}=await import(await moduleURLFor('lib/heart-detail.ts'));
const anatomy=JSON.parse(await readFile('public/models/heart-detail/anatomy.json','utf8'));
let assertions=0;const check=(value,label)=>{assert.ok(value,label);assertions++;};
const routes=createFlowRoutes(anatomy);
check(routes.length===4&&routes.every(r=>r.av>0&&r.out>r.av&&r.out<r.length),'Inlets, AV valves, ventricular chambers, semilunar valves and outlets are ordered');
for(let j=0;j<100;j++) {
  const phase=cardiacCycle(j/100*60/HEART_BPM);
  check(phase.av>=0&&phase.av<=1&&phase.outflow>=0&&phase.outflow<=1,'Valve openings are bounded');
  check(!(phase.av>.2&&phase.outflow>.2),'AV and semilunar valves do not open together');
  for(const r of routes) {
    if(phase.av<.2)check(advanceBlood(r.av-.001,1/60,r,phase,0)<r.av,'Closed AV valve blocks crossing');
    if(phase.outflow<.2)check(advanceBlood(r.out-.001,1/60,r,phase,0)<r.out,'Closed semilunar valve blocks crossing');
  }
}
const first=routes[0];let d=0,exits=0;
for(let i=0;i<7200;i++){const next=advanceBlood(d,1/120,first,cardiacCycle(i/120),.4);check(Number.isFinite(next)&&next>=0&&next<first.length,'Bounded forward transport');if(next<d)exits++;d=next;}
check(exits>2,'Cells pass through the complete circulation repeatedly');
check(heartTextureSize(390,8192)===2048&&heartTextureSize(1200,8192)===4096&&heartTextureSize(1200,2048)===2048,'Responsive geometry and texture tier');

class Element extends EventTarget {
  classList={add(){},remove(){},toggle(){}};children=[];style={setProperty(){}};clientWidth=1200;clientHeight=850;
  appendChild(c){this.children.push(c);c.parentElement=this;return c;}setAttribute(){}setPointerCapture(){}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(c=>c!==this);}
  getBoundingClientRect(){return {left:0,top:0,width:this.clientWidth,height:this.clientHeight};}
}
let reduced=false,bitmaps=0,closed=0,decodeFailure=false;
globalThis.window={matchMedia:()=>({matches:reduced})};
// oxlint-disable-next-line typescript/no-deprecated
globalThis.document={createElement:()=>new Element()};globalThis.self=globalThis;
globalThis.createImageBitmap=async()=>{if(decodeFailure){decodeFailure=false;throw new Error('decode failure');}bitmaps++;return {width:2,height:2,close(){closed++;}};};
const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene();
for(const [id,y] of [['brain',2.5],['heart',1.6]]) {
  const g=new THREE.SphereGeometry(.3,20,16),p=doc.createPrimitive().setMaterial(doc.createMaterial());
  for(const [key,attr] of [['POSITION','position'],['NORMAL','normal']])p.setAttribute(key,doc.createAccessor().setType('VEC3').setArray(g.attributes[attr].array).setBuffer(buffer));
  p.setIndices(doc.createAccessor().setType('SCALAR').setArray(g.index.array).setBuffer(buffer));
  scene.addChild(doc.createNode(id).setMesh(doc.createMesh().addPrimitive(p)).setTranslation([0,y,0]).setExtras({partId:id,label:id,systems:['organs'],explodeOffset:[0,0,.4]}));
}
const bytes=await new NodeIO().writeBinary(doc);
const fetched=[];let fail=false,delay,resolveDelay;
globalThis.fetch=async url=>{fetched.push(url);if(url.includes('totoro-anatomy'))return new Response(bytes);if(delay)await delay;if(fail)return new Response('',{status:503});return new Response(await readFile('public'+url.split('?')[0]));};
function fixture(width=1200){
  const canvas=new Element();canvas.clientWidth=width;new Element().appendChild(canvas);
  const camera=new THREE.PerspectiveCamera(30,width/850,.1,100);camera.position.set(3,4,12);
  const controls={target:new THREE.Vector3(0,2.3,0),enabled:true,enableDamping:true,autoRotate:false,update(){}};
  const renderer={capabilities:{getMaxAnisotropy:()=>8,maxTextureSize:8192},async compileAsync(){}};
  const scene=new THREE.Scene(),exterior=new THREE.Group(),abort=new AbortController();scene.add(exterior);
  const api=createAnatomyExplorer({canvas,camera,controls,renderer,scene,exterior,signal:abort.signal,wake(){}});
  return {api,canvas,camera,controls,abort};
}
const f=fixture();await f.api.setMode('split');f.api.setVisibleSystems(['bones']);f.api.update(1);
check(!fetched.some(p=>p.includes('heart-detail')),'No heart detail is loaded by the initial anatomy view');
await f.api.openHeartView();check(!f.api.detailScene,'Contextual entry remains gated');
const saved={position:f.camera.position.clone(),target:f.controls.target.clone(),cut:{...f.api.state.cut},systems:[...f.api.state.visibleSystems],mode:f.api.state.mode};
await f.api.openHeartView('shortcut');
check(f.api.state.heartView.status==='open'&&f.api.state.brainView.status==='closed','Shortcut opens the isolated heart through hidden anatomy');
const all=[];f.api.detailScene.traverse(n=>{if(n.isMesh)all.push(n);});
const wall=all.find(n=>n.material.name==='Heart_myocardium');
const valves=all.filter(n=>n.userData.valve);
check(wall&&valves.length===11,'Actual optimized GLB retains tissue and all valve leaflets');
const aorta=all.find(n=>n.material.name==='Heart_aorta');
const aortaPositions=aorta.geometry.attributes.position;
check(aortaPositions.array instanceof Float32Array&&!aortaPositions.normalized,'Quantized attributes are promoted before world transforms');
check(aorta.geometry.boundingBox.min.y>.2&&aorta.geometry.boundingBox.max.y>1.20,'Aortic arch and branches keep their height without integer wraparound');
check(valves.every(n=>!n.visible),'Internal anatomy is hidden in opaque study');
const blood=f.api.detailScene.getObjectByName('Blood_circulation');
check(!blood.visible,'Blood rendering is off until translucency is requested');
f.api.setHeartViewOptions({translucent:true,blood:true,cells:true});
check(blood.visible&&valves.every(n=>n.visible)&&wall.material.opacity<.25&&!wall.material.depthWrite,'Translucency exposes the inner anatomy and blood');
const cells=f.api.detailScene.getObjectByName('Enlarged_erythrocytes');check(cells.visible&&cells.count===560,'Cells are one bounded instanced draw');
const frame=cells.instanceMatrix.array.slice();f.api.update(.05,true);
check(!cells.instanceMatrix.array.every((x,i)=>x===frame[i]),'Playing advects the cells');
const paused=cells.instanceMatrix.array.slice();f.api.update(.05,false);
check(cells.instanceMatrix.array.every((x,i)=>x===paused[i]),'Pause freezes fluid positions and cell orientation');
const timings=[];for(let i=0;i<240;i++){const before=performance.now();f.api.update(1/60,true);timings.push(performance.now()-before);}
timings.sort((a,b)=>a-b);
for(const mesh of all.filter(n=>n.material.name.startsWith('Heart_')&&!n.isInstancedMesh)) {
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.physical.vertexShader,fragmentShader:THREE.ShaderLib.physical.fragmentShader};
  mesh.material.onBeforeCompile(shader);
  check(shader.vertexShader.includes('heartDeform'),'Tissue follows the shared deformation field');
  check(shader.fragmentShader.includes('RE_Direct_Heart'),'Part material includes thickness-based light transport');
  if(mesh.userData.valve)check(shader.vertexShader.includes('valveCenter'),'Valves use their own anatomical center');
}
f.api.setHeartViewOptions({blood:false});check(!blood.visible,'Blood toggle stops its rendering');
f.api.closeHeartView();check(!f.api.detailScene&&f.api.state.heartView.status==='closed','Back closes and releases the scene');
check(f.camera.position.equals(saved.position)&&f.controls.target.equals(saved.target),'Back restores camera and orbit target exactly');
check(JSON.stringify(f.api.state.cut)===JSON.stringify(saved.cut)&&JSON.stringify(f.api.state.visibleSystems)===JSON.stringify(saved.systems)&&f.api.state.mode===saved.mode,'Back preserves anatomy settings');
const before=fetched.length;await f.api.openHeartView('shortcut');check(fetched.length===before,'Compressed assets are reused on reopen');f.api.closeHeartView();
await f.api.openBrainView('shortcut');check(f.api.state.brainView.status==='open'&&f.api.state.heartView.status==='closed','Brain continues working after heart');f.api.closeBrainView();f.api.dispose();
for(const action of ['reset','filters','mode','variant','dispose']) {
  const f=fixture();await f.api.setMode('split');delay=new Promise(r=>resolveDelay=r);const loading=f.api.openHeartView('shortcut');await Promise.resolve();
  if(action==='reset')f.api.reset();if(action==='filters')f.api.setVisibleSystems(['bones']);if(action==='mode')await f.api.setMode('exterior');if(action==='variant')f.api.setAnatomyVariant('female');if(action==='dispose')f.api.dispose();
  resolveDelay();delay=undefined;await loading;check(f.api.state.heartView.status!=='open'&&!f.api.detailScene,`${action} cancels a stale heart load`);f.api.dispose();
}
const failure=fixture();await failure.api.setMode('split');fail=true;await failure.api.openHeartView('shortcut');check(failure.api.state.heartView.status==='error','Failure is retryable');fail=false;decodeFailure=true;await failure.api.openHeartView('shortcut');check(failure.api.state.heartView.status==='error','Partial image failure cleans up');await failure.api.openHeartView('shortcut');check(failure.api.state.heartView.status==='open','Retry succeeds');failure.api.dispose();
reduced=true;const mobile=fixture(390);await mobile.api.setMode('exploded');mobile.api.selectPart('heart');mobile.api.update(1);check(mobile.api.state.heartView.available,'An exposed selected heart enables contextual entry');await mobile.api.openHeartView();
mobile.api.setHeartViewOptions({translucent:true,blood:true,cells:true});
const small=mobile.api.detailScene.getObjectByName('Enlarged_erythrocytes');check(small.count===240,'Mobile has a smaller cell budget');
const rest=small.instanceMatrix.array.slice();check(!mobile.api.update(1,true),'Reduced motion lets the renderer sleep');check(rest.every((x,i)=>x===small.instanceMatrix.array[i]),'Reduced motion holds circulation still');mobile.api.dispose();
check(bitmaps===closed,'All decoded images are closed exactly once across loading, cancellation, retries and disposal');
const report={passed:true,assertions,flowCpuMilliseconds:{median:timings[120],p95:timings[228]},coverage:['actual desktop and mobile assets','shared cardiac cycle','one-way valve barriers','bounded continuous transport','part shader hooks','instanced cells','pause and reduced motion','lazy load and cache','failure, retry, partial decode cleanup','stale loading cancellation','camera and settings restoration','brain coexistence','resource disposal'],scope:'Node integration and CPU advection timing; not a clinical flow solver or a GPU frame-rate measurement.'};
await writeFile('artwork/anatomy/heart-detail/runtime-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
