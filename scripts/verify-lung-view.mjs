import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,stat} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import * as THREE from 'three';
import {Document,NodeIO} from '@gltf-transform/core';
import {moduleURLFor} from './load-typescript.mjs';
const {createAnatomyExplorer}=await import(await moduleURLFor('lib/totoro-anatomy.ts'));
const {lungCycle}=await import(await moduleURLFor('lib/lung-physiology.ts'));
let assertions=0;const check=(v,label)=>{assert.ok(v,label);assertions++;};
for(let p=0;p<1;p+=.005){const c=lungCycle(p);check(c.inflation>=0&&c.inflation<=1,'Expansion remains bounded');
  const derivative=(lungCycle(p+.00001).inflation-lungCycle(p-.00001).inflation)/.00002;
  if(Math.abs(c.flow)>.001)check(Math.sign(derivative)===Math.sign(c.flow),'Airflow follows the change of lung volume in both directions');}
check(lungCycle(.4).inflation===1&&Math.abs(lungCycle(.4).flow)<1e-8,'No flow at maximum inspiration');
check(lungCycle(0).inflation===0&&lungCycle(0).flow===0,'Rest has zero tidal expansion and zero flow');
check(lungCycle(.4).diaphragmDrop>lungCycle(0).diaphragmDrop,'Diaphragm descends during inspiration');
check(Number.isFinite(lungCycle(NaN).inflation),'Invalid cycle input remains finite');
class Element extends EventTarget {
  classList={add(){},remove(){},toggle(){}};children=[];style={setProperty(){}};clientWidth=1200;clientHeight=850;
  appendChild(c){this.children.push(c);c.parentElement=this;return c;}setAttribute(){}setPointerCapture(){}
  replaceChildren(...nodes){this.children=nodes;}remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(c=>c!==this);}
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
check(!fetched.some(p=>p.includes('lung-detail')),'Lung assets are lazy until the study is opened');
const saved={position:f.camera.position.clone(),target:f.controls.target.clone(),cut:{...f.api.state.cut},systems:[...f.api.state.visibleSystems]};
await f.api.openLungView('shortcut');
check(f.api.state.lungView.status==='open'&&!['brain','heart','eye'].some(k=>f.api.state[k+'View'].status==='open'),'Lungs open as the only isolated study');
const lungs=f.api.detailScene;
const lobes=lungs.getObjectByName('Five_lung_lobes');check(lobes.children.length===5,'Three right and two left lobes are present');
check(lungs.getObjectByName('Main_bronchi').parent.visible,'Main bronchi remain attached to the trachea in whole-lung view');
check(!lungs.getObjectByName('Moving_red_blood_cells'),'Microscopic geometry is deferred until requested');
function stats(){let triangles=0,calls=0;lungs.traverseVisible(n=>{if(n.isMesh){calls++;triangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3*(n.isInstancedMesh?n.count:1);}else if(n.isLine||n.isPoints)calls++;});return {triangles,calls};}
const surface=stats();check(surface.triangles<70000&&surface.calls<15,'Surface fits its geometry and draw-call budgets');
f.api.setLungViewOptions({playing:false,phase:0});const rest=lungs.getObjectByName('Breathing_lung_tissue').scale.clone();
f.api.setLungViewOptions({phase:.4});check(lungs.getObjectByName('Breathing_lung_tissue').scale.y>rest.y,'Scrubbing inspiration expands actual lung geometry');
const diaphragm=lungs.getObjectByName('Diaphragm'),shader={uniforms:{},vertexShader:THREE.ShaderLib.physical.vertexShader,fragmentShader:THREE.ShaderLib.physical.fragmentShader};
diaphragm.material.onBeforeCompile(shader);check(shader.uniforms.inflation.value===1,'Diaphragm deformation shares the actual breath phase');
f.api.setLungViewOptions({mode:'airways',phase:.2,playing:true});const air=lungs.getObjectByName('Air_in_branching_airways');
check(air.material.uniforms.flow.value>0,'Inspiration draws air down into the airway tree');
f.api.setLungViewOptions({phase:.7});check(air.material.uniforms.flow.value<0,'Expiration visibly reverses airway flow');
const airways=stats();check(airways.triangles<200000&&airways.calls<20,'Airway detail stays within its geometry and draw-call budgets');
f.api.update(.016,true);const movingPhase=f.api.getLungSnapshot().phase;check(f.api.update(.016,false)===false&&f.api.getLungSnapshot().phase===movingPhase,'Global pause freezes the breath and permits idle rendering');
f.api.setLungViewOptions({playing:false});check(f.api.update(.016,true)===false,'Local pause permits idle rendering');
f.api.setLungViewOptions({mode:'alveoli',playing:true});const blood=lungs.getObjectByName('Moving_red_blood_cells');
check(blood?.isInstancedMesh,'Blood cells use instanced geometry');const before=blood.instanceMatrix.array.slice();
f.api.update(.1,true);check(!before.every((v,i)=>v===blood.instanceMatrix.array[i]),'Blood cells visibly move through the capillary network');
const micro=stats();check(micro.triangles<65000&&micro.calls<15,'Alveolar close-up stays within its geometry and draw-call budgets');
const timings=[];for(let i=0;i<180;i++){const start=performance.now();f.api.update(1/60,true);timings.push(performance.now()-start);}timings.sort((a,b)=>a-b);
let geometryDisposals=0,instanceDisposals=0;lobes.children[0].geometry.addEventListener('dispose',()=>geometryDisposals++);blood.addEventListener('dispose',()=>instanceDisposals++);
await f.api.openEyeView('shortcut');check(f.api.state.eyeView.status==='open'&&f.api.state.lungView.status==='closed','Direct lungs-to-eye switching succeeds');
check(geometryDisposals===1&&instanceDisposals===1,'Switch releases lung geometry and instance buffers');
f.api.closeEyeView();check(f.camera.position.equals(saved.position)&&f.controls.target.equals(saved.target),'Back restores the original anatomy camera after switching');
check(JSON.stringify(f.api.state.cut)===JSON.stringify(saved.cut)&&JSON.stringify(f.api.state.visibleSystems)===JSON.stringify(saved.systems),'Study preserves anatomy cuts and system filters');
const beforeFetch=fetched.length;await f.api.openLungView('shortcut');check(fetched.length===beforeFetch,'Reopening uses compressed texture cache');
await f.api.openHeartView('shortcut');check(f.api.state.heartView.status==='open','Lungs can switch directly to the heart');
await f.api.openBrainView('shortcut');check(f.api.state.brainView.status==='open','Brain remains available through the shared selector');f.api.dispose();
for(const action of ['cancel','reset','dispose']){const f=fixture();await f.api.setMode('split');delay=new Promise(r=>resolveDelay=r);
 const opening=f.api.openLungView('shortcut');await new Promise(r=>setTimeout(r,5));if(action==='cancel')f.api.closeLungView();else f.api[action]();resolveDelay();delay=undefined;await opening;
 check(f.api.state.lungView.status!=='open','Pending lung load cannot reopen after '+action);f.api.dispose();}
