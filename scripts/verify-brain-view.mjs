import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';
import * as THREE from 'three';
import { Document, NodeIO } from '@gltf-transform/core';

const moduleURL=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const stateURL=moduleURL(compile(await readFile('lib/anatomy-state.ts','utf8')));
const touchURL=moduleURL(compile(await readFile('lib/brain-touch.ts','utf8')).replace(/from ['"]([^'"]+)['"]/g,(_,name)=>`from ${JSON.stringify(import.meta.resolve(name))}`));
const activityURL=moduleURL(compile(await readFile('lib/brain-activity.ts','utf8')).replace(/from ['"]([^'"]+)['"]/g,(_,name)=>`from ${JSON.stringify(import.meta.resolve(name))}`));
const detailURL=moduleURL(compile(await readFile('lib/brain-detail.ts','utf8')).replace(/from ['"]([^'"]+)['"]/g,(_,name)=>`from ${JSON.stringify(name==='./brain-touch'?touchURL:name==='./brain-activity'?activityURL:import.meta.resolve(name))}`));
const source=compile(await readFile('lib/totoro-anatomy.ts','utf8')).replace(/from ['"]([^'"]+)['"]/g,(_,name)=>`from ${JSON.stringify(name==='./anatomy-state'?stateURL:name==='./brain-detail'?detailURL:import.meta.resolve(name))}`);
const {createAnatomyExplorer}=await import(moduleURL(source));
const {brainProximity,detailTextureSize,isBrainOccluder}=await import(detailURL);
let count=0;const check=(v,msg)=>{assert.ok(v,msg);count++;};
check(!brainProximity(.299,true,false),'Button hidden below entry threshold');
check(brainProximity(.30,true,false),'Button appears at entry threshold');
check(brainProximity(.25,true,true),'Hysteresis holds button');
check(!brainProximity(.219,true,true),'Button hides below exit threshold');
check(!brainProximity(1,false,true),'Occluded brain never offers entry');
check(detailTextureSize(390,8192)===2048&&detailTextureSize(1280,8192)===4096&&detailTextureSize(1280,2048)===2048,'Responsive texture choice');
check(!isBrainOccluder(Object.assign(new THREE.Mesh(),{name:'Fine_grey_fibers'})),'Fur fibers are not occlusion meshes');
check(!isBrainOccluder(Object.assign(new THREE.Mesh(),{userData:{sectionCap:true}})),'Section caps are not occlusion meshes');
check(isBrainOccluder(new THREE.Mesh()),'Tissue meshes remain occluders');

class Element extends EventTarget {
  classList={add(){},remove(){},toggle(){}};
  children=[];attributes={};style={setProperty(){}};hidden=false;clientWidth=1000;clientHeight=750;
  appendChild(c){this.children.push(c);c.parentElement=this;return c;}
  setAttribute(k,v){this.attributes[k]=v;}
  setPointerCapture(){}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(c=>c!==this);}
  getBoundingClientRect(){return {left:0,top:0,width:this.clientWidth,height:this.clientHeight};}
}
// Browser globals are deliberately replaced with the event fixture in Node.
// oxlint-disable-next-line typescript/no-deprecated
let reduced=true;globalThis.window={matchMedia:()=>({matches:reduced})};globalThis.document={createElement:()=>new Element()};
globalThis.self=globalThis;
let createdBitmaps=0,closedBitmaps=0;
globalThis.createImageBitmap=async()=>{createdBitmaps++;return {width:2,height:2,close(){closedBitmaps++;}};};

