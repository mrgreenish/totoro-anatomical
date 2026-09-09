import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';
import * as THREE from 'three';
import { Document, NodeIO } from '@gltf-transform/core';

const asModule = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const stateURL = asModule(compile(await readFile('lib/anatomy-state.ts','utf8')));
const state = await import(stateURL);
const detailURL = asModule(compile(await readFile('lib/brain-detail.ts','utf8')).replace(/from ['"]([^'"]+)['"]/g, (_, name) => `from ${JSON.stringify(import.meta.resolve(name))}`));
const source = compile(await readFile('lib/totoro-anatomy.ts','utf8')).replace(/from ['"]([^'"]+)['"]/g, (_, name) => `from ${JSON.stringify(name==='./anatomy-state'?stateURL:name==='./brain-detail'?detailURL:import.meta.resolve(name))}`);
const { createAnatomyExplorer } = await import(asModule(source));
let assertions = 0;
function check(value, message) { assert(value,message); assertions++; }
for (const axis of ['x','y','z']) {
  const [lo,hi] = state.CUT_BOUNDS[axis];
  assert.equal(state.cutCoordinate(axis,-1),lo);assert.equal(state.cutCoordinate(axis,2),hi);
  check(Math.abs(state.cutCoordinate(axis,.5)-(lo+hi)/2)<1e-12,'Cut midpoint is numerically stable');assertions+=2;
}
assert.deepEqual(state.explosionPosition([1,2,3],[2,-3,.5],0),[1,2,3]); assertions++;
assert.deepEqual(state.explosionPosition([1,2,3],[2,-3,.5],1),[3,-1,3.5]); assertions++;
check(state.systemVisible(['organs','nerves'],['nerves']),'Brain must participate in nervous-system filtering');
check(!state.systemVisible(['bones'],['organs']),'Solo filter excludes other systems');

class Element extends EventTarget {
  children=[]; attributes={}; style={setProperty(){}};hidden=false;clientWidth=1000;clientHeight=750;
  appendChild(child){this.children.push(child);child.parentElement=this;return child;}
  setAttribute(key,value){this.attributes[key]=value;}
  setPointerCapture(){}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(x=>x!==this);}
  getBoundingClientRect(){return {left:0,top:0,width:this.clientWidth,height:this.clientHeight};}
}
globalThis.window={matchMedia:()=>({matches:true})};
globalThis.document={createElement:()=>new Element()};

const doc=new Document();const buffer=doc.createBuffer();
for(const [i,id,system,offset] of [[0,'heart','organs',[1,0,2]],[1,'bone','bones',[0,0,0]]]){
  const geometry=new THREE.BoxGeometry(.5,.8,.5);
  const pos=doc.createAccessor().setType('VEC3').setArray(geometry.attributes.position.array).setBuffer(buffer);
  const idx=doc.createAccessor().setType('SCALAR').setArray(geometry.index.array).setBuffer(buffer);
  const normal=doc.createAccessor().setType('VEC3').setArray(geometry.attributes.normal.array).setBuffer(buffer);
  const material=doc.createMaterial().setBaseColorFactor([.6,.3,.2,1]);
  const mesh=doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION',pos).setAttribute('NORMAL',normal).setIndices(idx).setMaterial(material));
  const node=doc.createNode(id).setMesh(mesh).setTranslation([i-.5,2.5,0]).setExtras({partId:id,label:id,systems:[system],explodeOffset:offset,cap:true});
  (doc.getRoot().listScenes()[0]??doc.createScene()).addChild(node);
}
const bytes=await new NodeIO().writeBinary(doc);
const success=()=>Promise.resolve(new Response(bytes,{status:200}));
globalThis.fetch=success;

