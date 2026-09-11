'use client';

import {useEffect,useState,type RefObject} from 'react';
import {ArrowDown,ArrowRight,ArrowUp,ArrowUpRight,Pause,Play,RotateCcw,Wind} from 'lucide-react';
import type {SculptureController} from '@/lib/totoro-scene';
import {defaultLungOptions,LUNG_SOURCES,lungCycle,type LungSnapshot,type LungViewOptions} from '@/lib/lung-physiology';

export function LungStudyControls({controller,animated,onAnimateChange}:{controller:RefObject<SculptureController|null>;animated:boolean;onAnimateChange:(value:boolean)=>void}) {
  const [options,setOptions]=useState(defaultLungOptions);
  const [snapshot,setSnapshot]=useState<LungSnapshot>(()=>({...lungCycle(.06),running:true,mode:'surface'}));
  useEffect(()=>{
    const initial=defaultLungOptions();initial.playing=!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setOptions(initial);controller.current?.setLungViewOptions(initial);
    const refresh=()=>{const next=controller.current?.getLungSnapshot();if(next)setSnapshot(previous=>previous.phase===next.phase&&previous.running===next.running&&previous.mode===next.mode?previous:next);};refresh();
    const timer=window.setInterval(refresh,100);return()=>window.clearInterval(timer);
  },[controller]);
  const change=(value:Partial<LungViewOptions>)=>{setOptions(previous=>({...previous,...value}));controller.current?.setLungViewOptions(value);const next=controller.current?.getLungSnapshot();if(next)setSnapshot(next);};
  const inhale=snapshot.inhaling,micro=options.mode==='alveoli';
  const playing=options.playing&&animated;
  const stage=inhale?'Breathe in':'Breathe out';
  return <div className="lung-study-controls">
    <fieldset className="lung-view-modes" aria-label="Lung view">
      {([{id:'surface',label:'Whole lungs'},{id:'airways',label:'Follow the air'},{id:'alveoli',label:'Air sacs'}] as const).map(({id,label})=>
        <button key={id} type="button" aria-pressed={options.mode===id} onClick={()=>change({mode:id})}>{label}</button>)}
    </fieldset>
    <section className="lung-discovery" aria-label="Breathing discovery">
      <span className="lung-kicker">{micro?'03 / THE TINIEST EXCHANGE':options.mode==='airways'?'02 / FOLLOW A BREATH':'01 / MAKE ROOM FOR AIR'}</span>
      <h3>{micro?'Tiny sacs. A big job.':options.mode==='airways'?'A tree that carries air.':'Your breathing muscle.'}</h3>
      <p>{micro?'At the end of the smallest airways are tiny air sacs called alveoli. A net of tiny blood vessels hugs each one.':options.mode==='airways'?'Air travels down the windpipe, then through smaller and smaller branches. Breathe out, and it follows the same paths back.':'The diaphragm is the muscle beneath your lungs. When it pulls down, your chest has more room. Air flows in and your lungs grow.'}</p>
      {micro?<>
        <div className="lung-exchange-key">
          <div><span className="lung-gas oxygen">O₂</span><span><strong>Oxygen goes into blood</strong><small>From the air sac, across its thin wall.</small></span><ArrowRight size={16}/></div>
          <div><span className="lung-gas carbon">CO₂</span><span><strong>Carbon dioxide goes into air</strong><small>From the blood, ready to breathe out.</small></span><ArrowRight size={16}/></div>
        </div>
        <p className="lung-small-note">The red discs are blood cells. Watch them turn brighter as they pick up oxygen. Both oxygen-rich and oxygen-poor blood are red.</p>
      </>:<div className={`lung-breath-card ${inhale?'is-inhaling':'is-exhaling'}`}>
        <div className="lung-breath-heading"><span className="lung-direction">{inhale?<ArrowDown size={22}/>:<ArrowUp size={22}/>}</span><div><span>{snapshot.running?'FOLLOW ALONG':'BREATH PAUSED'}</span><strong>{stage}</strong></div><span className="lung-phase-number">{inhale?'01':'02'}</span></div>
        <p>{inhale?'Muscle pulls down → more room → air comes in.':'Muscle relaxes up → less room → air flows out.'}</p>
        <div className="lung-expansion-label"><span>How much the lungs have expanded</span><span>{Math.round(snapshot.inflation*100)}%</span></div>
        <meter min="0" max="1" value={snapshot.inflation} aria-label="Lung expansion during this breath"/>
      </div>}
      {options.mode==='airways'?<div className="lung-air-legend"><span><i/>Air moving in</span><span><i/>Air moving out</span></div>:null}
    </section>
    <section className="lung-playback" aria-label="Breathing controls">
      <div className="lung-playback-actions">
        <button type="button" className="lung-play-button" onClick={()=>{if(!playing)onAnimateChange(true);change({playing:!playing});}}>{playing?<Pause size={16}/>:<Play size={16}/>}<span>{playing?'Pause breathing':'Play breathing'}</span></button>
        <button type="button" className="lung-restart" aria-label="Restart this breath" onClick={()=>change({phase:0})}><RotateCcw size={16}/></button>
        <label className="lung-speed"><span className="sr-only">Breathing demonstration speed</span><select aria-label="Breathing demonstration speed" value={options.speed} onChange={e=>change({speed:Number(e.target.value)})}><option value=".5">½ speed</option><option value="1">1× speed</option><option value="1.5">1½ speed</option></select></label>
      </div>
      <div className="lung-scrubber-label"><label htmlFor="lung-breath-phase">Try a breath yourself</label><output>{stage}</output></div>
      <input id="lung-breath-phase" type="range" min="0" max="100" step=".5" value={snapshot.phase*100} aria-valuetext={`${stage}, ${Math.round(snapshot.inflation*100)} percent expanded`} onChange={e=>change({phase:Number(e.target.value)/100,playing:false})}/>
      <div className="lung-scrubber-ends"><span>Rest</span><span>In</span><span>Out</span><span>Rest</span></div>
      <p className="lung-small-note">Drag to pause and explore. Your lungs always keep some air inside.</p>
      {options.playing&&!snapshot.running?<p className="lung-small-note">Animation is paused in the scene or reduced-motion settings. You can still move the breath slider.</p>:null}
    </section>
    <button type="button" className="lung-next" onClick={()=>change({mode:options.mode==='surface'?'airways':options.mode==='airways'?'alveoli':'surface'})}>
      <Wind size={17}/><span>{options.mode==='surface'?'See where the air goes':options.mode==='airways'?'Visit the tiny air sacs':'Back to the whole lungs'}</span><ArrowRight size={16}/>
    </button>
    <div className="lung-study-foot"><label><input type="checkbox" checked={options.labels} onChange={e=>change({labels:e.target.checked})}/>Show labels</label>
      <span>{micro?'Air sac cut open · particles enlarged':options.mode==='airways'?'Tissue made see-through to reveal airways':'Human-inspired · Fictional anatomy'}</span>
    </div>
    <details className="lung-sources"><summary>A little more about breathing</summary>
      <p>{micro?'Gas exchange keeps happening between breaths. The wall and cells are enlarged so you can see them.':'Your lungs follow your chest through their slippery linings, called pleura. During a quiet breath out, the diaphragm relaxes and stretchy lung tissue recoils.'} Air is a mixture of gases; the colored dots are a guide.</p>
      {LUNG_SOURCES.map(source=><a href={source.url} key={source.url} target="_blank" rel="noreferrer">{source.label}<ArrowUpRight size={12}/></a>)}
    </details>
  </div>;
}
