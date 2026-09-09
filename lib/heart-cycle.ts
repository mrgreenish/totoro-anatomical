/** One shared clock drives muscle, valves, fluid advection and the phase label. */
export const HEART_BPM = 72;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x-a)/(b-a))); return t*t*(3-2*t);
};
export function cardiacCycle(seconds: number) {
  const phase = ((seconds * HEART_BPM / 60) % 1 + 1) % 1;
  const contraction = smooth(.13,.26,phase)*(1-smooth(.44,.60,phase));
  const outflow = smooth(.19,.235,phase)*(1-smooth(.45,.50,phase));
  const av = 1-smooth(.12,.16,phase)+smooth(.54,.585,phase);
  const filling = av*(.20+.8*Math.exp(-(((phase-.65)/.095)**2))+.45*Math.exp(-(((phase-.045)/.065)**2)));
  return { phase, contraction, outflow, av, filling,
    label: phase<.13 ? 'Atrial contraction' : phase<.19 ? 'Pressure rising' : phase<.50 ? 'Ventricular ejection' : phase<.55 ? 'Relaxation' : 'Ventricular filling' };
}

export const HEART_DEFORMATION = /* glsl */`
uniform float heartContraction;
uniform float heartInterior;
vec3 heartDeform(vec3 p) {
  float w=1.0-smoothstep(-.18,.43,p.y);
  float squeeze=heartContraction*w;
  float radial=mix(.085,.25,heartInterior);
  vec2 axis=vec2(.08+.13*clamp(-p.y,0.0,1.0),.035);
  float twist=squeeze*.085;
  mat2 spin=mat2(cos(twist),-sin(twist),sin(twist),cos(twist));
  p.xz=axis+spin*((p.xz-axis)*(1.0-radial*squeeze));
  p.y+=(-.12-p.y)*.08*squeeze;
  return p;
}
vec3 heartNormal(vec3 p,vec3 n) {
  vec3 axis=abs(n.y)<.96?vec3(0.0,1.0,0.0):vec3(1.0,0.0,0.0);
  vec3 t=normalize(cross(n,axis));
  vec3 b=cross(n,t);
  vec3 at=heartDeform(p);
  return normalize(cross(heartDeform(p+t*.0004)-at,heartDeform(p+b*.0004)-at));
}
`;

export function deformHeartPoint(x: number, y: number, z: number, contraction: number, interior = 1) {
  const w=1-smooth(-.18,.43,y), squeeze=contraction*w;
  const axis=.08+.13*Math.max(0,Math.min(1,-y));
  const radial=1-(.085+.165*interior)*squeeze, t=squeeze*.085;
  const px=(x-axis)*radial,pz=(z-.035)*radial;
  return [axis+Math.cos(t)*px+Math.sin(t)*pz,y+(-.12-y)*.08*squeeze,.035-Math.sin(t)*px+Math.cos(t)*pz];
}
