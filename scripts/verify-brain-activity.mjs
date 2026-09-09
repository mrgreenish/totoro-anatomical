import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import * as THREE from 'three';
const code=ts.transpileModule(await readFile('lib/brain-activity.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from ['"]([^'"]+)['"]/g,(_,n)=>`from ${JSON.stringify(import.meta.resolve(n))}`);
const {createBrainActivity}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
class Canvas extends EventTarget {getBoundingClientRect(){return {left:0,top:0,width:800,height:600};}}
globalThis.window=new EventTarget();globalThis.document=new EventTarget();
const camera=new THREE.PerspectiveCamera(30,4/3,.1,100);camera.position.z=3;camera.updateMatrixWorld(true);
const root=new THREE.Group();root.add(new THREE.Mesh(new THREE.SphereGeometry(.5,24,16),new THREE.MeshStandardMaterial({map:new THREE.Texture()})));
let checks=0;const check=(v,m)=>{assert.ok(v,m);checks++;};
for(const reduced of [false,true]){
 const canvas=new Canvas();let wakes=0;
 const activity=createBrainActivity({canvas,camera,root,reduced,wake(){wakes++;}}),u=activity.uniforms;
 const event=(type,x=400,y=300,pointerType='mouse')=>{const e=new Event(type);Object.assign(e,{isPrimary:true,clientX:x,clientY:y,pointerType});canvas.dispatchEvent(e);};
 const step=(animated=true)=>{for(let i=0;i<90;i++)activity.update(1/60,animated);};
 activity.setEnabled(true);step();check(u.brainHoverLevel.value===0,'No spontaneous sparks away from tissue');
 event('pointermove');step();check(u.brainHoverLevel.value>.99,'Real tissue intersection activates firing');
 check(u.brainHoverPoint.value.z>.48,'Activity follows the visible surface');
 const time=u.brainActivityTime.value;step(false);check(u.brainActivityTime.value===time,'Pause freezes the firing phase');
 if(reduced)check(time===0&&u.brainStillActivity.value===1,'Reduced motion presents a still glow');
 else check(time>0,'Hover advances firing when playing');
 event('pointermove',5,5);step();check(u.brainHoverLevel.value===0,'Background hover fades all firing away');
 event('pointerdown',400,300,'touch');step();event('pointerup',400,300,'touch');step();check(u.brainHoverLevel.value===0,'Touch release clears activity');
 event('pointermove');step();window.dispatchEvent(new Event('blur'));step();check(u.brainHoverLevel.value===0,'Blur clears the hover');
 event('pointermove');step();activity.setEnabled(false);check(u.brainHoverLevel.value===0,'Close clears emission immediately');
 const shader={uniforms:{},vertexShader:THREE.ShaderLib.physical.vertexShader,fragmentShader:THREE.ShaderLib.physical.fragmentShader};activity.apply(shader);
 check(shader.uniforms.brainHoverLevel===u.brainHoverLevel&&shader.fragmentShader.includes('totalEmissiveRadiance+=firingNeurons'),'Emission is bound to the physical tissue material');
 activity.dispose();event('pointermove');step();check(u.brainHoverLevel.value===0,'Disposed pointer listeners cannot reactivate firing');check(wakes>0,'Hover wakes demand-driven rendering');
}
console.log(`Brain hover activity: ${checks} checks passed.`);
