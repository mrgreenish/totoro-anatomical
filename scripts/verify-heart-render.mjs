/** Local, isolated WebGL integration check through a fresh headless Chrome. */
import {writeFile} from 'node:fs/promises';
const tabs=await fetch('http://127.0.0.1:9337/json/list').then(r=>r.json());
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let seq=0;const pending=new Map(),errors=[];
ws.addEventListener('message',event=>{
  const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(m.error);else p.resolve(m.result);}
  if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);
  if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description).join(' ').slice(0,3500));
});
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{
  const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result?.value;
};
const waitFor=async expression=>{const end=Date.now()+90000;while(Date.now()<end){if(await evaluate(`Boolean(${expression})`))return;await new Promise(r=>setTimeout(r,200));}throw new Error('Timed out: '+expression);};
const click=label=>evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)})?.click()`);
const toggle=label=>evaluate(`Array.from(document.querySelectorAll('label')).find(l=>l.textContent.trim()===${JSON.stringify(label)})?.querySelector('input')?.click()`);
const screenshot=async name=>{const image=await call('Page.captureScreenshot',{format:'png'});await writeFile(`artwork/anatomy/heart-detail/${name}.png`,Buffer.from(image.data,'base64'));};
try {
  await call('Runtime.enable');await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:'http://localhost:3002/'});
  await waitFor(`document.querySelector('.sculpture')?.classList.contains('is-ready')`);
  await click('Exploded');await waitFor(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Explore the heart'&&!b.disabled)`);
  await click('Explore the heart');await waitFor(`document.querySelector('.is-heart-view')`);
  await evaluate('new Promise(r=>setTimeout(r,4500))');await screenshot('webgl-opaque');
  const opaque=await evaluate(`({stats:document.querySelector('canvas').dataset.renderStats,heading:document.querySelector('h2').textContent,canvas:document.querySelector('canvas').getBoundingClientRect().toJSON()})`);
  await toggle('Translucent');await evaluate('new Promise(r=>setTimeout(r,1800))');await screenshot('webgl-flow');await toggle('Blood cells');
  await evaluate('new Promise(r=>setTimeout(r,5000))');await screenshot('webgl-blood');
  const blood=await evaluate(`({stats:document.querySelector('canvas').dataset.renderStats,phase:document.querySelector('.heart-phase').textContent,controls:[...document.querySelectorAll('.heart-view-option input')].map(i=>({checked:i.checked,disabled:i.disabled})),overflow:document.documentElement.scrollWidth>innerWidth})`);
  await evaluate(`document.querySelector('[aria-label="Pause animation"]').click()`);
  await evaluate('new Promise(r=>setTimeout(r,1000))');await screenshot('webgl-paused');
  await click('Back to anatomy');await waitFor(`!document.querySelector('.is-heart-view')`);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await call('Page.navigate',{url:'http://localhost:3002/'});
  await waitFor(`document.querySelector('.sculpture')?.classList.contains('is-ready')`);await click('Exploded');
  await waitFor(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Explore the heart'&&!b.disabled)`);
  await click('Explore the heart');await waitFor(`document.querySelector('.is-heart-view')`);
  await toggle('Translucent');await toggle('Blood cells');await evaluate('new Promise(r=>setTimeout(r,4500))');await screenshot('webgl-mobile');
  const mobile=await evaluate(`({stats:document.querySelector('canvas').dataset.renderStats,overflow:document.documentElement.scrollWidth>innerWidth,canvas:document.querySelector('canvas').getBoundingClientRect().toJSON(),controls:document.querySelector('.heart-view-options').getBoundingClientRect().toJSON()})`);
  const result={passed:errors.length===0,scope:'Isolated headless Chrome on the local Mac at DPR 1; mobile is viewport emulation, not a physical-phone benchmark.',errors,opaque,blood,mobile};
  await writeFile('artwork/anatomy/heart-detail/webgl-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(errors.length)process.exitCode=1;
} catch(error) {console.error(error);console.log(JSON.stringify({errors}));process.exitCode=1;}finally{ws.close();}
