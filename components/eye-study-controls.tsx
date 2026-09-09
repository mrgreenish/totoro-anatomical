'use client';

import { useEffect, useState, type RefObject } from 'react';
import { ArrowRight, Eye, Focus, Layers, Lightbulb, Palette, Sun, Zap } from 'lucide-react';
import type { SculptureController } from '@/lib/totoro-scene';
import { defaultEyeOptions, EYE_PARTS, EYE_SOURCES, eyeOptics, photoreceptorResponse, type EyeLesson, type EyeMode, type EyePart, type EyeViewOptions } from '@/lib/eye-optics';

const LESSONS:{id:EyeLesson;label:string;icon:typeof Eye;mode:EyeMode}[]=[
  {id:'parts',label:'Eye parts',icon:Layers,mode:'surface'},
  {id:'light',label:'Let light in',icon:Sun,mode:'surface'},
  {id:'focus',label:'Make it sharp',icon:Focus,mode:'cutaway'},
  {id:'color',label:'See colors',icon:Palette,mode:'retina'},
  {id:'signal',label:'Tell the brain',icon:Zap,mode:'cutaway'},
];
function OpticalDiagram({blur,near}:{blur:number;near:number}) {
  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- An inline SVG diagram needs its image role for assistive technology.
  return <svg className="eye-optics-diagram" viewBox="0 0 300 108" role="img" aria-label={blur>.1?'The rays have not met at the retina, making a blurred image.':'Light bends to form a small upside-down image at the retina.'}>
    <path d="M18 61H281" stroke="currentColor" opacity=".2" strokeDasharray="3 5"/>
    <path d="M28 61V24m-6 7 6-7 6 7" fill="none" stroke="#edc484" strokeWidth="3"/>
    <path d={`M148 22Q${near>50?124:137} 61 148 88Q${near>50?172:159} 61 148 22`} fill="#afd8de" fillOpacity=".2" stroke="#b5d7dc"/>
    <path d="M253 12Q275 61 253 96" fill="none" stroke="#d3957e" strokeWidth="4"/>
    <path d={`M28 24 148 38 263 ${blur>.1?63:77}M28 24 148 62 263 ${blur>.1?86:77}`} fill="none" stroke="#edc484" opacity=".8" strokeWidth="1.3"/>
    <path d="M261 61V78m-5-5 5 5 5-5" fill="none" stroke="#edc484" strokeWidth="2" opacity={blur>.1?.32:1}/>
    {blur>.1?<ellipse cx="262" cy="75" rx="5" ry="15" fill="#edc484" fillOpacity=".23"/>:null}
    <g fill="currentColor" fontSize="11"><text x="9" y="104">Object</text><text x="132" y="104">Lens</text><text x="242" y="104">Retina</text></g>
  </svg>;
}
export function EyeStudyControls({controller}:{controller:RefObject<SculptureController|null>}) {
  const [options,setOptions]=useState(defaultEyeOptions);
  useEffect(()=>{controller.current?.setEyeViewOptions(defaultEyeOptions());},[controller]);
  const change=(value:Partial<EyeViewOptions>)=>{
    const next={...options,...value};setOptions(next);controller.current?.setEyeViewOptions(value);
  };
  const lesson=(id:EyeLesson)=>{const item=LESSONS.find(l=>l.id===id)!;change({lesson:id,mode:item.mode,part:id==='focus'?'lens':id==='signal'?'nerve':'iris'});};
  const part=EYE_PARTS.find(p=>p.id===options.part)!;
  const optics=eyeOptics(options),response=photoreceptorResponse(options.wavelength);
  const pupilMM=(optics.pupil*24).toFixed(1);
  const lightControl=<div className="eye-range-group">
    <label htmlFor="eye-light">How bright is it?<output>{options.light<25?'Dim':options.light>75?'Bright':'Daylight'}</output></label>
    <input id="eye-light" type="range" min="0" max="100" value={options.light} onChange={e=>change({light:Number(e.target.value)})}/>
    <div className="eye-range-ends"><span>Moonlight</span><span>Sunshine</span></div>
  </div>;
  return <div className="eye-study-controls">
    <fieldset className="eye-view-modes" aria-label="Eye view">
      {([{id:'surface',label:'Whole eye'},{id:'cutaway',label:'Inside'},{id:'retina',label:'Rods & cones'}] as const).map(({id,label})=><button key={id} type="button" aria-pressed={options.mode===id} onClick={()=>change({mode:id,...(id==='retina'?{lesson:'color' as const}:{})})}>{label}</button>)}
    </fieldset>
    <fieldset className="eye-lessons" aria-label="Learn how the eye works">
      {LESSONS.map(({id,label,icon:Icon})=><button key={id} type="button" aria-pressed={options.lesson===id} onClick={()=>lesson(id)}><Icon size={15}/>{label}</button>)}
    </fieldset>
    <section className="eye-explanation" aria-label="Eye discovery">
      {options.lesson==='parts'?<>
        <label className="eye-part-label" htmlFor="eye-part">Choose a part</label>
        <select id="eye-part" value={options.part} onChange={e=>{const id=e.target.value as EyePart;change({part:id,mode:['cornea','iris','pupil','sclera'].includes(id)?'surface':'cutaway'});}}>
          {EYE_PARTS.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <h3>{part.nickname}</h3><p>{part.text}</p>
        <button className="eye-next-discovery" type="button" onClick={()=>lesson('light')}>Follow a little light<ArrowRight size={15}/></button>
      </>:null}
      {options.lesson==='light'?<>
        <span className="eye-lesson-kicker">01 / A CLEVER LITTLE DOOR</span>
        <h3>Too bright? Make it smaller.</h3>
        <p>The iris changes the size of the pupil. Move the slider and watch the opening grow or shrink.</p>
        {lightControl}
        <div className="eye-observation"><Lightbulb size={17}/><span>The pupil is about <strong>{pupilMM} mm</strong> across.</span></div>
        <button className="eye-next-discovery" type="button" onClick={()=>change({mode:options.mode==='cutaway'?'surface':'cutaway'})}>{options.mode==='cutaway'?'See the pupil again':'Follow light inside'}<ArrowRight size={15}/></button>
        {options.mode==='cutaway'?<p className="eye-small-note">The cornea bends light first. The lens finishes the focus. The picture on the retina is upside down.</p>:null}
      </>:null}
      {options.lesson==='focus'?<>
        <span className="eye-lesson-kicker">02 / THE FOCUS TEAM</span>
        <h3>A lens that changes shape.</h3>
        <p>{options.near>45?'For nearby things, the muscle ring tightens and the supporting fibers loosen. The lens can become rounder.':'For faraway things, the muscle relaxes. The supporting fibers pull the lens flatter.'}</p>
        <div className="eye-range-group"><label htmlFor="eye-near">Move an object closer<output>{options.near>60?'Near':options.near>25?'Moving closer':'Far away'}</output></label>
          <input id="eye-near" type="range" min="0" max="100" value={options.near} onChange={e=>change({near:Number(e.target.value),mode:'cutaway'})}/>
          <div className="eye-range-ends"><span>Across the room</span><span>In your hand</span></div>
        </div>
        <label className="eye-checkbox"><input type="checkbox" checked={options.accommodate} onChange={e=>change({accommodate:e.target.checked})}/><span>Let the lens focus</span></label>
        <OpticalDiagram blur={optics.blur} near={options.accommodate?options.near:0}/>
        <p className="eye-focus-result" aria-live="polite">{optics.blur>.1?'Blurry! The light has not met when it reaches the retina.':'Sharp! The rays meet on the retina.'}</p>
        <p className="eye-small-note">Try a near object with focusing turned off. The cornea still bends light, but the lens needs to help.</p>
      </>:null}
      {options.lesson==='color'?<>
        <span className="eye-lesson-kicker">03 / A TINY LIGHT GARDEN</span>
        <h3>Meet your rods and cones.</h3>
        <p>Cones help you see colors and detail. Rods are very sensitive in dim light, but do not tell colors apart.</p>
        <fieldset className="eye-cell-toggles" aria-label="Visible retinal cells">
          <label className="eye-checkbox"><input type="checkbox" checked={options.rods} onChange={e=>change({rods:e.target.checked,mode:'retina'})}/>Rods</label>
          <label className="eye-checkbox"><input type="checkbox" checked={options.cones} onChange={e=>change({cones:e.target.checked,mode:'retina'})}/>Cones</label>
        </fieldset>
        <div className="eye-range-group eye-spectrum"><label htmlFor="eye-wavelength">Change the light’s color<output>{options.wavelength} nm</output></label>
          <input id="eye-wavelength" type="range" min="400" max="700" value={options.wavelength} onChange={e=>change({wavelength:Number(e.target.value),mode:'retina'})}/>
          <div className="eye-range-ends"><span>Violet</span><span>Red</span></div>
        </div>
        <div className="eye-cone-response" aria-label="Illustrative cone sensitivity">
          {([{key:'s',label:'S · short waves',color:'#91b4ef'},{key:'m',label:'M · medium waves',color:'#87d0ad'},{key:'l',label:'L · long waves',color:'#e6a58f'}] as const).map(({key,label,color})=><div key={key}><span>{label}</span><meter min="0" max="1" value={response[key]} aria-label={`${label} sensitivity`} style={{accentColor:color}}/><span>{Math.round(response[key]*100)}%</span></div>)}
        </div>
        {lightControl}
        <p className="eye-small-note">Each color can wake up more than one kind of cone. Your brain compares their responses. Cell colors are a guide; real cones are not red, green, or blue.</p>
        {!options.rods&&!options.cones?<p className="eye-focus-result">Turn on rods or cones to see their light-catching tips.</p>:null}
      </>:null}
      {options.lesson==='signal'?<>
        <span className="eye-lesson-kicker">04 / FROM LIGHT TO SIGHT</span>
        <h3>Your brain joins the dots.</h3>
        <p>Rods and cones respond to light. Other cells in the retina pass the message along. The optic nerve carries electrical signals to the brain, which helps you recognize what you see.</p>
        <ol className="eye-message-steps"><li><span>1</span>Light reaches rods & cones</li><li><span>2</span>Retinal cells share the message</li><li><span>3</span>The optic nerve carries it onward</li><li><span>4</span>The brain makes sense of it</li></ol>
        <div className="eye-observation"><Zap size={17}/><span>Light stays in the eye. <strong>Electrical messages</strong> go to the brain.</span></div>
        <button className="eye-next-discovery" type="button" onClick={()=>change({lesson:'parts',part:'nerve',mode:'cutaway'})}>Find your blind spot<ArrowRight size={15}/></button>
      </>:null}
    </section>
    <div className="eye-study-foot"><label className="eye-checkbox"><input type="checkbox" checked={options.labels} onChange={e=>change({labels:e.target.checked})}/>Show labels</label><span>{options.mode==='retina'?'Cells enlarged · illustrative colors':options.mode==='cutaway'?'Illustrative light paths':'Human-inspired anatomy'}</span></div>
    <details className="eye-sources"><summary>Curious to learn more?</summary>{EYE_SOURCES.map(s=><a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.label}<ArrowRight size={12}/></a>)}</details>
  </div>;
}