function fixture(){
  const canvas=new Element();new Element().appendChild(canvas);
  const camera=new THREE.PerspectiveCamera(30,4/3,.1,80);camera.position.set(3.5,4,12.4);
  const controls={target:new THREE.Vector3(0,2.3,0),enabled:true};
  const scene=new THREE.Scene();const exterior=new THREE.Group();scene.add(exterior);
  const material=new THREE.MeshStandardMaterial();exterior.add(new THREE.Mesh(new THREE.BoxGeometry(3,5,2),material));
  const abort=new AbortController();const events=[];
  const api=createAnatomyExplorer({canvas,renderer:{},scene,camera,controls,exterior,signal:abort.signal,wake(){},onState:value=>events.push(value)});
  return{api,events,scene,camera,controls,exterior,material,canvas,abort};
}
const f=fixture();
await f.api.setMode('split');f.api.update(.1);
check(f.api.active&&f.api.state.status==='ready','Anatomy loads and activates');
check(f.api.state.parts.length===2,'Exported identities become selectable parts');
const plane=f.material.clippingPlanes[0];
const stencilVolumes=[];
f.scene.traverse(node=>{if(node.isMesh&&node.material.stencilWrite&&!node.material.colorWrite)stencilVolumes.push(node);});
check(stencilVolumes.length===4,'Both stencil passes are present for each fixture mesh');
for(const axis of ['x','y','z']) for(const flipped of [false,true]) for(const position of [.1,.41,.8]) {
  f.api.setCut({axis,flipped,position});f.api.update(.016);
  check(stencilVolumes.every(node=>node.material.clippingPlanes[0]===plane),
    `${axis}/${flipped}/${position}: section masks track the same live plane as the visible tissue`);
}
f.api.setCut({axis:'x',flipped:false,position:.5});f.api.update(.016);
check(plane.distanceToPoint(new THREE.Vector3(-1,2,0))>0,'Default cut retains negative X');
f.api.setCut({axis:'z',position:.25,flipped:true});f.api.update(.1);
check(plane.normal.z===1&&Math.abs(plane.constant+state.cutCoordinate('z',.25))<1e-8,'Axis, offset and reversal share one plane');
f.api.setVisibleSystems(['organs']);
check(!f.exterior.visible,'Solo organs hides the coat');
check(!f.scene.getObjectByName('bone').visible,'Solo organs hides bones');
await f.api.setMode('exploded');f.api.update(.1);
check(f.api.state.visibleSystems.length===1&&f.api.state.visibleSystems[0]==='organs','Filters survive mode changes');
const heart=f.scene.getObjectByName('heart');const baseline=new THREE.Vector3(-.5,2.5,0);
check(!Array.isArray(heart.material)||heart.geometry.groups.length>0,'Single-primitive meshes retain a renderable single material');
for(const amount of [1,0,.75,0,1,0]){f.api.setExplosion(amount);f.api.update(1);}
check(heart.position.distanceTo(baseline)<1e-9,'Repeated explosion returns to the exact original transform');
f.api.selectPart('heart');check(f.api.state.selectedId==='heart','Visible part is selectable');
f.api.setVisibleSystems(['bones']);check(f.api.state.selectedId===null,'Hiding a selected part clears selection');
f.api.selectPart('heart');check(f.api.state.selectedId===null,'Hidden geometry cannot be selected');
f.api.reset();f.api.update(1);
check(f.api.state.mode==='exterior'&&f.api.state.visibleSystems.length===7,'Reset restores exterior and every system');
check(f.exterior.position.length()===0&&f.material.clippingPlanes.length===0,'Reset removes explosion and clipping from the coat');
await f.api.setMode('split');
const handle=f.canvas.parentElement.children.find(e=>e.className==='cut-plane-handle');
const key=new Event('keydown',{cancelable:true});Object.defineProperty(key,'key',{value:'ArrowRight'});handle.dispatchEvent(key);
check(Math.abs(f.api.state.cut.position-.51)<1e-10,'Cut handle supports keyboard adjustment');
// The projected cut point and drag must agree even along the camera depth axis.
for (const axis of ['x','y','z']) {
  f.api.setCut({axis,position:.35}); f.api.update(.1);
  const project = position => {
    const point = new THREE.Vector3(0,2.45,0);
    point[axis] = state.cutCoordinate(axis,position); point.project(f.camera);
    return new THREE.Vector2((point.x*.5+.5)*1000,(-point.y*.5+.5)*750);
  };
  const start=project(.35), end=project(.55);
  check(Math.hypot(parseFloat(handle.style.left)-start.x,parseFloat(handle.style.top)-start.y)<1e-7,`${axis}: handle lies on the actual slice`);
  const dispatch=(type,point)=>{
    const event=new Event(type,{cancelable:true});
    Object.assign(event,{isPrimary:true,button:0,pointerId:1,clientX:point.x,clientY:point.y});
    handle.dispatchEvent(event);
  };
  dispatch('pointerdown',start); dispatch('pointermove',start); f.api.update(.016);
  check(Math.abs(f.api.state.cut.position-.35)<1e-9,`${axis}: grabbing does not jump`);
  dispatch('pointermove',end); f.api.update(.016);
  check(Math.abs(f.api.state.cut.position-.55)<1e-8,`${axis}: drag follows the pointer in perspective`);
  dispatch('pointerup',end); f.api.update(.016);
  check(Math.hypot(parseFloat(handle.style.left)-end.x,parseFloat(handle.style.top)-end.y)<1e-7,`${axis}: release does not jump`);
}
const disposedGeometry=heart.geometry;let released=false;disposedGeometry.addEventListener('dispose',()=>{released=true;});
f.api.dispose();f.api.dispose();
check(released&&!f.scene.getObjectByName('heart'),'Disposal releases geometry and removes the anatomy');
check(!f.canvas.parentElement.children.includes(handle),'Disposal removes the cutting handle');

