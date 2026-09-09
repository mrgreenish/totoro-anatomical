import * as THREE from 'three';

type Options = { canvas: HTMLCanvasElement; camera: THREE.Camera; root: THREE.Group; wake(): void; reduced: boolean };
type Shader = { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string };

/** Surface-bound emission: no overlay sprites can shine through the back of the brain. */
export const NEURON_GLSL = `
  uniform vec3 brainHoverPoint;
  uniform vec3 brainHoverNormal;
  uniform float brainHoverLevel;
  uniform float brainActivityTime;
  uniform float brainStillActivity;
  varying vec3 vBrainRestPosition;
  // Distance, soft light and travelling pulse along one dendritic segment.
  vec2 neuralFilament(vec2 p, vec2 a, vec2 b, float travel, float start, float width) {
    vec2 ab=b-a;
    float t=clamp(dot(p-a,ab)/max(dot(ab,ab),.000001),0.,1.);
    float d=length(p-a-ab*t);
    float pulse=exp(-pow((start+t*length(ab)-travel)/.018,2.));
    pulse=mix(pulse,.38,brainStillActivity);
    float core=exp(-pow(d/width,2.));
    float halo=exp(-pow(d/.009,2.));
    return vec2(core*pulse,halo*pulse);
  }
  vec3 firingNeurons(vec3 p) {
    if (brainHoverLevel<.001) return vec3(0.);
    vec3 delta=p-brainHoverPoint;
    float distance3=length(delta);
    if (distance3>.32) return vec3(0.);
    vec3 n=normalize(brainHoverNormal);
    vec3 t=normalize(cross(n,abs(n.y)<.9?vec3(0.,1.,0.):vec3(1.,0.,0.)));
    vec2 uv=vec2(dot(delta,t),dot(delta,cross(n,t)));
    float depth=exp(-abs(dot(delta,n))*18.);
    vec2 light=vec2(0.);
    // Six asymmetric dendrites, each dividing into fine terminal branches.
    for (int i=0;i<6;i++) {
      float seed=float(i);
      float angle=seed*1.0472+.17*sin(seed*7.3);
      vec2 direction=vec2(cos(angle),sin(angle));
      vec2 side=vec2(-direction.y,direction.x);
      vec2 a=direction*.012;
      vec2 b=direction*(.061+.014*sin(seed*3.4))+side*.019*sin(seed*8.1);
      vec2 c=direction*(.12+.024*cos(seed*5.1))+side*.031*cos(seed*2.4);
      float travel=mod(brainActivityTime*.145+seed*.027,.49)-.075;
      float ab=length(b-a),bc=length(c-b);
      light+=neuralFilament(uv,a,b,travel,0.,.0016);
      light+=neuralFilament(uv,b,c,travel,ab,.0012);
      for (int j=0;j<2;j++) {
        float signBranch=float(j)*2.-1.;
        vec2 d=c+direction*(.046+.011*sin(seed))+side*signBranch*(.032+.009*cos(seed));
        vec2 e=b+direction*.021+side*signBranch*.045;
        light+=neuralFilament(uv,c,d,travel,ab+bc,.0008);
        light+=neuralFilament(uv,b,e,travel,ab,.00085);
        float synapse=exp(-pow((ab+bc+length(d-c)-travel)/.025,2.));
        synapse=mix(synapse,.2,brainStillActivity);
        light+=vec2(exp(-pow(length(uv-d)/.0025,2.)),exp(-pow(length(uv-d)/.014,2.)))*synapse;
      }
    }
    float soma=mix(pow(.5+.5*sin(brainActivityTime*2.1),5.),.3,brainStillActivity);
    light+=vec2(exp(-dot(uv,uv)/.000015),exp(-dot(uv,uv)/.0007))*soma*.65;
    float envelope=(1.-smoothstep(.21,.30,distance3))*depth*brainHoverLevel;
    // Ivory spark cores, blue-green electrical haze, and a warm tissue bloom.
    return (vec3(1.,.89,.65)*light.x*3.2+vec3(.19,.55,.66)*light.y*.65+
      vec3(.34,.09,.035)*light.y*.22)*envelope;
  }
`;

