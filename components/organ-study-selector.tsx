'use client';

import { Brain, Heart, Eye, LoaderCircle, ArrowUpRight } from 'lucide-react';
import type {SVGProps} from 'react';
import type { AnatomyState, OrganStudy } from '@/lib/anatomy-state';

function LungIcon(props:SVGProps<SVGSVGElement>&{size?:number}) {
  return <svg width={props.size??20} height={props.size??20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v7m0 0-4 4m4-4 4 4M9 7C7 4 4 8 3 12c-2 6-1 8 2 8 4 0 5-3 5-6V9m5-2c2-3 5 1 6 5 2 6 1 8-2 8-4 0-5-3-5-6V9"/></svg>;
}
export const STUDIES = [
  {id:'brain',label:'Brain',hint:'Thought & touch',icon:Brain},
  {id:'heart',label:'Heart',hint:'Blood & rhythm',icon:Heart},
  {id:'eye',label:'Eye',hint:'Light & color',icon:Eye},
  {id:'lung',label:'Lungs',hint:'Air & breathing',icon:LungIcon},
] as const;
export function OrganStudySelector({state,onSelect,compact=false,onTrigger}:{
  state:AnatomyState;onSelect:(study:OrganStudy)=>void;compact?:boolean;
  onTrigger?:(study:OrganStudy,node:HTMLButtonElement|null)=>void;
}) {
  const pending=STUDIES.some(({id})=>state[`${id}View`].status==='loading');
  return <nav className={`organ-selector ${compact?'organ-selector-compact':''}`} aria-label="Detailed organ views">
    {!compact?<div className="organ-selector-heading"><span>Explore an organ</span><span>{STUDIES.length} detailed studies</span></div>:<span className="organ-switch-label">Explore</span>}
    <div className="organ-selector-options">
      {STUDIES.map(({id,label,hint,icon:Icon})=>{
        const status=state[`${id}View`].status;
        return <button key={id} ref={node=>onTrigger?.(id,node)} type="button" data-organ={id}
          aria-label={`Explore the ${id==='lung'?'lungs':id}`} aria-pressed={status==='open'} aria-busy={status==='loading'}
          disabled={state.status!=='ready'||pending} onClick={()=>onSelect(id)}>
          <span className="organ-selector-icon">{status==='loading'?<LoaderCircle size={20} className="organ-loading-spin"/>:<Icon size={20} strokeWidth={1.5}/>}</span>
          <span className="organ-selector-copy"><span className="organ-selector-name">{label}</span>
          {!compact?<span className="organ-selector-hint">{hint}</span>:null}</span>
          {!compact?<ArrowUpRight className="organ-selector-arrow" size={13}/>:null}
        </button>;
      })}
    </div>
  </nav>;
}
