import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';
import * as THREE from 'three';
import { Document, NodeIO } from '@gltf-transform/core';

const asModule = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const stateURL = asModule(compile(await readFile('lib/anatomy-state.ts','utf8')));
const state = await import(stateURL);
const source = compile(await readFile('lib/totoro-anatomy.ts','utf8')).replace(/from ['"]([^'"]+)['"]/g, (_, name) => `from ${JSON.stringify(name==='./anatomy-state'?stateURL:import.meta.resolve(name))}`);
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
const report={passed:true,assertions,coverage:['cut coordinates and reverse','system membership','GLTF metadata loading','visibility','exact reassembly','selection','reset','keyboard handle','failed loading and retry','stale load cancellation','resource cleanup','desktop/mobile framing'],scope:'Node integration with the real Three.js GLTF loader and a DOM event fixture. GPU rendering and browser layout are separate checks.'};
await writeFile('artwork/anatomy/runtime-verification.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