const broken=fixture();await broken.api.setMode('split');fail=true;await broken.api.openLungView('shortcut');check(broken.api.state.lungView.status==='error','Network failure exposes retry');
fail=false;decodeFailure=true;await broken.api.openLungView('shortcut');check(broken.api.state.lungView.status==='error','Decode failure exposes retry');
await broken.api.openLungView('shortcut');check(broken.api.state.lungView.status==='open','Retry recovers after partial decoding');broken.api.dispose();
reduced=true;const small=fixture(390);await small.api.setMode('split');await small.api.openLungView('shortcut');small.api.setLungViewOptions({mode:'alveoli'});
check(small.api.detailScene.getObjectByName('Moving_red_blood_cells').count===36,'Phones use lower instance counts');
check(small.api.detailScene.getObjectByName('Open_alveolar_air_sac').material.transmission===0,'Phones avoid a transmission framebuffer');
check(small.api.update(.1,true)===false,'Reduced motion stops automatic breathing');small.api.setLungViewOptions({phase:.4});check(small.api.getLungSnapshot().inflation===1,'Manual breathing still works with reduced motion');small.api.dispose();
check(bitmaps===closed,'All decoded images are released after switches, failure, or cancellation');
const files=['pleura-photoreal.webp','pleura-normal.webp','pleura-roughness.webp'];let textureBytes=0;for(const file of files)textureBytes+=(await stat('public/models/lung-detail/'+file)).size;
check(textureBytes<1500000,'The entire lung texture payload stays under 1.5 MB');
const result={passed:true,assertions,scope:'Actual Three.js model, lifecycle and textures with mocked DOM, decode, renderer. CPU timings exclude GPU work.',surface,airways,micro,textureBytes,cpuUpdateMedianMs:timings[90],cpuUpdateP95Ms:timings[171],bitmaps,closed};
await mkdir('artwork/anatomy/lung-detail',{recursive:true});await writeFile('artwork/anatomy/lung-detail/verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
