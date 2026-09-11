export type LungMode = 'surface' | 'airways' | 'alveoli';
export type LungViewOptions = { mode: LungMode; playing: boolean; speed: number; phase: number; labels: boolean };
export const defaultLungOptions = (): LungViewOptions => ({mode:'surface',playing:true,speed:1,phase:.06,labels:true});
const bounded = (n:number,min:number,max:number,fallback:number) => Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;
export function normalizeLungOptions(value:LungViewOptions):LungViewOptions {
  return {mode:['surface','airways','alveoli'].includes(value.mode)?value.mode:'surface',playing:!!value.playing,
    speed:bounded(value.speed,.35,1.5,1),phase:bounded(value.phase,0,1,0),labels:!!value.labels};
}
/** A five-second illustrative quiet breath: inspiration is shorter than passive expiration.
 * Flow is the derivative of relative tidal expansion; no flow at the turning points.
 * Zero is the resting end-expiratory level, never an empty lung. */
export function lungCycle(phase:number) {
  const p=Number.isFinite(phase)?((phase%1)+1)%1:0;
  const inhaling=p<.4,t=inhaling?p/.4:(p-.4)/.6;
  const inflation=(1+(inhaling?-1:1)*Math.cos(Math.PI*t))/2;
  const flow=(inhaling?1:-1)*Math.sin(Math.PI*t)*(inhaling?1:2/3);
  return {phase:p,inhaling,inflation,flow,diaphragmDrop:inflation*.28,domeHeight:.35-inflation*.22};
}
export type LungSnapshot = ReturnType<typeof lungCycle> & {running:boolean;mode:LungMode};
export const LUNG_SOURCES = [
  {label:'NIH · The respiratory system',url:'https://www.nhlbi.nih.gov/health/lungs/respiratory-system'},
  {label:'NIH · Breathing and gas exchange',url:'https://www.nhlbi.nih.gov/health/lungs/breathing-benefits'},
  {label:'NIH · The diaphragm',url:'https://www.nhlbi.nih.gov/health/lungs/body-controls-breathing'},
];
