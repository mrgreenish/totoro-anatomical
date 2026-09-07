'use client';

import type { RefObject } from 'react';
import { Layers3, ScanLine, Sparkles, ArrowLeftRight, Focus, X } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { SYSTEMS, systemVisible } from '@/lib/anatomy-state';
import type { AnatomyState, AnatomySystem, AnatomyMode, CutAxis } from '@/lib/anatomy-state';
import type { SculptureController } from '@/lib/totoro-scene';

type Props = { state: AnatomyState; ready: boolean; controller: RefObject<SculptureController | null> };
const MODES: { id: AnatomyMode; label: string; icon: typeof Sparkles }[] = [
  { id: 'exterior', label: 'Exterior', icon: Sparkles },
  { id: 'split', label: 'Split', icon: ScanLine },
  { id: 'exploded', label: 'Exploded', icon: Layers3 },
];
const AXES: { id: CutAxis; label: string }[] = [
  { id: 'x', label: 'Side to side' }, { id: 'z', label: 'Front to back' }, { id: 'y', label: 'Top to bottom' },
];
export function AnatomyControls({ state, ready, controller }: Props) {
  const active = state.mode !== 'exterior';
  const selected = state.parts.find(p => p.id === state.selectedId);
  const selectable = state.parts.filter(p => systemVisible(p.systems, state.visibleSystems));
  const toggle = (id: AnatomySystem) => controller.current?.setVisibleSystems(state.visibleSystems.includes(id)
    ? state.visibleSystems.filter(s => s !== id) : [...state.visibleSystems, id]);
  return <>
    <fieldset className="anatomy-modebar" aria-label="View mode">
      {MODES.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={state.mode === id}
        disabled={!ready} onClick={() => { void controller.current?.setMode(id); }}><Icon size={16} strokeWidth={1.6}/>{label}</button>)}
    </fieldset>
    {active && selected ? <output className="anatomy-selection-badge"><Focus size={15}/><span>{selected.label}</span><button type="button" aria-label="Dismiss part highlight" onClick={() => controller.current?.selectPart(null)}><X size={15}/></button></output> : null}
    {state.status === 'loading' ? <output className="anatomy-load"><span className="loading-dot"/>Loading anatomy…</output> : null}
    {state.status === 'error' ? <output className="anatomy-load anatomy-load-error">The anatomy couldn’t load. <button type="button" onClick={() => { void controller.current?.setMode('split'); }}>Retry</button></output> : null}
    {active ? <aside className="anatomy-panel" aria-label="Anatomy controls">
      <div className="anatomy-panel-heading"><div><span className="anatomy-eyebrow">BENEATH THE COAT</span><h2>Anatomy study<span>.</span></h2></div><span className="anatomy-index">02</span></div>
      <p className="anatomy-intro">An imagined anatomy, shaped for a forest spirit.</p>
      <div className="systems-heading"><h3>Body systems</h3><button type="button" onClick={() => controller.current?.setVisibleSystems(SYSTEMS.map(s => s.id))}>Show all</button></div>
      <div className="system-list">
        {SYSTEMS.map(system => <div className={`system-row ${state.visibleSystems.includes(system.id) ? 'is-visible' : ''}`} key={system.id}>
          <label><input type="checkbox" checked={state.visibleSystems.includes(system.id)} onChange={() => toggle(system.id)}/><span className="system-swatch" style={{ background: system.color }}/><span>{system.label}</span></label>
          <button type="button" className="system-only" aria-label={`Only ${system.label.toLowerCase()}`} onClick={() => controller.current?.setVisibleSystems([system.id])}>Only</button>
        </div>)}
      </div>
      {state.visibleSystems.length === 0 ? <output className="anatomy-empty">Choose a system to see it.</output> : null}
      <div className="anatomy-adjustment">
        {state.mode === 'split' ? <>
          <div className="adjustment-heading"><h3>Cutting plane</h3><button type="button" className="flip-cut" aria-label="Reverse retained side" aria-pressed={state.cut.flipped} onClick={() => controller.current?.setCut({ flipped: !state.cut.flipped })}><ArrowLeftRight size={14}/>Flip</button></div>
          <fieldset className="cut-directions" aria-label="Cut direction">{AXES.map(axis => <button key={axis.id} type="button" aria-pressed={state.cut.axis === axis.id} onClick={() => controller.current?.setCut({ axis: axis.id, position: .5 })}>{axis.label}</button>)}</fieldset>
          <div className="anatomy-slider-label"><span id="cut-position-label">Slice position</span><output>{Math.round(state.cut.position * 100)}%</output></div>
          <Slider className="anatomy-slider" aria-labelledby="cut-position-label" value={[state.cut.position * 100]} min={0} max={100} step={1} onValueChange={value => controller.current?.setCut({ position: (Array.isArray(value) ? value[0] : value) / 100 })}/>
          <p className="anatomy-control-hint">Drag the line to slice. Orbit to look inside.</p>
        </> : <>
          <div className="anatomy-slider-label"><h3 id="separation-label">Separation</h3><output>{Math.round(state.explosion * 100)}%</output></div>
          <Slider className="anatomy-slider" aria-labelledby="separation-label" value={[state.explosion * 100]} min={0} max={100} step={1} onValueChange={value => controller.current?.setExplosion((Array.isArray(value) ? value[0] : value) / 100)}/>
          <div className="separation-labels"><span>Assembled</span><span>Expanded</span></div>
          <p className="anatomy-control-hint">Click a part to take a closer look.</p>
        </>}
      </div>
      {state.status === 'ready' ? <div className="part-inspector">
        <label htmlFor="anatomy-part">Inspect a part</label>
        <select id="anatomy-part" value={state.selectedId ?? ''} onChange={event => controller.current?.selectPart(event.target.value || null)}>
          <option value="">Choose a part…</option>{selectable.map(p => <option value={p.id} key={p.id}>{p.label}</option>)}
        </select>
        {selected ? <div className="selected-part"><Focus size={17}/><div><strong>{selected.label}</strong>{selected.description ? <p>{selected.description}</p> : null}</div><button type="button" aria-label="Clear selected part" onClick={() => controller.current?.selectPart(null)}><X size={14}/></button></div> : null}
      </div> : null}
      <div className="anatomy-footnote">Human-inspired · Fictional anatomy</div>
    </aside> : null}
  </>;
}
