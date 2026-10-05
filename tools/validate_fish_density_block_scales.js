#!/usr/bin/env node
'use strict';

// Compare grouped-site holdout designs while purging nearby cross-block sites.
// This is read-only and uses the processed survey-site means, not production assets.
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const ROOT = path.resolve(__dirname, '..');
const RADII = [100, 250, 500, 750, 1000, 1500, 2500];
const BLOCK_KM = [100, 250, 500, 750, 1000];
const BANDS = [[0,25],[25,50],[50,100],[100,250],[250,500],[500,1000],[1000,1500],[1500,2000],[2000,2500],[2500,Infinity]];
const EARTH_KM = 6371.0088, DECAY_KM = 250, MIN_SITES = 3, MIN_EFFECTIVE = 2.5, BUCKET = 5;
const rad = d => d * Math.PI / 180;
const normLng = x => ((x + 180) % 360 + 360) % 360 - 180;
function distance(a,b) {
  const p1=rad(a.lat), p2=rad(b.lat), dp=p2-p1, dl=rad(normLng(b.lng-a.lng));
  const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return EARTH_KM*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
function add(index,p) {
  const k=`${Math.floor((p.lat+90)/BUCKET)}:${Math.floor((normLng(p.lng)+180)/BUCKET)}`;
  if(!index.has(k))index.set(k,[]); index.get(k).push(p);
}
function near(index,p,radius) {
  const latR=radius/110.574, lngR=Math.min(180,radius/Math.max(11.1,111.32*Math.cos(rad(p.lat))));
  const y0=Math.max(0,Math.floor((Math.max(-90,p.lat-latR)+90)/BUCKET));
  const y1=Math.min(35,Math.floor((Math.min(90,p.lat+latR)+90)/BUCKET));
  const cx=Math.floor((normLng(p.lng)+180)/BUCKET), nx=360/BUCKET;
  const offs=lngR>=180?Array.from({length:nx},(_,i)=>i-cx):Array.from({length:Math.ceil(2*lngR/BUCKET)+2},(_,i)=>i-Math.ceil(lngR/BUCKET));
  const xs=[...new Set(offs.map(o=>((cx+o)%nx+nx)%nx))], out=[];
  for(let y=y0;y<=y1;y++)for(const x of xs)for(const q of index.get(`${y}:${x}`)||[]) {
    if(q===p)continue; const d=distance(p,q); if(d<=radius)out.push({site:q,d});
  }
  return out;
}
function blockId(p, size) {
  const latStep=size/110.574, row=Math.floor((p.lat+90)/latStep);
  const center=-90+(row+.5)*latStep, lonStep=Math.min(360,size/Math.max(0.5,111.32*Math.cos(rad(center))));
  const col=Math.floor((normLng(p.lng)+180)/lonStep);
  return `${row}:${col}`;
}
function region(p) {
  const {lat,lng}=p;
  if(lat>=5&&lat<=30&&lng>=-100&&lng<=-55)return 'Caribbean';
  if(lat>=12&&lat<=30&&lng>=32&&lng<=44)return 'Red Sea';
  if(lat>=30&&lat<=46&&lng>=-6&&lng<=36)return 'Mediterranean';
  if(lat>=-25&&lat<=-10&&lng>=142&&lng<=154)return 'Great Barrier Reef / Australia';
  const poly=[[95,-12],[130,-12],[141,-6],[141,20],[120,20],[95,10]];
  let inside=false; for(let i=0,j=poly.length-1;i<poly.length;j=i++) {const [xi,yi]=poly[i],[xj,yj]=poly[j];if(((yi>lat)!==(yj>lat))&&lng<(xj-xi)*(lat-yi)/(yj-yi)+xi)inside=!inside;}
  if(inside)return 'Coral Triangle / Southeast Asia';
  if(lat>=-35&&lat<=16&&lng>=30&&lng<=52)return 'East Africa';
  if(lat>=-35&&lat<=25&&lng>=45&&lng<=100)return 'Indian Ocean';
  if(lat>=-30&&lat<=30&&(lng>=140||lng<=-100))return 'Pacific Islands';
  if(lat>=-50&&lat<=50&&lng>=-60&&lng<=20)return 'Atlantic islands';
  return 'Other';
}
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const quantile=(a,q)=>{if(!a.length)return null;const s=a.slice().sort((x,y)=>x-y),i=(s.length-1)*q,lo=Math.floor(i),hi=Math.ceil(i);return s[lo]+(s[hi]-s[lo])*(i-lo);};
function ranks(a){const ix=a.map((v,i)=>[v,i]).sort((x,y)=>x[0]-y[0]),r=Array(a.length);for(let i=0;i<ix.length;){let j=i+1;while(j<ix.length&&ix[j][0]===ix[i][0])j++;const m=(i+j-1)/2+1;for(let k=i;k<j;k++)r[ix[k][1]]=m;i=j;}return r;}
function spearman(a,b){if(a.length<3)return null;const x=ranks(a),y=ranks(b),mx=avg(x),my=avg(y);let c=0,vx=0,vy=0;for(let i=0;i<x.length;i++){const dx=x[i]-mx,dy=y[i]-my;c+=dx*dy;vx+=dx*dx;vy+=dy*dy;}return vx&&vy?c/Math.sqrt(vx*vy):null;}
function summarize(rows, baseline) {
  const e=rows.map(r=>r.pred-r.actual), ae=e.map(Math.abs), le=rows.map(r=>Math.abs(Math.log1p(Math.max(0,r.pred))-Math.log1p(Math.max(0,r.actual))));
  const actual=rows.map(r=>r.actual), predicted=rows.map(r=>r.pred), d=rows.map(r=>r.nearestKm);
  const median=a=>quantile(a,.5);
  return {n:rows.length,coveragePercent:100*rows.length/(baseline.totalSites||1),mae:avg(ae),rmse:e.length?Math.sqrt(avg(e.map(x=>x*x))):null,
    bias:avg(e),medianAbsoluteLogError:median(le),p90AbsoluteLogError:quantile(le,.9),p90AbsoluteError:quantile(ae,.9),
    spearman:spearman(predicted,actual),medianNearestSupportKm:median(d),p90NearestSupportKm:quantile(d,.9)};
}
function predict(candidates,radius) {
  const a=candidates.filter(x=>x.d<=radius);
  const direct=a.filter(x=>x.d<=25).sort((x,y)=>x.d-y.d)[0];
  if(direct)return {pred:direct.site.value,nearestKm:direct.d,sourceCount:1,effectiveSources:1,direct:true};
  if(a.length<MIN_SITES)return null;
  let sw=0,sw2=0,sv=0;for(const x of a){const w=1/(1+(x.d/DECAY_KM)**3);sw+=w;sw2+=w*w;sv+=w*x.site.value;}
  const neff=sw2?sw*sw/sw2:0;if(neff<MIN_EFFECTIVE)return null;
  return {pred:sv/sw,nearestKm:Math.min(...a.map(x=>x.d)),sourceCount:a.length,effectiveSources:neff};
}

async function main(){
  const coverageData=JSON.parse(await fs.readFile(path.join(ROOT,'reports','fish-density-coverage-diagnostics.json'),'utf8'));
  const gz=await fs.readFile(path.join(ROOT,'data','fish_map_units.json.gz'));
  const snapshot=JSON.parse(zlib.gunzipSync(gz).toString('utf8')), groups=new Map();
  for(const row of snapshot.rows||[]){const lat=Number(row[0]),lng=normLng(Number(row[1])),value=Number(row[2]);if(!Number.isFinite(lat+lng+value)||value<0)continue;const k=`${lat.toFixed(5)}:${lng.toFixed(5)}`;const g=groups.get(k)||{lat,lng,sum:0,n:0};g.sum+=value;g.n++;groups.set(k,g);}
  const sites=[...groups.values()].map(g=>({lat:g.lat,lng:g.lng,value:g.sum/g.n}));
  for(const p of sites)p.region=region(p);
  const globalMedian=quantile(sites.map(p=>p.value),.5), index=new Map();for(const p of sites)add(index,p);
  const schemes=[...BLOCK_KM.map(km=>({name:`${km} km buffered spatial blocks`,kind:'block',km,bufferKm:km/2})),...Array.from(new Set(sites.map(s=>s.region))).map(name=>({name:`Leave ${name} screening region out`,kind:'region',region:name,bufferKm:500}))];
  const predictions=Object.fromEntries(schemes.map(s=>[s.name,Object.fromEntries(RADII.map(r=>[r,[]]))]));
  const distanceRows=Object.fromEntries(RADII.map(r=>[r,[]]));
  for(let i=0;i<sites.length;i++){
    const target=sites[i], neighbors=near(index,target,2500), exactBlock=new Map(BLOCK_KM.map(km=>[km,blockId(target,km)]));
    const schemeCandidates=new Map();
    for(const scheme of schemes){
      if(scheme.kind==='block')schemeCandidates.set(scheme.name,neighbors.filter(x=>blockId(x.site,scheme.km)!==exactBlock.get(scheme.km)&&x.d>=scheme.bufferKm));
      else schemeCandidates.set(scheme.name,neighbors.filter(x=>x.site.region!==scheme.region&&x.d>=scheme.bufferKm));
    }
    for(const radius of RADII){
      // Fully site-grouped LOO is retained as the local interpolation reference.
      const pred=predict(neighbors,radius);if(pred)distanceRows[radius].push({actual:target.value,...pred});
      for(const scheme of schemes){const result=predict(schemeCandidates.get(scheme.name),radius);if(result)predictions[scheme.name][radius].push({actual:target.value,...result});}
    }
  }
  const schemeResults={};
  for(const scheme of schemes){schemeResults[scheme.name]={kind:scheme.kind,blockKm:scheme.km??null,purgeBufferKm:scheme.bufferKm??null,region:scheme.region??null,byRadius:{}};
    for(const radius of RADII){const rows=predictions[scheme.name][radius];schemeResults[scheme.name].byRadius[radius]={...summarize(rows,{totalSites:sites.length}),medianBaselineMae:avg(rows.map(r=>Math.abs(r.actual-globalMedian))),medianBaselineAbsLogError:quantile(rows.map(r=>Math.abs(Math.log1p(Math.max(0,globalMedian))-Math.log1p(Math.max(0,r.actual)))),.5)};}}
  const errorsByDistance={};
  for(const r of RADII){errorsByDistance[r]=[];for(const [lo,hi] of BANDS){const rows=distanceRows[r].filter(p=>p.nearestKm>=lo&&p.nearestKm<hi);errorsByDistance[r].push({bandKm:`${lo}-${hi===Infinity?'plus':hi}`,...summarize(rows,{totalSites:sites.length})});}}
  const result={generatedAt:new Date().toISOString(),scope:'Read-only spatial holdout analysis; production fish scores and radius are unchanged.',source:{name:snapshot.dataset,unit:snapshot.density_unit,observationRows:snapshot.rows.length,groupedCoordinateSites:sites.length,globalSiteMedian:globalMedian},
    design:{siteGrouping:'All retained observations at an exact coordinate (rounded to 5 decimals) are averaged into one site; folds hold out the entire coordinate site.',blockGeometry:'Latitude bands use block height=block size/110.574 degrees. Longitude width is set from the band midpoint latitude to make approximate equal-width geographic blocks.',purge:'For each test site in a block, all training sites in that block and all other sites nearer than half the block size are removed. The distance purge reduces cross-boundary local leakage; it is a site-centred buffer, not an exact polygon buffer.',regions:'Leave-one-screening-region-out uses the approximate report windows (not formal marine provinces or ecoregions). Other is a broad residual class; treat those results as stress tests, not ecological province transfer.',metrics:'Coverage denominator is all grouped sites. Error is held-out mean fish/100 m2; absolute log error is |log1p(pred)-log1p(actual)|. Baseline is global median actual density for covered targets.'},
    radiiKm:RADII,spatialBlockValidation:schemeResults,errorByNearestSupportingSiteDistance:errorsByDistance};
  await fs.mkdir(path.join(ROOT,'reports'),{recursive:true});await fs.writeFile(path.join(ROOT,'reports','fish-density-block-scale-validation.json'),JSON.stringify(result,null,2)+'\n');
  let md='# Fish-density spatial-block scale validation\n\n';md+=`Generated ${result.generatedAt}; diagnostic only. ${sites.length.toLocaleString()} coordinate sites, grouped before splitting.\n\n`;
  md+='## Methodology clarification\n\n';md+='The earlier leave-one-site-out run grouped all rows at an exact coordinate before withholding it, avoiding same-coordinate replicate leakage; distinct nearby reef sites remained eligible, so it measures local interpolation. The earlier 96.3% at a 1,000 km radius came from a separate 5°-block run: it removed the target site’s fixed latitude/longitude block but had no boundary buffer. Nearby sites across block edges remained eligible; 234 of 3,776 covered targets had nearest support within 25 km. Therefore that 96.3% is **mostly local/intermediate interpolation performance**, not clean geographic extrapolation, and does not establish transfer to unsurveyed reefs or marine provinces.\n\n';
  md+='The new block results exclude the target block and purge all training sites within half the tested block width of each target. Leave-screening-region-out results additionally purge sources within 500 km of each target. These approximate region windows are stress tests, not formal marine-province boundaries.\n\n';
  for(const scheme of schemes){const x=schemeResults[scheme.name],includeGrid=scheme.name==='1000 km buffered spatial blocks';md+=`## ${scheme.name}\n\n`;md+=includeGrid?'| Radius | Valid sites | Holdout coverage | Grid coverage* | Median abs. log error | MAE (fish/100 m²) | Bias | Spearman | Median / p90 nearest support (km) |\n|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n':'| Radius | Valid sites | Coverage | Median abs. log error | MAE (fish/100 m²) | Bias | Spearman | Median / p90 nearest support (km) |\n|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n';for(const r of RADII){const v=x.byRadius[r],f=n=>n==null?'n/a':Number(n).toFixed(2),grid=coverageData.estimatedFishSupportCellsByMaximumRadius[r]?.coveragePercent;if(includeGrid)md+=`| ${r} km | ${v.n} | ${v.coveragePercent.toFixed(1)}% | ${grid==null?'n/a':grid.toFixed(1)+'%'} | ${f(v.medianAbsoluteLogError)} | ${f(v.mae)} | ${f(v.bias)} | ${f(v.spearman)} | ${f(v.medianNearestSupportKm)} / ${f(v.p90NearestSupportKm)} |\n`;else md+=`| ${r} km | ${v.n} | ${v.coveragePercent.toFixed(1)}% | ${f(v.medianAbsoluteLogError)} | ${f(v.mae)} | ${f(v.bias)} | ${f(v.spearman)} | ${f(v.medianNearestSupportKm)} / ${f(v.p90NearestSupportKm)} |\n`;}
    if(includeGrid)md+='\n*Grid coverage uses the existing Euclidean support estimator at each radius. It is not connectivity-filtered and is not validated coverage.\n';
    const v=x.byRadius[1000];md+=`\nAt 1,000 km: p90 absolute log error ${v.p90AbsoluteLogError?.toFixed(2)??'n/a'}; p90 absolute density error ${v.p90AbsoluteError?.toFixed(1)??'n/a'} fish/100 m²; median-baseline MAE ${v.medianBaselineMae?.toFixed(1)??'n/a'}, median-baseline absolute log error ${v.medianBaselineAbsLogError?.toFixed(2)??'n/a'}.\n\n`;}
  md+='## Distance-band diagnostics\n\nErrors below use fully site-grouped LOO at each radius and are stratified by nearest supporting site; n is shown because far bands are sparse.\n\n| Radius | Nearest support band | n | Median abs. log error | MAE | Bias |\n|---:|---|---:|---:|---:|---:|\n';
  for(const r of RADII)for(const x of errorsByDistance[r])md+=`| ${r} km | ${x.bandKm} km | ${x.n} | ${x.medianAbsoluteLogError?.toFixed(2)??'n/a'} | ${x.mae?.toFixed(1)??'n/a'} | ${x.bias?.toFixed(1)??'n/a'} |\n`;
  const strictRows=predictions['1000 km buffered spatial blocks'];
  md+='\n## Error versus distance with 1,000 km blocks and a 500 km purge\n\nThis is the more geographic holdout; support distances are at least 500 km by design. Sparse distant bands should not be interpreted as stable error estimates.\n\n| Radius | Nearest support band (km) | n | Median abs. log error | MAE | Bias |\n|---:|---|---:|---:|---:|---:|\n';
  for(const r of RADII)for(const [lo,hi] of BANDS){const rows=strictRows[r].filter(p=>p.nearestKm>=lo&&p.nearestKm<hi),x=summarize(rows,{totalSites:sites.length});md+=`| ${r} km | ${lo}-${hi===Infinity?'plus':hi} | ${x.n} | ${x.medianAbsoluteLogError?.toFixed(2)??'n/a'} | ${x.mae?.toFixed(1)??'n/a'} | ${x.bias?.toFixed(1)??'n/a'} |\n`;}
  md+='\n## Interpretation limits\n\nBlocks at different scales and source-distance purges answer different questions. Large purges intentionally produce many unsupported targets; their conditional error metrics apply only to the sites still predicted. Leave-region-out groups are screening windows, not authoritative marine provinces. The processed snapshot lacks repeated sampling variance, effort metadata, protocol covariates, and a documented fish-density measurement uncertainty model. These analyses test prediction of site means, not ecological equivalence or the final Dive Conditions score. Do not change production values or choose a radius from these metrics without the connectivity comparison and regional review.\n';
  await fs.writeFile(path.join(ROOT,'reports','fish-density-block-scale-validation.md'),md);
  console.log(JSON.stringify({report:'reports/fish-density-block-scale-validation.md',sites:sites.length,oneKByScheme:Object.fromEntries(Object.entries(schemeResults).map(([k,v])=>[k,v.byRadius[1000]]))},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