globalThis.fetch=()=>Promise.resolve(new Response('',{status:503}));
const failure=fixture();const oldError=console.error;console.error=()=>{};
await failure.api.setMode('split');
check(failure.api.state.status==='error'&&failure.api.state.mode==='exterior'&&failure.exterior.visible,'Failure keeps the exterior usable');
globalThis.fetch=success;await failure.api.setMode('split');
check(failure.api.state.status==='ready'&&failure.api.active,'Retry recovers a failed load');failure.api.dispose();console.error=oldError;

let resolveRequest;
globalThis.fetch=()=>new Promise(resolve=>{resolveRequest=resolve;});
const racing=fixture();const pending=racing.api.setMode('exploded');racing.api.reset();
resolveRequest(new Response(bytes));await pending;
check(racing.api.state.mode==='exterior'&&!racing.api.active,'Late loads cannot undo Reset');
check(racing.events.at(-1).status==='ready','Late successful loads clear the loading indicator');racing.api.dispose();

const cancelled=fixture();const late=cancelled.api.setMode('split');cancelled.api.dispose();resolveRequest(new Response(bytes));await late;
check(!cancelled.scene.getObjectByName('heart'),'Disposed viewers do not attach a late asset');
for(const aspect of [1.8,.5]){
  const distance=state.fitDistance(10,5,4,30,aspect);const tangent=Math.tan(Math.PI/12);
  check((distance-2)*tangent>=2.5&&(distance-2)*tangent*aspect>=5,`Camera fits expanded bounds at aspect ${aspect}`);
}
// Exercise continuous animation with the real loader and section stencil.
globalThis.fetch=success;
globalThis.window.matchMedia=()=>({matches:false});
const beating=fixture();await beating.api.setMode('split');beating.api.setCut({position:.38});
const movingHandle=beating.canvas.parentElement.children.find(e=>e.className==='cut-plane-handle');
for(let frame=0;frame<8;frame++) {
  beating.api.update(1/60,false);
  const point=new THREE.Vector3(state.cutCoordinate('x',.38),2.45,0).project(beating.camera);
  check(Math.hypot(parseFloat(movingHandle.style.left)-(point.x*.5+.5)*1000,
    parseFloat(movingHandle.style.top)-(-point.y*.5+.5)*750)<1e-7,'Camera transition and slice handle share the current frame transform');
}
const beatingHeart=beating.scene.getObjectByName('heart');
const restScale=beatingHeart.scale.clone();
check(beating.api.update((60/72)*.16),'Heartbeat keeps the render loop awake');
check(beatingHeart.scale.x<restScale.x*.94&&beatingHeart.scale.y>restScale.y,'Heart contracts across its width and lengthens during systole');
const volume=beating.scene.children.flatMap(n=>n.children).find(n=>n.geometry===beatingHeart.geometry&&n.matrixAutoUpdate===false);
check(volume.matrix.equals(beatingHeart.matrixWorld),'Cut stencil follows the deformed heart');
beating.api.update(.01,false);
check(beatingHeart.scale.equals(restScale),'Pausing restores the resting heart and section');
await beating.api.setMode('exploded');
check(beatingHeart.position.distanceTo(new THREE.Vector3(-.5,2.5,0))<1e-9,'Exploded reveal starts assembled');
beating.api.update(.15);
check(beatingHeart.position.x>-.5&&beatingHeart.position.x<.15,'Exploded reveal interpolates before reaching its destination');
beating.api.setVisibleSystems(['bones']);
for(let i=0;i<240;i++)beating.api.update(1/60);
check(!beating.api.update(1/60),'Hidden heart does not keep the render loop awake');
beating.api.dispose();
globalThis.window.matchMedia=()=>({matches:true});
const still=fixture();await still.api.setMode('split');still.api.update(.13);
check(still.scene.getObjectByName('heart').scale.equals(restScale),'Reduced motion leaves the heart at rest');still.api.dispose();

const report={passed:true,assertions,coverage:['cut coordinates and reverse','system membership','GLTF metadata loading','visibility','exact reassembly','selection','reset','keyboard handle','perspective slice alignment and pointer dragging on all axes','failed loading and retry','stale load cancellation','resource cleanup','desktop/mobile framing','heartbeat and section synchronization','pause and reduced motion','animated explosion'],scope:'Node integration with the real Three.js GLTF loader and a DOM event fixture. GPU rendering and browser layout are separate checks.'};
await writeFile('artwork/anatomy/runtime-verification.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