export function createBrainActivity(o: Options) {
  const uniforms = {
    brainHoverPoint: { value: new THREE.Vector3() }, brainHoverNormal: { value: new THREE.Vector3(0,0,1) },
    brainHoverLevel: { value: 0 }, brainActivityTime: { value: 0 }, brainStillActivity: { value: o.reduced ? 1 : 0 },
  };
  const meshes: THREE.Mesh[] = [], ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const normalMatrix = new THREE.Matrix3(), desiredPoint = new THREE.Vector3(), desiredNormal = new THREE.Vector3(0,0,1);
  let enabled=false, inside=false, target=0, pending=false, cooldown=0, touching=false;
  function leave() { inside=false;pending=false;target=0;touching=false;o.wake(); }
  function pointer(event: PointerEvent) {
    if (!enabled || !event.isPrimary) return;
    if (event.type==='pointerdown') touching=event.pointerType==='touch';
    const rect=o.canvas.getBoundingClientRect();
    ndc.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    inside=true;pending=true;o.wake();
  }
  function up(event: PointerEvent) { if (event.pointerType==='touch') leave(); }
  function probe() {
    o.camera.updateMatrixWorld(true);o.root.updateMatrixWorld(true);ray.setFromCamera(ndc,o.camera);
    const hit=ray.intersectObjects(meshes,false)[0];
    if (hit?.face) {
      desiredPoint.copy(hit.point);
      desiredNormal.copy(hit.face.normal).applyNormalMatrix(normalMatrix.getNormalMatrix(hit.object.matrixWorld));
      if (!target && uniforms.brainHoverLevel.value<.02) {
        uniforms.brainHoverPoint.value.copy(desiredPoint);uniforms.brainHoverNormal.value.copy(desiredNormal);
      }
      target=1;
    } else target=0;
  }
  const visibility=()=>{if(document.hidden)leave();};
  const capture={capture:true,passive:true};
  // Registered before tissue dragging so a grab cannot swallow contact discovery.
  o.canvas.addEventListener('pointermove',pointer,capture);o.canvas.addEventListener('pointerdown',pointer,capture);
  o.canvas.addEventListener('pointerup',up,capture);o.canvas.addEventListener('pointerleave',leave);
  o.canvas.addEventListener('pointercancel',leave);window.addEventListener?.('blur',leave);
  document.addEventListener?.('visibilitychange',visibility);
  return {
    uniforms,
    apply(shader: Shader) {
      Object.assign(shader.uniforms,uniforms);
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vBrainRestPosition;')
        .replace('#include <begin_vertex>','#include <begin_vertex>\nvBrainRestPosition=(modelMatrix*vec4(position,1.)).xyz;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\n${NEURON_GLSL}`)
        .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=firingNeurons(vBrainRestPosition);');
    },
    setEnabled(value: boolean) {
      enabled=value;meshes.length=0;leave();uniforms.brainHoverLevel.value=0;
      if (value) o.root.traverse(node=>{if(node instanceof THREE.Mesh&&(node.material as THREE.MeshStandardMaterial).map)meshes.push(node);});
    },
    update(dt: number, animated: boolean) {
      if(!enabled)return false;
      cooldown-=dt;
      // Re-probe a stationary cursor after orbit/zoom too. At most 12.5 Hz.
      if(inside&&cooldown<=0&&(pending||!touching)){probe();pending=false;cooldown=.08;}
      const level=uniforms.brainHoverLevel,amount=o.reduced?1:1-Math.exp(-dt*7);
      level.value=THREE.MathUtils.lerp(level.value,target,amount);
      if(Math.abs(level.value-target)<.001)level.value=target;
      uniforms.brainHoverPoint.value.lerp(desiredPoint,amount);
      uniforms.brainHoverNormal.value.lerp(desiredNormal,amount).normalize();
      if(animated&&!o.reduced&&level.value>.001)uniforms.brainActivityTime.value+=dt;
      return level.value!==target||(animated&&!o.reduced&&level.value>.001)||pending;
    },
    dispose() {
      enabled=false;meshes.length=0;leave();uniforms.brainHoverLevel.value=0;
      o.canvas.removeEventListener('pointermove',pointer,capture);o.canvas.removeEventListener('pointerdown',pointer,capture);
      o.canvas.removeEventListener('pointerup',up,capture);o.canvas.removeEventListener('pointerleave',leave);
      o.canvas.removeEventListener('pointercancel',leave);window.removeEventListener?.('blur',leave);
      document.removeEventListener?.('visibilitychange',visibility);
    },
  };
}
