'use client';

import { Brain, Heart, Eye, LoaderCircle } from 'lucide-react';
import type { AnatomyState, OrganStudy } from '@/lib/anatomy-state';

const STUDIES = [
  {id:'brain',label:'Brain',hint:'Thought & touch',icon:Brain},
  {id:'heart',label:'Heart',hint:'Blood & rhythm',icon:Heart},
  {id:'eye',label:'Eye',hint:'Light & color',icon:Eye},
] as const;
export function OrganStudySelector({state,onSelect,compact=false,onTrigger}:{
  state:AnatomyState;onSelect:(study:OrganStudy)=>void;compact?:boolean;
  onTrigger?:(study:OrganStudy,node:HTMLButtonElement|null)=>void;
}) {
  const pending=STUDIES.some(({id})=>state[`${id}View`].status==='loading');
  return <nav className={`organ-selector ${compact?'organ-selector-compact':''}`} aria-label="Detailed organ views">
    {!compact?<div className="organ-selector-heading"><span>Look a little closer</span><span>3 studies</span></div>:null}
    <div className="organ-selector-options">
      {STUDIES.map(({id,label,hint,icon:Icon})=>{
        const status=state[`${id}View`].status;
        return <button key={id} ref={node=>onTrigger?.(id,node)} type="button" data-organ={id}
          aria-label={`Explore the ${id}`} aria-pressed={status==='open'} aria-busy={status==='loading'}
          disabled={state.status!=='ready'||pending} onClick={()=>onSelect(id)}>
          <span className="organ-selector-icon">{status==='loading'?<LoaderCircle size={20} className="organ-loading-spin"/>:<Icon size={20} strokeWidth={1.5}/>}</span>
          <span className="organ-selector-name">{label}</span>
          {!compact?<span className="organ-selector-hint">{hint}</span>:null}
        </button>;
      })}
    </div>
  </nav>;
}
