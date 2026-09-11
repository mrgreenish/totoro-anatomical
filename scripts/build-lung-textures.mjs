/** Original deterministic pleural lobules, subpleural microvasculature and microrelief.
 * The normal and roughness maps are derived from the same authored tissue field. */
import sharp from 'sharp';
import {mkdir,writeFile} from 'node:fs/promises';
const out='public/models/lung-detail';await mkdir(out,{recursive:true});
const W=2048,H=1024,N=W*H,heights=new Float32Array(N),colors=Buffer.alloc(N*3),rough=Buffer.alloc(N);
const clamp=n=>Math.max(0,Math.min(255,Math.round(n)));
const hash=(x,y)=>{let a=Math.imul(x+7381,374761393)^Math.imul(y+191,668265263);a=Math.imul(a^(a>>>13),1274126177);return ((a^(a>>>16))>>>0)/4294967295;};
const smooth=x=>x*x*(3-2*x),mix=(a,b,t)=>a+(b-a)*t;
function noise(x,y,period){let a=Math.floor(x),b=Math.floor(y),u=smooth(x-a),v=smooth(y-b);return mix(mix(hash((a%period+period)%period,b),hash(((a+1)%period+period)%period,b),u),mix(hash((a%period+period)%period,b+1),hash(((a+1)%period+period)%period,b+1),u),v);}
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const u=x/W,v=y/H,warp=noise(u*12,v*8,12),px=u*54+(warp-.5)*1.5,py=v*30+(noise(u*16,v*11,16)-.5)*1.4;
  const gx=Math.floor(px),gy=Math.floor(py);let f1=99,f2=99,cell=0;
  for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
    const cx=gx+i,cy=gy+j,wrapped=(cx%54+54)%54,dx=cx+.17+hash(wrapped,cy)*.66-px,dy=cy+.17+hash(wrapped+231,cy+37)*.66-py,d=dx*dx+dy*dy;
    if(d<f1){f2=f1;f1=d;cell=hash(wrapped+5,cy+15);}else if(d<f2)f2=d;
  }
  const border=Math.exp(-(Math.sqrt(f2)-Math.sqrt(f1))*52),broad=noise(u*9,v*6,9),fine=noise(u*340,v*180,340),pores=Math.pow(noise(u*800,v*390,800),5);
  const vascular=Math.exp(-Math.abs(Math.sin(v*48+u*6.2831853*4+warp*5))*55)*(0.3+noise(u*31,v*16,31)*.7);
  const tone=(broad-.5)*23+(cell-.5)*10+(fine-.5)*4,pigment=border*(3+cell*7)+vascular*10;
  const at=(y*W+x)*3;colors[at]=clamp(188+tone-pigment*.9);colors[at+1]=clamp(111+tone*.73-pigment*1.1);colors[at+2]=clamp(110+tone*.65-pigment*.78);
  heights[y*W+x]=.40+fine*.17-border*.10-pores*.07;
  rough[y*W+x]=clamp(142+(broad-.5)*28+border*15+pores*13);
}
const normal=Buffer.alloc(N*3);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const at=(y*W+x)*3,dx=(heights[y*W+(x+1)%W]-heights[y*W+(x-1+W)%W])*2.0,dy=(heights[Math.min(H-1,y+1)*W+x]-heights[Math.max(0,y-1)*W+x])*2.0,l=Math.hypot(dx,dy,1);
  normal[at]=clamp(128-dx/l*127);normal[at+1]=clamp(128+dy/l*127);normal[at+2]=clamp(128+127/l);
}
await Promise.all([
  sharp(colors,{raw:{width:W,height:H,channels:3}}).webp({quality:92}).toFile(`${out}/pleura-color.webp`),
  sharp(normal,{raw:{width:W,height:H,channels:3}}).webp({quality:91}).toFile(`${out}/pleura-normal.webp`),
  sharp(rough,{raw:{width:W,height:H,channels:1}}).webp({quality:86}).toFile(`${out}/pleura-roughness.webp`),
]);
// File-format conversion only: preserve the single generated original's pixels.
const photoSource='artwork/anatomy/lung-detail/pleura-source.png';
const photo=await sharp(photoSource).metadata();
await sharp(photoSource).webp({quality:94}).toFile(`${out}/pleura-photoreal.webp`);
await writeFile(`${out}/anatomy.json`,JSON.stringify({version:1,model:'Original procedural human-inspired lung study for Quiet Forest',textures:{albedo:{file:'pleura-photoreal.webp',method:'Single original image generated with built-in image_gen; artistic lung tissue, not a patient photograph. Mirrored repeat provides a continuous wrap.',resolution:[photo.width,photo.height],source:photoSource,provenance:'artwork/anatomy/lung-detail/texture-provenance.md'},microrelief:{method:'Deterministic periodic cellular tissue; correlated normal and roughness maps.',resolution:[W,H],source:'scripts/build-lung-textures.mjs',seed:'fixed integer hash'}},anatomy:'Three right lobes, two left lobes, cardiac notch, C-shaped tracheal cartilage, branching bronchi, diaphragm and enlarged alveolar-capillary interface.',limitations:'Educational model for a fictional character. Air particles, blood cells, membrane thickness and diffusion are enlarged and slowed. Air contains a mixture of gases. Blood is always red; dark red shows less oxygen. Lung tissue is not optically clear; airway mode is an explanatory reveal. Breathing is illustrative, not a physiological or clinical simulation.',sources:['https://www.nhlbi.nih.gov/health/lungs/respiratory-system','https://www.nhlbi.nih.gov/health/lungs/breathing-benefits','https://www.nhlbi.nih.gov/health/lungs/body-controls-breathing','https://www.ncbi.nlm.nih.gov/books/NBK470197/']},null,2));
console.log('Wrote original lung tissue maps and converted the generated albedo.');