const doc=new Document(), buffer=doc.createBuffer(),scene=doc.createScene();
for(const [id,system,geometry,at] of [['brain','organs',new THREE.SphereGeometry(.5,32,24),[0,2.5,0]],['skull','bones',new THREE.SphereGeometry(.58,24,16),[0,2.5,0]],['heart','organs',new THREE.BoxGeometry(.3,.4,.3),[0,1.6,0]]]) {
  const primitive=doc.createPrimitive().setMaterial(doc.createMaterial().setBaseColorFactor([.6,.3,.3,1]));
  for(const [name,attr] of [['POSITION','position'],['NORMAL','normal']]) primitive.setAttribute(name,doc.createAccessor().setType('VEC3').setArray(geometry.attributes[attr].array).setBuffer(buffer));
  primitive.setIndices(doc.createAccessor().setType('SCALAR').setArray(geometry.index.array).setBuffer(buffer));
  const node=doc.createNode(id).setMesh(doc.createMesh().addPrimitive(primitive)).setTranslation(at).setExtras({partId:id,label:id,systems:[system],explodeOffset:[.2,.1,.3]});
  scene.addChild(node);
}
const anatomyBytes=await new NodeIO().writeBinary(doc);
let failDetail=false, delayDetail;
const fetched=[];
globalThis.fetch=async(url)=>{
  fetched.push(url);
  if(url.includes('totoro-anatomy'))return new Response(anatomyBytes);
  if(delayDetail)await delayDetail;
  if(failDetail)return new Response('',{status:503});
  return new Response(await readFile('public'+url.split('?')[0]));
};
function fixture(){
  const canvas=new Element();new Element().appendChild(canvas);
  const camera=new THREE.PerspectiveCamera(30,4/3,.1,100);camera.position.set(3.5,4,12.4);
  const controls={target:new THREE.Vector3(0,2.3,0),enabled:true,enableDamping:true,autoRotate:false,update(){}};
  const renderer={capabilities:{getMaxAnisotropy:()=>8,maxTextureSize:8192}};
  const scene=new THREE.Scene(),exterior=new THREE.Group();scene.add(exterior);
  const events=[],abort=new AbortController();
  const api=createAnatomyExplorer({canvas,camera,controls,renderer,scene,exterior,signal:abort.signal,wake(){},onState:s=>events.push(s)});
  return {canvas,camera,controls,renderer,scene,exterior,api,events,abort};
}
async function focus(f,systems=['organs']) {
  await f.api.setMode('exploded');f.api.setVisibleSystems(systems);f.api.update(1);
  f.api.selectPart('brain');f.api.update(1);
}
const f=fixture();
await focus(f,['organs','bones']);check(!f.api.state.brainView.available,'Skull occludes the close brain');
f.api.setVisibleSystems(['organs']);f.api.update(1);check(f.api.state.brainView.available,'Exposed selected brain offers entry');
check(!fetched.some(url=>String(url).includes('brain-detail')),'Proximity does not decode the isolated brain');
check(!f.api.detailScene&&f.api.state.brainView.status!=='open','Proximity never opens automatically');
f.api.setVisibleSystems(['bones']);f.api.update(1);check(!f.api.state.brainView.available,'Hidden brain removes the button');
await focus(f);
const original={position:f.camera.position.clone(),target:f.controls.target.clone(),near:f.camera.near,fov:f.camera.fov,selected:f.api.state.selectedId,cut:{...f.api.state.cut},explosion:f.api.state.explosion,systems:[...f.api.state.visibleSystems]};
await f.api.openBrainView();
check(f.api.state.brainView.status==='open'&&f.api.detailScene,'Click opens an isolated scene');
check(f.controls.minPolarAngle<.05&&f.controls.maxPolarAngle>3,'Full orbit in the detailed view');
const detailScene=f.api.detailScene;
const tissueMaterials=new Set(),pulseMaterials=[];
detailScene.traverse(node=>{
  if(!node.isMesh)return;
  if(node.material.isShaderMaterial)pulseMaterials.push(node.material);
  else if(node.material.map){check(!!node.geometry.attributes.uv,'Loaded tissue geometry retains UV coordinates');tissueMaterials.add(node.material);}
});
check(tissueMaterials.size>=3,'Independent cortical, cerebellar and stem materials');
for(const material of tissueMaterials){
  check(material.map&&material.normalMap&&material.roughnessMap&&material.aoMap&&material.bumpMap&&material.clearcoatMap,'All surface maps bound');
  check(material.map.colorSpace===THREE.SRGBColorSpace&&material.normalMap.colorSpace===THREE.NoColorSpace,'Color and data maps use correct transfer functions');
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.physical.vertexShader,fragmentShader:THREE.ShaderLib.physical.fragmentShader};material.onBeforeCompile(shader);
  check(shader.fragmentShader.includes('float relief')&&shader.fragmentShader.includes('brainOpticalDepth')&&shader.uniforms.brainHeight,'Physical shader hooks match installed Three chunks');
  check(material.transmission>0&&material.transmission<.03&&material.thicknessMap===material.clearcoatMap&&!material.transparent,'Volume transmission starts nearly opaque, with coordinated thickness and no alpha sorting');
  check(shader.vertexShader.includes('vTissueArea=softTissueArea')&&shader.fragmentShader.includes('material.transmission = transmission + .46 * brainStretch()')&&shader.fragmentShader.includes('material.thickness = thickness / max(1.0,vTissueArea)'),'Surface stretch drives local transmission and thinning');
  check(shader.fragmentShader.includes('#define RE_Direct RE_Direct_Brain')&&shader.fragmentShader.includes('light.color*tissue.diffuseColor*transport'),'Subsurface scattering is attached to actual direct-light transport');
}
const time=pulseMaterials[0].uniforms.brainTime.value;
f.api.update(.5,true);check(pulseMaterials[0].uniforms.brainTime.value===time,'Reduced motion freezes pulses');
const eventCount=f.events.length;f.api.update(.5);check(f.events.length===eventCount,'No per-frame React notifications');
f.camera.position.set(1,1,1);f.api.resize();check(f.camera.position.length()>1.5,'Detail resize keeps the brain framed');
f.api.closeBrainView();
check(!f.api.detailScene&&f.api.state.brainView.status==='closed','Back restores overview rendering');
check(createdBitmaps===closedBitmaps,'Leaving the study releases decoded maps');
check(f.camera.position.equals(original.position)&&f.controls.target.equals(original.target),'Back restores exact camera and target');
check(f.camera.near===original.near&&f.camera.fov===original.fov,'Back restores camera projection');
check(f.api.state.selectedId===original.selected&&f.api.state.explosion===original.explosion&&JSON.stringify(f.api.state.cut)===JSON.stringify(original.cut)&&JSON.stringify(f.api.state.visibleSystems)===JSON.stringify(original.systems),'Back preserves anatomy settings');
f.api.resize();check(f.camera.position.equals(original.position),'Exit layout resize does not overwrite the restored camera');
const requests=fetched.length;await f.api.openBrainView();f.api.closeBrainView();check(fetched.length===requests,'Reopening uses cached assets');
await f.api.setMode('split');f.api.setVisibleSystems(['organs']);f.api.selectPart('brain');f.api.setCut({axis:'x',position:0});f.api.update(1);
check(!f.api.state.brainView.available,'Completely clipped brain cannot open');
f.api.setCut({axis:'x',position:.5});f.api.update(1);check(f.api.state.brainView.available,'Partially clipped brain can open when exposed');
const meshProto=THREE.Mesh.prototype;
// Prototype spies are restored after each assertion.
// oxlint-disable-next-line typescript/unbound-method
const origRaycast=meshProto.raycast;let capRays=0;
meshProto.raycast=function(...args){if(this.userData.sectionCap)capRays++;return origRaycast.apply(this,args);};
f.api.update(1);meshProto.raycast=origRaycast;
check(capRays===0,'Section caps are not raycast during proximity');
await f.api.openBrainView();f.api.reset();f.api.update(1);check(f.api.state.mode==='exterior'&&!f.api.detailScene,'Reset exits detailed view');
f.api.dispose();f.api.dispose();

