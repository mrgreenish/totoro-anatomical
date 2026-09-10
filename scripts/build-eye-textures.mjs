/** Deterministic, authored tissue maps. No source photos or network requests. */
import {mkdir, writeFile} from 'node:fs/promises';
import sharp from 'sharp';
const destination = 'public/models/eye-detail';
await mkdir(destination, {recursive:true});
let seed = 83427;
const random = () => ((seed = Math.imul(seed,1664525)+1013904223>>>0) / 4294967296);
const clamp = v => Math.min(255,Math.max(0,Math.round(v)));
const width = 2048, height = 1024;
const diffuse = Buffer.alloc(width*height*3), normal = Buffer.alloc(width*height*3);
const vessels = new Float32Array(width*height);
function dab(x,y,r,opacity) {
  for(let iy=Math.floor(y-r*2);iy<=y+r*2;iy++)for(let ix=Math.floor(x-r*2);ix<=x+r*2;ix++) {
    if(iy<0||iy>=height)continue;
    const d=((ix-x)**2+(iy-y)**2)/(r*r);
    if(d>4)continue;
    const index=iy*width+(ix%width+width)%width;
    vessels[index]=Math.max(vessels[index],Math.exp(-d*1.7)*opacity);
  }
}
function vessel(x,y,angle,length,r,depth) {
  let oldX=x,oldY=y;
  for(let i=0;i<length;i+=1.8) {
    angle+=(random()-.5)*.14;
    x+=Math.cos(angle)*1.8; y+=Math.sin(angle)*1.8;
    dab((x+oldX)/2,(y+oldY)/2,r*(1-i/length*.65),.62-depth*.11);
    if(depth<2&&i>length*.18&&random()<.021)vessel(x,y,angle+(random()<.5?-1:1)*(.3+random()*.5),length*.38,r*.57,depth+1);
    oldX=x;oldY=y;
  }
}
// Episcleral branches run toward the limbus; clear cornea stays avascular.
for(let i=0;i<45;i++)vessel(random()*width,height*(.17+random()*.52),-Math.PI/2+(random()-.5)*1.15,90+random()*300,1.1+random()*1.7,0);
for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
  const at=(y*width+x)*3, u=x/width*Math.PI*2,v=y/height;
  const grain=(random()-.5)*4;
  const mottle=Math.sin(u*11+Math.sin(v*29))*Math.sin(v*47+u*7)*1.5;
  const limbus=Math.exp(-v*50),back=Math.max(0,v-.68)*16;
  const base=[225-limbus*23-back,221-limbus*14-back*1.5,209-limbus*7-back*1.8];
  const red=[172,74,72],blood=vessels[y*width+x]*.61;
  for(let c=0;c<3;c++)diffuse[at+c]=clamp(base[c]*(1-blood)+red[c]*blood+grain+mottle);
  const relief=(random()-.5)*9;
  normal[at]=clamp(128+relief+Math.sin(u*210+v*90)*2);
  normal[at+1]=clamp(128+(random()-.5)*7);normal[at+2]=254;
}
await sharp(diffuse,{raw:{width,height,channels:3}}).webp({quality:91}).toFile(`${destination}/sclera-color.webp`);
await sharp(normal,{raw:{width,height,channels:3}}).webp({quality:89}).toFile(`${destination}/sclera-normal.webp`);
const retina=Buffer.alloc(width*height*3);
for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
  const at=(y*width+x)*3,u=x/width*Math.PI*2,v=y/height;
  const mottling=Math.sin(u*45+Math.sin(v*42)*3)*Math.sin(v*85+u*22)*3+(random()-.5)*7;
  const blood=vessels[y*width+x]*.35;
  retina[at]=clamp(165+mottling-blood*80);
  retina[at+1]=clamp(77+mottling-blood*40);
  retina[at+2]=clamp(43+mottling*.7-blood*10);
}
await sharp(retina,{raw:{width,height,channels:3}}).resize(1024,512).webp({quality:88}).toFile(`${destination}/retina-color.webp`);
await writeFile(`${destination}/anatomy.json`,JSON.stringify({
  version:1,model:'Human-inspired eye for the Quiet Forest anatomy study',units:'1 unit = approximately 12 mm',
  geometry:'Procedural concentric ocular coats, aspheric corneal cap, deformable annular iris, biconvex lens, ciliary processes, zonular fibers, optic nerve, magnified retinal tissue.',
  textures:{sclera:'Deterministic original collagen microrelief and branching episcleral vessels',retina:'Original pigmented tissue mottling; major retinal vessels are modeled separately',iris:'Original generated iris albedo; see artwork/anatomy/eye-detail/iris-provenance.md'},
  limitations:'Human-inspired educational model, not a clinical simulator. Ray paths are schematic. Lens uses one equivalent refractive index rather than a full gradient. Retinal cells are enlarged and color-coded; population and spectral responses are illustrative.',
  sources:['https://www.nei.nih.gov/learn-about-eye-health/healthy-vision/how-eyes-work','https://www.nei.nih.gov/eye-health-information/healthy-vision/nei-for-kids/about-eye','https://www.ncbi.nlm.nih.gov/books/NBK11079/']
},null,2));
console.log('Original sclera, normal, and retinal maps written.');
