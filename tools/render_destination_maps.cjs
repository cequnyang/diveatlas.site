/* Batch static map generation; shared browser and bounded provider concurrency. */
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),output=path.join(root,'assets/destination-maps');
const reports=path.join(root,'artifacts/destination-layout-rollout-20261111');
const styleUrl='https://tiles.openfreemap.org/styles/positron',rendererUrl='https://unpkg.com/maplibre-gl@5.8.0/dist/maplibre-gl.js';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function framing(sites){
  // Find the shortest occupied longitude arc to preserve dateline geography.
  const sorted=sites.map(s=>(s.lon+360)%360).sort((a,b)=>a-b);
  let gap=-1,start=sorted[0];
  for(let i=0;i<sorted.length;i++){const next=sorted[(i+1)%sorted.length]+(i===sorted.length-1?360:0);if(next-sorted[i]>gap){gap=next-sorted[i];start=next%360;}}
  const xs=sites.map(s=>{let x=(s.lon+360)%360;return x<start-1e-8?x+360:x;});
  const shift=Math.floor((xs.reduce((a,b)=>a+b,0)/xs.length+180)/360)*360;
  const x=xs.map(v=>v-shift),y=sites.map(s=>s.lat);
  const center=[x.reduce((a,b)=>a+b,0)/x.length,y.reduce((a,b)=>a+b,0)/y.length];
  const bounds=[Math.min(...x),Math.min(...y),Math.max(...x),Math.max(...y)];
  if(bounds[2]-bounds[0]<.04){bounds[0]=center[0]-.02;bounds[2]=center[0]+.02;}
  if(bounds[3]-bounds[1]<.04){bounds[1]=center[1]-.02;bounds[3]=center[1]+.02;}
  return {center,bounds};
}
async function main(){
  const jobs=JSON.parse(await fs.readFile(path.join(reports,'map-jobs.json'),'utf8'));
  const styleResponse=await fetch(styleUrl);if(!styleResponse.ok)throw Error('Style unavailable');const styleText=await styleResponse.text();
  const rendererResponse=await fetch(rendererUrl);if(!rendererResponse.ok)throw Error('Renderer unavailable');const renderer=await rendererResponse.text();
  const shell=await fs.readFile(path.join(root,'tools/templates/destination-map.html'),'utf8');
  await fs.mkdir(output,{recursive:true});
  const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:600,height:600},deviceScaleFactor:1,userAgent:'DiveAtlasDestinationPreview/1.0 (+https://diveatlas.site)'});
  let active=0,bytes=0;const waiting=[],cache=new Map();
  await context.route('https://tiles.openfreemap.org/**',async route=>{
    const key=route.request().url()+'|'+(route.request().headers().range||'');
    if(cache.has(key)){await route.fulfill(cache.get(key));return;}
    if(active>=4)await new Promise(resolve=>waiting.push(resolve));active++;
    try{const response=await route.fetch({timeout:45000}),body=await response.body(),result={status:response.status(),headers:response.headers(),body};
      if(response.ok()&&body.length<2000000){while(bytes+body.length>40000000&&cache.size){const first=cache.keys().next().value;bytes-=cache.get(first).body.length;cache.delete(first);}cache.set(key,result);bytes+=body.length;}
      await route.fulfill(result);
    }catch{await route.abort().catch(()=>{});}finally{active--;waiting.shift()?.();}
  });
  let page,rendered=0,cached=0;const failures=[];
  async function open(){
    if(page)await page.close();page=await context.newPage();await page.setContent(shell);await page.addScriptTag({content:renderer});
    await page.evaluate(async style=>{
      window.mapErrors=[];window.previewMap=new maplibregl.Map({container:'map',style,center:[0,0],zoom:0,interactive:false,attributionControl:false,fadeDuration:0,preserveDrawingBuffer:true,renderWorldCopies:false});
      previewMap.on('error',e=>mapErrors.push(e.error?.message||'Map resource failed'));
      await new Promise((resolve,reject)=>{previewMap.once('load',resolve);setTimeout(()=>reject(Error('Map load timeout')),45000);});
      previewMap.addSource('marker',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
      previewMap.addLayer({id:'halo',type:'circle',source:'marker',paint:{'circle-radius':15,'circle-color':'#fff','circle-opacity':.65}});
      previewMap.addLayer({id:'point',type:'circle',source:'marker',paint:{'circle-radius':8,'circle-color':'#246b72','circle-stroke-width':3,'circle-stroke-color':'#fff'}});
    },JSON.parse(styleText));
  }
  try{for(const job of jobs){
    const inputs={schema:2,region:job.path,...framing(job.sites),size:600,padding:66,maxZoom:11,styleUrl,styleHash:hash(styleText),rendererUrl,marker:'centre-v1',compass:'rose-v1',attribution:'page-overlay-v1'};
    const fingerprint=hash(JSON.stringify(inputs)),file=`${job.key}-${fingerprint.slice(0,16)}.png`,target=path.join(output,job.key+'.json');
    let old;try{old=JSON.parse(await fs.readFile(target,'utf8'));}catch{}
    if(!process.argv.includes('--force')&&old?.fingerprint===fingerprint&&await fs.stat(path.join(output,file)).then(()=>true,()=>false)){cached++;continue;}
    for(let attempt=0;attempt<3;attempt++){try{
      if(!page||attempt||rendered%40===0)await open();
      const camera=await page.evaluate(async inputs=>{
        mapErrors.length=0;previewMap.fitBounds(inputs.bounds,{padding:inputs.padding,maxZoom:inputs.maxZoom,duration:0});
        previewMap.getSource('marker').setData({type:'Feature',geometry:{type:'Point',coordinates:inputs.center}});
        await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Map idle timeout')),45000);previewMap.once('idle',()=>{clearTimeout(timer);resolve();});});
        if(mapErrors.length)throw Error(mapErrors.join('; '));const p=previewMap.project(inputs.center);return {center:previewMap.getCenter().toArray(),zoom:previewMap.getZoom(),markerPixel:[p.x,p.y]};
      },inputs);
      await page.screenshot({path:path.join(output,file)});
      const lng=((camera.center[0]+180)%360+360)%360-180;
      await fs.writeFile(target,JSON.stringify({fingerprint,inputs,camera,src:`/assets/destination-maps/${file}`,mapHref:`/?lat=${camera.center[1].toFixed(5)}&lng=${lng.toFixed(5)}&z=${camera.zoom.toFixed(2)}&layers=dive`,markerMeaning:'Mean of recorded destination site coordinates; not an individual dive site',renderedAt:new Date().toISOString(),attribution:['OpenFreeMap','© OpenMapTiles','© OpenStreetMap contributors']},null,2)+'\n');
      rendered++;console.log(`${rendered+cached}/${jobs.length} ${job.name}`);break;
    }catch(error){if(attempt===2)failures.push({path:job.path,error:error.message});}}
  }}finally{await browser.close();}
  const report={total:jobs.length,rendered,cached,failures};await fs.writeFile(path.join(reports,'map-render-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(failures.length)process.exitCode=1;
}
module.exports={main,framing};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