// Failed load and explicit retry exercise the same production loader.
failDetail=true;const failure=fixture();await focus(failure);await failure.api.openBrainView();
check(failure.api.state.brainView.status==='error'&&failure.api.state.mode==='exploded','Failure leaves anatomy usable');
failDetail=false;await failure.api.openBrainView();check(failure.api.state.brainView.status==='open','Retry recovers');failure.api.dispose();

let resolveDelay;delayDetail=new Promise(r=>{resolveDelay=r;});
const pending=fixture();await focus(pending);const load=pending.api.openBrainView();pending.api.reset();resolveDelay();delayDetail=undefined;await load;
check(pending.api.state.mode==='exterior'&&pending.api.state.brainView.status==='closed'&&!pending.api.detailScene,'Reset cancels stale opening');pending.api.dispose();

reduced=false;const animated=fixture();await focus(animated);
const coat=fixture();
const coatFiber=new THREE.Mesh(new THREE.BoxGeometry(4,4,.3),new THREE.MeshStandardMaterial());
coatFiber.name='Fine_grey_fibers';coatFiber.position.set(0,2.5,4);coat.exterior.add(coatFiber);
await coat.api.setMode('split');coat.api.setVisibleSystems(['organs','skin']);coat.api.selectPart('brain');
let fiberRays=0;meshProto.raycast=function(...args){if(this.name.includes('fibers'))fiberRays++;return origRaycast.apply(this,args);};
coat.api.update(1);meshProto.raycast=origRaycast;
check(fiberRays===0,'Fur fibers are not raycast during proximity');
check(coat.api.state.brainView.available,'Fur in front of the brain does not hide the study');
coat.api.dispose();
for(let i=0;i<90;i++)animated.api.update(.05);
let heartbeatRays=0;meshProto.raycast=function(...args){heartbeatRays++;return origRaycast.apply(this,args);};
for(let i=0;i<90;i++)animated.api.update(.05);
meshProto.raycast=origRaycast;
check(heartbeatRays===0,'A resting camera does not rerun occlusion during heartbeat');
await animated.api.openBrainView();const pulses=[];animated.api.detailScene.traverse(n=>{if(n.isMesh&&n.material.isShaderMaterial)pulses.push(n.material);});
animated.api.update(.5,true);const animatedTime=pulses[0].uniforms.brainTime.value;check(animatedTime>0,'Neural activity advances while playing');
animated.api.update(.5,false);check(pulses[0].uniforms.brainTime.value===animatedTime,'Pause freezes neural activity');animated.api.dispose();
check(createdBitmaps===closedBitmaps,'Decoded images released exactly once');
const report={passed:true,assertions:count,coverage:['proximity hysteresis','occlusion and clipping','selection and filters','explicit opening','camera and settings restoration','responsive framing','texture choices and bindings','shader hooks','cached reopening','failure and retry','stale opening cancellation','pause and reduced motion','resource disposal','no proximity preload','split-view occlusion cost','heartbeat does not retrigger occlusion'],scope:'Node integration with real detail GLB and texture files, a DOM fixture, and a stub image decoder. Browser shader compilation and interaction are checked separately.'};
await writeFile('artwork/anatomy/brain-detail/runtime-verification.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
