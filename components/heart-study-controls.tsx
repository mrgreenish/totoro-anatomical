'use client';

import { useEffect, useState, type RefObject } from 'react';
import { Activity } from 'lucide-react';
import type { SculptureController } from '@/lib/totoro-scene';
import type { HeartViewOptions } from '@/lib/heart-detail';

export function HeartStudyControls({controller}:{controller:RefObject<SculptureController|null>}) {
  const [options,setOptions]=useState<HeartViewOptions>({translucent:false,blood:true,cells:false});
  const [phase,setPhase]=useState('Ventricular filling');
  useEffect(()=>{
    controller.current?.setHeartViewOptions({translucent:false,blood:true,cells:false});
    const change=(event:Event)=>setPhase((event as CustomEvent<string>).detail);
    document.addEventListener('heart-phase',change);
    return ()=>document.removeEventListener('heart-phase',change);
  },[controller]);
  const change=(key:keyof HeartViewOptions,value:boolean)=>{
    const next={...options,[key]:value};setOptions(next);controller.current?.setHeartViewOptions(next);
  };
  return <div className="heart-controls">
    <div className="heart-rhythm"><Activity size={16} aria-hidden="true"/><span>72 BPM · Resting rhythm</span></div>
    <output className="heart-phase">{phase}</output>
    <fieldset className="heart-view-options" aria-label="Heart appearance">
      <label className="heart-view-option"><input type="checkbox" checked={options.translucent} onChange={e=>change('translucent',e.target.checked)}/><span>Translucent</span></label>
      <label className="heart-view-option"><input type="checkbox" checked={options.blood} disabled={!options.translucent} onChange={e=>change('blood',e.target.checked)}/><span>Blood flow</span></label>
      <label className="heart-view-option"><input type="checkbox" checked={options.cells} disabled={!options.translucent||!options.blood} onChange={e=>change('cells',e.target.checked)}/><span>Blood cells</span></label>
    </fieldset>
    {options.translucent&&options.blood ? <>
      <div className="heart-flow-key"><span><i/>To the lungs</span><span><i className="oxygenated"/>To the body</span></div>
      <p className="heart-flow-note">Illustrative flow{options.cells?' · Cells enlarged':''}</p>
    </> : null}
  </div>;
}
