import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';
import * as THREE from 'three';
const code=ts.transpileModule(await readFile('lib/brain-touch.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from ['"]([^'"]+)['"]/g,(_,name)=>`from ${JSON.stringify(import.meta.resolve(name))}`);
const {createTissueSprings,createBrainTouch,applyTissueTouch,MAX_TISSUE_PULL}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
let assertions=0;const check=(value,message)=>{assert.ok(value,message);assertions++;};

const simulate=(hz,reduced=false)=>{
  const springs=createTissueSprings(),slot=springs.grab(new THREE.Vector3(.2,.1,.4));
  springs.setTarget(slot,new THREE.Vector3(0,0,-.068));
  for(let i=0;i<hz/2;i++)springs.update(1/hz,reduced);
  const pressed=springs.offsets[slot].clone();springs.release(slot);
  let rebound=0;
  for(let i=0;i<hz*2;i++){springs.update(1/hz,reduced);rebound=Math.max(rebound,springs.offsets[slot].z);}
  return {springs,slot,pressed,rebound};
};
const runs=[30,60,120].map(hz=>simulate(hz));
check(runs.every(r=>r.pressed.z<-.06),'A press visibly indents the tissue');
check(runs[0].pressed.distanceTo(runs[1].pressed)<1e-5&&runs[1].pressed.distanceTo(runs[2].pressed)<1e-5,'Frame-rate independent response at 30/60/120 Hz');
check(runs[0].rebound>.003,'Release has a soft elastic rebound');
check(runs.every(r=>r.springs.offsets[r.slot].length()<.0001),'Tissue returns to its original shape');
const reduced=simulate(60,true);check(reduced.rebound<.0001,'Reduced motion removes the rebound');
const limit=createTissueSprings(),slot=limit.grab(new THREE.Vector3());limit.setTarget(slot,new THREE.Vector3(20,20,20));
check(Math.abs(limit.targets[slot].length()-MAX_TISSUE_PULL)<1e-9,'Extreme pointer movement is bounded');
for(let i=0;i<600;i++)limit.update(1/120,false);
check(limit.offsets[slot].length()<MAX_TISSUE_PULL+.001,'Long holds remain stable');
for(let i=0;i<40;i++){const id=limit.grab(new THREE.Vector3(i*.01,.1,.3));limit.setTarget(id,new THREE.Vector3(.05,0,-.05));limit.update(.05,false);limit.release(id);}
check(limit.offsets.every(v=>v.toArray().every(Number.isFinite)),'Rapid pokes and direction changes stay finite');
limit.reset();check(limit.offsets.every(v=>v.length()===0)&&limit.velocities.every(v=>v.length()===0),'Exit clears deformation and velocity');

for(const name of ['physical','depth']){
  const shader={uniforms:{},vertexShader:THREE.ShaderLib[name].vertexShader};applyTissueTouch(shader,limit);
  check(shader.vertexShader.includes('softTissuePosition(touchWorld.xyz)')&&shader.uniforms.tissueTouchCenters.value===limit.centers,`${name} shares the same deformation field`);
  if(name==='physical')check(shader.vertexShader.includes('softTissueNormal(touchPosition,touchNormal)'),'Surface normals follow deformation');
}

class Canvas extends EventTarget {
  classSet=new Set();captured=new Set();
  classList={add:(s)=>this.classSet.add(s),remove:(s)=>this.classSet.delete(s),toggle:(s,value)=>value?this.classSet.add(s):this.classSet.delete(s)};
  getBoundingClientRect(){return {left:0,top:0,width:800,height:600};}
  setPointerCapture(id){this.captured.add(id);}
  hasPointerCapture(id){return this.captured.has(id);}
  releasePointerCapture(id){this.captured.delete(id);}
}
globalThis.window=new EventTarget();globalThis.document=new EventTarget();
const canvas=new Canvas(),camera=new THREE.PerspectiveCamera(30,4/3,.025,100);camera.position.set(0,0,3);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
const root=new THREE.Group(),material=new THREE.MeshStandardMaterial({map:new THREE.Texture()});
root.add(new THREE.Mesh(new THREE.SphereGeometry(.5,32,24),material));
const controls={enabled:true,enableDamping:true,target:new THREE.Vector3(),update(){}};
let wakes=0;const touch=createBrainTouch({canvas,camera,controls,root,wake(){wakes++;},reduced:false});
const pointer=(type,x=400,y=300,extra={})=>{
  const event=new Event(type,{cancelable:true});Object.assign(event,{clientX:x,clientY:y,button:0,pointerId:1,isPrimary:true,pointerType:'mouse',pressure:.5,altKey:false,...extra});
  canvas.dispatchEvent(event);return event;
};
touch.setEnabled(true);
const before=camera.position.clone();pointer('pointerdown');
check(!controls.enabled&&canvas.hasPointerCapture(1)&&canvas.classSet.has('is-tissue-grabbed'),'Press captures the tissue and holds the camera');
for(let i=0;i<24;i++)touch.update(1/120);
check(touch.springs.offsets.some(v=>v.z<-.03),'Pointer press drives a real indentation');
pointer('pointermove',480,260);
for(let i=0;i<30;i++)touch.update(1/120);
check(touch.springs.offsets.some(v=>v.x>.05&&v.y>.025&&v.z>0),'Dragging pulls tissue toward the pointer and lifts it');
check(camera.position.equals(before),'Poking and pulling never orbit the camera');
pointer('pointerup',480,260);check(controls.enabled&&!canvas.hasPointerCapture(1),'Release restores orbit and releases capture');
for(let i=0;i<300;i++)touch.update(1/120);
check(touch.springs.offsets.every(v=>v.length()<.0001),'Released drag settles to exact rest');
pointer('pointerdown',5,5);check(controls.enabled&&!canvas.hasPointerCapture(1),'Background drag remains available for orbit');
pointer('pointerdown',400,300,{altKey:true});check(controls.enabled,'Alt drag can orbit directly over tissue');
pointer('pointerdown');pointer('pointerup');for(let i=0;i<12;i++)touch.update(1/120);
check(touch.springs.offsets.some(v=>v.z<-.015),'Quick tap between frames still produces a poke');
pointer('pointerdown');pointer('pointercancel');check(controls.enabled,'Cancelled pointer restores camera control');
pointer('pointerdown');touch.setEnabled(false);check(controls.enabled&&touch.springs.offsets.every(v=>v.length()===0),'Closing the view cancels a held grab');
touch.setEnabled(true);pointer('pointerdown');window.dispatchEvent(new Event('blur'));check(controls.enabled,'Window blur releases the tissue');
touch.dispose();pointer('pointerdown');check(controls.enabled&&!canvas.hasPointerCapture(1),'Disposal removes interaction listeners');
check(wakes>0,'Direct manipulation wakes the demand-driven renderer even while animation is paused');
const report={passed:true,assertions,coverage:['poke indentation','screen-plane pull','bounded deformation','elastic rebound','30/60/120 Hz consistency','reduced motion','rapid pokes','pointer capture and cancellation','background and Alt orbit','window blur','close and disposal','shared material and shadow deformation','demand-driven rendering']};
await writeFile('artwork/anatomy/brain-detail/touch-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
