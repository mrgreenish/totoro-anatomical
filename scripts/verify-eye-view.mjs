import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import * as THREE from 'three';
import {Document,NodeIO} from '@gltf-transform/core';
import {moduleURLFor} from './load-typescript.mjs';
const {createAnatomyExplorer}=await import(await moduleURLFor('lib/totoro-anatomy.ts'));
const {defaultEyeOptions,eyeOptics,photoreceptorResponse}=await import(await moduleURLFor('lib/eye-optics.ts'));
let assertions=0;const check=(value,label)=>{assert.ok(value,label);assertions++;};
const defaults=defaultEyeOptions();
check(eyeOptics({...defaults,light:0}).pupil>eyeOptics({...defaults,light:100}).pupil,'Bright light closes the iris, dim light opens it');
check(eyeOptics({...defaults,near:100}).lensDepth>eyeOptics({...defaults,near:0}).lensDepth,'Near accommodation thickens the lens');
check(eyeOptics({...defaults,near:100}).ciliaryRadius<eyeOptics({...defaults,near:0}).ciliaryRadius,'Ciliary contraction tightens the ring');
for(let near=0;near<=100;near+=10) {
  const corrected=eyeOptics({...defaults,near}),uncorrected=eyeOptics({...defaults,near,accommodate:false});
  check(corrected.focusZ===-.925&&corrected.blur===0,'Accommodated image remains on the retina');
  check(uncorrected.focusZ<=-.925,'Near object without accommodation focuses behind retina');
  check(Number.isFinite(eyeOptics({...defaults,near:NaN,light:Infinity}).pupil),'Invalid optical input cannot create NaN geometry');
}
check(photoreceptorResponse(550).m>.8&&photoreceptorResponse(550).l>.8,'A wavelength excites overlapping cone types');
check(photoreceptorResponse(420).s>photoreceptorResponse(620).s,'Short-wave cones prefer short wavelengths');

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
check(!fetched.some(p=>p.includes('eye-detail')),'Eye textures are not fetched by initial anatomy');
const saved={position:f.camera.position.clone(),target:f.controls.target.clone(),cut:{...f.api.state.cut},systems:[...f.api.state.visibleSystems]};
await f.api.openEyeView('shortcut');
check(f.api.state.eyeView.status==='open'&&f.api.state.brainView.status==='closed'&&f.api.state.heartView.status==='closed','Eye opens as the only isolated study');
const eye=f.api.detailScene;
check(eye.getObjectByName('Corneal_dome').material.transmission===1,'Cornea uses physical scene transmission');
check(eye.getObjectByName('Crystalline_lens').material.ior>1&&eye.getObjectByName('Crystalline_lens').material.ior<1.1,'Immersed lens uses relative refractive index');
function stats(){let triangles=0,calls=0;eye.traverseVisible(n=>{if(n.isMesh){calls++;triangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3*(n.isInstancedMesh?n.count:1);}else if(n.isLine||n.isPoints)calls++;});return {triangles,calls};}
const surface=stats();
check(surface.triangles<40000&&surface.calls<12,'Whole eye fits a bounded geometry and draw-call budget');
check(f.api.update(.016,true)===false,'Static exterior eye does not request continuous frames');
f.api.setEyeViewOptions({mode:'cutaway',lesson:'focus',near:100});
const cutaway=stats();
check(cutaway.triangles<80000&&cutaway.calls<30,'Cutaway stays within the geometry and draw-call budget');
check(eye.getObjectByName('Light_paths').visible&&eye.getObjectByName('Corneal_dome').visible,'Cutaway exposes rays and retains the corneal half dome');
check(eye.getObjectByName('Crystalline_lens').visible,'Lens is visible in cutaway');
const iris=eye.getObjectByName('Iris'),shader={uniforms:{},vertexShader:THREE.ShaderLib.physical.vertexShader,fragmentShader:THREE.ShaderLib.physical.fragmentShader};
iris.material.onBeforeCompile(shader);
check(shader.uniforms.pupilRadius&&shader.vertexShader.includes('mix(pupilRadius, .475'),'Real pupil geometry follows the light control');
check(shader.fragmentShader.includes('texture2D(map, eyeTextureUv)'),'Iris fiber albedo is mapped onto the deforming annulus');
const lens=eye.getObjectByName('Crystalline_lens'),lensShader={uniforms:{},vertexShader:THREE.ShaderLib.physical.vertexShader,fragmentShader:THREE.ShaderLib.physical.fragmentShader};lens.material.onBeforeCompile(lensShader);
check(lensShader.uniforms.lensDepth.value>.2,'Near control changes actual lens deformation');
f.api.setEyeViewOptions({accommodate:false});check(lensShader.uniforms.lensDepth.value<.15,'Disabling accommodation flattens the actual lens');
f.api.setEyeViewOptions({mode:'retina',lesson:'color'});
const retina=stats(),cones=eye.getObjectByName('Cone_outer_segments'),rods=eye.getObjectByName('Rod_outer_segments');
check(cones.isInstancedMesh&&rods.isInstancedMesh&&retina.triangles<80000&&retina.calls<12,'Retinal cells use bounded instanced geometry and shader membranes');
const coneColors=cones.instanceColor.array.slice();f.api.setEyeViewOptions({wavelength:420});check(!cones.instanceColor.array.every((x,i)=>x===coneColors[i]),'Color slider changes cone response on the model');
f.api.setEyeViewOptions({rods:false});check(!rods.visible&&!eye.getObjectByName('Rod_inner_segments').visible,'Rod toggle hides both outer and inner segments');
f.api.setEyeViewOptions({cones:false});check(!cones.visible&&!eye.getObjectByName('Cone_inner_segments').visible,'Cone toggle hides the complete cells');
f.api.setEyeViewOptions({rods:true,cones:true});
f.api.update(.05,true);
const light=eye.getObjectByName('Magnified_retina').children.find(c=>c.isPoints),time=light.material.uniforms.time.value;
check(f.api.update(.05,false)===false&&light.material.uniforms.time.value===time,'Pause freezes retinal photons and lets rendering idle');
const timings=[];for(let i=0;i<240;i++){const start=performance.now();f.api.update(1/60,true);timings.push(performance.now()-start);}timings.sort((a,b)=>a-b);
let geometryDisposals=0,instanceDisposals=0;eye.getObjectByName('Sclera').geometry.addEventListener('dispose',()=>geometryDisposals++);cones.addEventListener('dispose',()=>instanceDisposals++);
await f.api.openHeartView('shortcut');check(f.api.state.heartView.status==='open'&&f.api.state.eyeView.status==='closed','Direct eye-to-heart switching succeeds');
check(geometryDisposals===1&&instanceDisposals===1,'Switch releases eye geometry and instance buffers');
f.api.closeHeartView();check(f.camera.position.equals(saved.position)&&f.controls.target.equals(saved.target),'Back restores the original anatomy camera after a study switch');
check(JSON.stringify(f.api.state.cut)===JSON.stringify(saved.cut)&&JSON.stringify(f.api.state.visibleSystems)===JSON.stringify(saved.systems),'Study switching preserves cut and system filters');
const before=fetched.length;await f.api.openEyeView('shortcut');check(fetched.length===before,'Reopening reuses compressed eye texture cache');
await f.api.openBrainView('shortcut');check(f.api.state.brainView.status==='open','Direct eye-to-brain switch succeeds');f.api.closeBrainView();f.api.dispose();
for(const action of ['cancel','reset','dispose']){
  const f=fixture();await f.api.setMode('split');delay=new Promise(r=>resolveDelay=r);
  const opening=f.api.openEyeView('shortcut');await new Promise(r=>setTimeout(r,5));
  if(action==='cancel')f.api.closeEyeView();else f.api[action]();resolveDelay();delay=undefined;await opening;
  check(f.api.state.eyeView.status!=='open','Pending eye load cannot reopen after '+action);f.api.dispose();
}
const broken=fixture();await broken.api.setMode('split');fail=true;await broken.api.openEyeView('shortcut');check(broken.api.state.eyeView.status==='error','Network failure exposes retry state');
fail=false;decodeFailure=true;await broken.api.openEyeView('shortcut');check(broken.api.state.eyeView.status==='error','Decode failure exposes retry state');
await broken.api.openEyeView('shortcut');check(broken.api.state.eyeView.status==='open','Retry recovers from partial image failure');broken.api.dispose();
reduced=true;const small=fixture(390);await small.api.setMode('split');await small.api.openEyeView('shortcut');small.api.setEyeViewOptions({mode:'retina'});
check(small.api.detailScene.getObjectByName('Cone_outer_segments').count===88,'Small screens use lower cell counts');
check(small.api.update(.1,true)===false,'Reduced motion disables photon loops');small.api.dispose();
check(bitmaps===closed,'Every decoded bitmap is released on exit, failure, or cancellation');
const result={passed:true,assertions,scope:'Node runtime integration using actual model code and texture files with mocked DOM, bitmap decode, and renderer. CPU timings exclude GPU rendering; not a browser or phone benchmark.',surface,cutaway,retina,cpuUpdateMedianMs:timings[120],cpuUpdateP95Ms:timings[228],decodedBitmaps:bitmaps,closedBitmaps:closed};
await mkdir('artwork/anatomy/eye-detail',{recursive:true});await writeFile('artwork/anatomy/eye-detail/verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
