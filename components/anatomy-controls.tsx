'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { Layers3, ScanLine, Sparkles, ArrowLeftRight, Focus, X, ArrowLeft, ArrowUpRight, Brain } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { SYSTEMS, partVisible } from '@/lib/anatomy-state';
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
  const brainOpen = state.brainView.status === 'open';
  const brainButton = useRef<HTMLButtonElement>(null);
  const shortcutButton = useRef<HTMLButtonElement>(null);
  const activeModeButton = useRef<HTMLButtonElement>(null);
  const [entry, setEntry] = useState<'contextual' | 'shortcut'>('contextual');
  const backButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (brainOpen) backButton.current?.focus({ preventScroll: true });
    else if (wasOpen.current) {
      const trigger = entry === 'shortcut' ? shortcutButton.current : brainButton.current;
      (trigger ?? activeModeButton.current)?.focus({ preventScroll: true });
    }
    wasOpen.current = brainOpen;
    if (!brainOpen && state.brainView.status !== 'loading') return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); controller.current?.closeBrainView(); }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [brainOpen, state.brainView.status, controller, entry]);
  const selected = state.parts.find(p => p.id === state.selectedId);
  const openBrain = (origin: 'contextual' | 'shortcut') => {
    setEntry(origin);
    void controller.current?.openBrainView(origin);
  };
  const selectable = state.parts.filter(p => partVisible(p, state));
  const toggle = (id: AnatomySystem) => controller.current?.setVisibleSystems(state.visibleSystems.includes(id)
    ? state.visibleSystems.filter(s => s !== id) : [...state.visibleSystems, id]);
  return <>
    {brainOpen ? <div className="brain-study-heading">
      <button ref={backButton} type="button" className="brain-back" onClick={() => controller.current?.closeBrainView()}><ArrowLeft size={16}/>Back to anatomy</button>
      <div className="brain-study-title"><span className="anatomy-eyebrow">AN INTIMATE STUDY</span><h2>The living brain<span>.</span></h2><p>Cortex, vessels & quiet impulses</p></div>
      <span className="brain-study-note">Human-inspired · Fictional anatomy</span>
    </div> : null}
    {active && !brainOpen && state.brainView.available ? <div className="brain-entry" aria-live="polite">
      <button ref={brainButton} type="button" className="brain-open" aria-busy={state.brainView.status === 'loading'} disabled={state.brainView.status === 'loading'} onClick={() => openBrain('contextual')}>
        <Brain size={17} strokeWidth={1.5}/><span>{state.brainView.status === 'loading' ? 'Preparing brain view…' : state.brainView.status === 'error' ? 'Retry brain view' : 'Open brain view'}</span>{state.brainView.status === 'loading' ? <span className="loading-dot"/> : <ArrowUpRight size={15}/>}
      </button>
      {entry === 'contextual' && state.brainView.status === 'error' ? <span className="brain-entry-error">The close-up couldn’t load.</span> : null}
      {entry === 'contextual' && state.brainView.status === 'loading' ? <button type="button" className="brain-cancel" onClick={() => controller.current?.closeBrainView()}>Cancel</button> : null}
    </div> : null}
    {!brainOpen ? <fieldset className="anatomy-modebar" aria-label="View mode">
      {MODES.map(({ id, label, icon: Icon }) => <button key={id} ref={state.mode === id ? activeModeButton : undefined} type="button" aria-pressed={state.mode === id}
        disabled={!ready} onClick={() => { void controller.current?.setMode(id); }}><Icon size={16} strokeWidth={1.6}/>{label}</button>)}
    </fieldset> : null}
    {active && !brainOpen && selected ? <output className="anatomy-selection-badge"><Focus size={15}/><span>{selected.label}</span><button type="button" aria-label="Dismiss part highlight" onClick={() => controller.current?.selectPart(null)}><X size={15}/></button></output> : null}
    {state.status === 'loading' ? <output className="anatomy-load"><span className="loading-dot"/>Loading anatomy…</output> : null}
    {state.status === 'error' ? <output className="anatomy-load anatomy-load-error">The anatomy couldn’t load. <button type="button" onClick={() => { void controller.current?.setMode('split'); }}>Retry</button></output> : null}
    {active && !brainOpen ? <aside className="anatomy-panel" aria-label="Anatomy controls">
      <div className="anatomy-panel-heading"><div><span className="anatomy-eyebrow">BENEATH THE COAT</span><h2>Anatomy study<span>.</span></h2></div><span className="anatomy-index">02</span></div>
      <p className="anatomy-intro">An imagined anatomy, shaped for a forest spirit.</p>
      <div className="brain-shortcut-area" aria-live="polite">
        <button ref={shortcutButton} type="button" className="brain-shortcut"
          disabled={state.status !== 'ready' || state.brainView.status === 'loading'}
          aria-busy={entry === 'shortcut' && state.brainView.status === 'loading'} onClick={() => openBrain('shortcut')}>
          <Brain size={17} strokeWidth={1.5} aria-hidden="true"/>
          <span>{entry === 'shortcut' && state.brainView.status === 'loading' ? 'Preparing brain view…'
            : entry === 'shortcut' && state.brainView.status === 'error' ? 'Retry brain view' : 'Explore the brain'}</span>
          <ArrowUpRight size={15} aria-hidden="true"/>
        </button>
        {entry === 'shortcut' && state.brainView.status === 'error' ? <p className="brain-entry-error">The close-up couldn’t load. Please try again.</p> : null}
        {entry === 'shortcut' && state.brainView.status === 'loading' ? <button type="button" className="brain-cancel" onClick={() => controller.current?.closeBrainView()}>Cancel</button> : null}
      </div>
      <fieldset className="anatomy-variants cut-directions" aria-label="Reproductive anatomy variant">
        <legend>Anatomical variant</legend>
        {(['male', 'female'] as const).map(variant => <button key={variant} type="button" aria-pressed={state.variant === variant}
          onClick={() => controller.current?.setAnatomyVariant(variant)}>{variant === 'male' ? 'Male' : 'Female'}</button>)}
      </fieldset>
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
