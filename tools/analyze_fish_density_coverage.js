#!/usr/bin/env node
'use strict';

// Reproducible, read-only diagnosis of the bundled fish-density score support.
// This script never modifies production score assets. The coarse ocean graph is
// deliberately diagnostic only: its ~7 km nodes flag possible land-crossing
// support, but cannot resolve narrow channels or replace a marine cost surface.

const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'dive_conditions_score');
const REPORT_DIR = path.join(ROOT, 'reports');
const LOCAL_RADIUS_KM = 25;
const SUPPORT_RADIUS_KM = 2500;
const DECAY_KM = 250;
const MIN_SOURCES = 3;
const MIN_EFFECTIVE_SOURCES = 2.5;
const BUCKET_DEGREES = 5;
const SAMPLES = 8;
const RADIUS_SENSITIVITY_KM = [100,250,500,750,1000,1500,2000,2500];

function normalizeLongitude(value) { return ((Number(value) + 180) % 360 + 360) % 360 - 180; }
function radians(value) { return value * Math.PI / 180; }
function distanceKm(a, b) {
  const dLat = radians(b.lat - a.lat), dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function makeIndex(points) {
  const buckets = new Map();
  for (const point of points) {
    const y = Math.floor((point.lat + 90) / BUCKET_DEGREES);
    const x = Math.floor((normalizeLongitude(point.lng) + 180) / BUCKET_DEGREES);
    const key = `${y}:${x}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(point);
  }
  return buckets;
}
function pointsWithin(index, location, radiusKm) {
  const latRadius = radiusKm / 110.574;
  const lngRadius = Math.min(180, radiusKm / Math.max(11.1, 111.32 * Math.cos(radians(location.lat))));
  const minY = Math.max(0, Math.floor((Math.max(-90, location.lat - latRadius) + 90) / BUCKET_DEGREES));
  const maxY = Math.min(35, Math.floor((Math.min(90, location.lat + latRadius) + 90) / BUCKET_DEGREES));
  const centerX = Math.floor((normalizeLongitude(location.lng) + 180) / BUCKET_DEGREES);
  const xOffsets = lngRadius >= 180 ? Array.from({ length:72 }, (_, i) => i - centerX)
    : Array.from({ length:Math.ceil(2 * lngRadius / BUCKET_DEGREES) + 2 }, (_, i) => i - Math.ceil(lngRadius / BUCKET_DEGREES));
  const xIndices = [...new Set(xOffsets.map(offset => ((centerX + offset) % 72 + 72) % 72))];
  const result = [];
  for (let y = minY; y <= maxY; y += 1) for (const x of xIndices) {
    for (const point of index.get(`${y}:${x}`) || []) {
      const distanceKmValue = distanceKm(location, point);
      if (distanceKmValue <= radiusKm) result.push({ point, distanceKm:distanceKmValue });
    }
  }
  return result;
}
function nearestFromGlobalIndex(index, location) {
  for (const radius of [5000, 10000, 20000, 21000]) {
    const candidates = pointsWithin(index, location, radius);
    if (candidates.length) return candidates.reduce((a, b) => a.distanceKm <= b.distanceKm ? a : b);
  }
  return null;
}
function effectiveCount(candidates) {
  let total = 0, squared = 0;
  for (const { distanceKm:d } of candidates) {
    const w = 1 / (1 + (d / DECAY_KM) ** 3);
    total += w; squared += w * w;
  }
  return squared ? total * total / squared : 0;
}
function estimateStatus(rawIndex, siteIndex, location) {
  const local = pointsWithin(rawIndex, location, LOCAL_RADIUS_KM);
  if (local.length) return { supported:true, mode:'direct observation within 25 km', sourceCount:local.length, effective:local.length };
  const sources = pointsWithin(siteIndex, location, SUPPORT_RADIUS_KM);
  const effective = effectiveCount(sources);
  return { supported:sources.length >= MIN_SOURCES && effective >= MIN_EFFECTIVE_SOURCES,
    mode:sources.length < MIN_SOURCES ? 'too few distinct sites' : effective < MIN_EFFECTIVE_SOURCES ? 'too little effective support' : 'weighted estimate supported',
    sourceCount:sources.length, effective };
}

function regionFor(lat, lng) {
  // Non-overlapping geographic screening windows in priority order, not an
  // official marine-ecoregion product; boundaries exist only for this report.
  if (lat >= 5 && lat <= 30 && lng >= -100 && lng <= -55) return 'Caribbean';
  if (lat >= 12 && lat <= 30 && lng >= 32 && lng <= 44) return 'Red Sea';
  if (lat >= 30 && lat <= 46 && lng >= -6 && lng <= 36) return 'Mediterranean';
  if (lat >= -25 && lat <= -10 && lng >= 142 && lng <= 154) return 'Great Barrier Reef / Australia';
  const coralTriangle = [[95,-12],[130,-12],[141,-6],[141,20],[120,20],[95,10]];
  if (insidePolygon(lng, lat, coralTriangle)) return 'Coral Triangle / Southeast Asia';
  if (lat >= -35 && lat <= 16 && lng >= 30 && lng <= 52) return 'East Africa';
  if (lat >= -35 && lat <= 25 && lng >= 45 && lng <= 100) return 'Indian Ocean';
  if (lat >= -30 && lat <= 30 && (lng >= 140 || lng <= -100)) return 'Pacific Islands';
  if (lat >= -50 && lat <= 50 && lng >= -60 && lng <= 20) return 'Atlantic islands';
  return 'Other';
}
function insidePolygon(x, y, polygon) {
  let inside = false;
  for (let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const [xi,yi]=polygon[i], [xj,yj]=polygon[j];
    if (((yi>y)!==(yj>y)) && x < (xj-xi)*(y-yi)/(yj-yi)+xi) inside=!inside;
  }
  return inside;
}

async function parsePacked(file, magic, expectedLength, version) {
  const bytes = zlib.gunzipSync(await fs.readFile(file));
  if (bytes.toString('ascii',0,4)!==magic || bytes.readUInt8(4)!==version || bytes.length!==16+expectedLength) throw new Error(`Invalid ${path.basename(file)} header or length`);
  return { bytes, payload:bytes.subarray(16) };
}
async function loadDepthChunk(y,x,cache) {
  const key=`${y}/${x}`;
  if (cache.has(key)) return cache.get(key);
  const packed=await fs.readFile(path.join(ROOT,'data','depth_samples',String(y),`${x}.bin.gz`));
  const raw=zlib.gunzipSync(packed), values=new Int16Array(225*225);
  for(let i=0;i<values.length;i++) values[i]=raw.readInt16LE(i*2);
  cache.set(key,values);
  return values;
}
async function pointIsOcean(point, depthCache) {
  const lng=normalizeLongitude(point.lng), lat=Math.max(-90,Math.min(90,point.lat));
  const x=Math.max(0,Math.min(23,Math.floor((lng+180)/15)));
  const y=Math.max(0,Math.min(11,Math.floor((90-lat)/15)));
  const values=await loadDepthChunk(y,x,depthCache);
  const column=Math.max(0,Math.min(224,Math.floor((lng-(-180+x*15))*15)));
  const row=Math.max(0,Math.min(224,Math.floor(((90-y*15)-lat)*15)));
  const elevation=values[row*225+column];
  return elevation<0 && elevation>-12000;
}
function buildOceanGraph(mask, width, height) {
  const subWidth=width*SAMPLES, subHeight=height*SAMPLES, n=subWidth*subHeight;
  const wet=new Uint8Array(n), labels=new Int32Array(n);
  for(let cellRow=0;cellRow<height;cellRow++) for(let cellColumn=0;cellColumn<width;cellColumn++) {
    const cell=(cellRow*width+cellColumn)*SAMPLES;
    for(let sy=0;sy<SAMPLES;sy++) {
      const bits=mask[cell+sy], globalRow=cellRow*SAMPLES+sy, base=globalRow*subWidth+cellColumn*SAMPLES;
      for(let sx=0;sx<SAMPLES;sx++) if(bits&(1<<sx)) wet[base+sx]=1;
    }
  }
  const queue=new Int32Array(n); let component=0, wetCount=0;
  for(let start=0;start<n;start++) {
    if(!wet[start]) continue; wetCount++;
    if(labels[start]) continue;
    component++;
    let head=0,tail=0; labels[start]=component; queue[tail++]=start;
    while(head<tail) {
      const p=queue[head++], y=Math.floor(p/subWidth), x=p-y*subWidth;
      const up=y>0?p-subWidth:-1, down=y+1<subHeight?p+subWidth:-1;
      const left=x===0?p+subWidth-1:p-1, right=x===subWidth-1?p-(subWidth-1):p+1;
      if(up>=0&&wet[up]&&!labels[up]) {labels[up]=component;queue[tail++]=up;}
      if(down>=0&&wet[down]&&!labels[down]) {labels[down]=component;queue[tail++]=down;}
      if(wet[left]&&!labels[left]) {labels[left]=component;queue[tail++]=left;}
      if(wet[right]&&!labels[right]) {labels[right]=component;queue[tail++]=right;}
    }
  }
  return { labels, wetCount, componentCount:component, subWidth, subHeight };
}
function graphLabelAtPoint(point, graph, depthCache) {
  const { subWidth, subHeight, labels }=graph;
  const gx=Math.floor((normalizeLongitude(point.lng)+180)*SAMPLES/0.5);
  const gy=Math.floor((point.lat+85)*SAMPLES/0.5);
  if(gx<0||gx>=subWidth||gy<0||gy>=subHeight) return Promise.resolve({component:0,reason:'outside ocean grid'});
  const exact=labels[gy*subWidth+gx];
  if(exact) return Promise.resolve({component:exact,reason:'exact wet mask subcell'});
  return pointIsOcean(point,depthCache).then(isOcean=>{
    if(!isOcean) return {component:0,reason:'bathymetry marks survey coordinate as land/no-data'};
    let bestDistance=Infinity,bestComponent=0,ambiguous=false;
    for(let y=Math.max(0,gy-1);y<=Math.min(subHeight-1,gy+1);y++) for(let x=Math.max(0,gx-1);x<=Math.min(subWidth-1,gx+1);x++) {
      const id=labels[y*subWidth+x]; if(!id) continue;
      const candidate={lat:-85+(y+0.5)*0.5/SAMPLES,lng:-180+(x+0.5)*0.5/SAMPLES};
      const d=distanceKm(point,candidate);
      if(d<bestDistance-0.05){bestDistance=d;bestComponent=id;ambiguous=false;}
      else if(Math.abs(d-bestDistance)<=0.05&&id!==bestComponent) ambiguous=true;
    }
    return bestDistance<=6.5&&!ambiguous?{component:bestComponent,reason:'nearby wet subcell; source point is bathymetrically ocean'}
      :{component:0,reason:ambiguous?'ambiguous adjacent water bodies':'no wet subcell within 6.5 km'};
  });
}
function regionBucket() { return { eligible:0, covered:0, missing:0, cause:Object.create(null), connectedEstimate:0, euclideanOnly:0 }; }
function bump(object,key,count=1) { object[key]=(object[key]||0)+count; }

async function main() {
  const manifest=JSON.parse(await fs.readFile(path.join(DATA,'manifest.json'),'utf8'));
  const { step,west,south,width,height }=manifest.grid, cellCount=width*height;
  const { payload:mask }=await parsePacked(path.join(DATA,manifest.oceanMask.file),'DAOM',cellCount*SAMPLES,1);
  const { payload:reef }=await parsePacked(path.join(DATA,'reef-dimensions.bin.gz'),'DARS',cellCount*3,2);
  const fishJson=JSON.parse(zlib.gunzipSync(await fs.readFile(path.join(ROOT,'data','fish_map_units.json.gz'))).toString('utf8'));
  const raw=(fishJson.rows||[]).map(row=>({lat:Number(row[0]),lng:normalizeLongitude(row[1]),value:Number(row[2])}))
    .filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Number.isFinite(p.value));
  const siteGroups=new Map();
  for(const p of raw){const k=`${p.lat.toFixed(5)}:${p.lng.toFixed(5)}`;const g=siteGroups.get(k)||{lat:p.lat,lng:p.lng,total:0,count:0};g.total+=p.value;g.count++;siteGroups.set(k,g);}
  const sites=[...siteGroups.values()].map(g=>({lat:g.lat,lng:g.lng,value:g.total/g.count}));
  const rawIndex=makeIndex(raw), siteIndex=makeIndex(sites);
  const graph=buildOceanGraph(mask,width,height);
  const depthCache=new Map();
  const siteGraph=new Map();
  const siteAssignReasons=Object.create(null);
  for(let i=0;i<sites.length;i++){
    const assigned=await graphLabelAtPoint(sites[i],graph,depthCache);
    siteGraph.set(`${sites[i].lat.toFixed(5)}:${sites[i].lng.toFixed(5)}`,assigned.component);
    bump(siteAssignReasons,assigned.reason);
  }
  const rawWithComponent=raw.map(point=>({...point,component:siteGraph.get(`${point.lat.toFixed(5)}:${point.lng.toFixed(5)}`)||0}));
  const rawGraphIndex=makeIndex(rawWithComponent);
  const connectedSites=sites.filter(p=>siteGraph.get(`${p.lat.toFixed(5)}:${p.lng.toFixed(5)}`));
  const connectedSiteIndex=makeIndex(connectedSites.map(p=>({...p,component:siteGraph.get(`${p.lat.toFixed(5)}:${p.lng.toFixed(5)}`)})));

  const regionOrder=['Caribbean','Red Sea','Indian Ocean','Coral Triangle / Southeast Asia','Pacific Islands','Great Barrier Reef / Australia','East Africa','Mediterranean','Atlantic islands','Other'];
  const regions=Object.fromEntries(regionOrder.map(name=>[name,regionBucket()]));
  const causes=Object.create(null), coverageByMonth=manifest.months.map(m=>({month:m.month,scored:m.scored}));
  const cellMaskCounts={fullyLand:0,waterBelowCurrentThreshold:0,eligible:0};
  for(let i=0;i<cellCount;i++){
    let wet=0; for(let y=0;y<SAMPLES;y++){let bits=mask[i*SAMPLES+y];while(bits){wet+=bits&1;bits>>=1;}}
    if(!wet)cellMaskCounts.fullyLand++;
    else if(wet/64<Number(manifest.oceanMask.minimumOceanFraction))cellMaskCounts.waterBelowCurrentThreshold++;
  }
  const oceanCells=[];
  for(let row=0;row<height;row++) for(let col=0;col<width;col++){
    const index=row*width+col, locSouth=south+row*step, locWest=west+col*step;
    let count=0,nearest=Infinity,rep=null;
    for(let sy=0;sy<SAMPLES;sy++){const bits=mask[index*SAMPLES+sy];for(let sx=0;sx<SAMPLES;sx++)if(bits&(1<<sx)){
      count++;const lat=locSouth+(sy+0.5)*step/SAMPLES,lng=locWest+(sx+0.5)*step/SAMPLES;
      const dy=lat-(locSouth+step/2),dx=(lng-(locWest+step/2))*Math.cos(radians(locSouth+step/2));
      const dist=dx*dx+dy*dy;if(dist<nearest){nearest=dist;rep={lat,lng,subX:col*SAMPLES+sx,subY:row*SAMPLES+sy};}
    }}
    if(count/64<Number(manifest.oceanMask.minimumOceanFraction))continue;
    const hasFish=reef[cellCount+index]<=100, name=regionFor(locSouth+step/2,normalizeLongitude(locWest+step/2));
    const component=rep?graph.labels[rep.subY*graph.subWidth+rep.subX]:0;
    const cell={index,location:rep,component,hasFish,name};oceanCells.push(cell);
    const r=regions[name];r.eligible++; if(hasFish)r.covered++;else r.missing++;
    if(!hasFish){
      const status=estimateStatus(rawIndex,siteIndex,rep);
      const allRadius=pointsWithin(siteIndex,rep,SUPPORT_RADIUS_KM);
      let nearestObs=allRadius.length?allRadius.reduce((a,b)=>a.distanceKm<=b.distanceKm?a:b):nearestFromGlobalIndex(siteIndex,rep);
      let category;
      if(!nearestObs) category='no valid fish observations in source snapshot';
      else if(!allRadius.length) category=nearestObs.distanceKm<=5000?'nearest survey beyond 2,500 km (within 5,000 km)':'nearest survey beyond 5,000 km';
      else if(allRadius.length<MIN_SOURCES) category='observations within radius, but fewer than 3 distinct survey locations';
      else if(effectiveCount(allRadius)<MIN_EFFECTIVE_SOURCES) category='observations within radius, but effective support below 2.5';
      else if(status.supported) category='cached no-data despite current method finding support';
      else category='other support/preprocessing gap';
      bump(causes,category);bump(r.cause,category);
      const connected=component?pointsWithin(connectedSiteIndex,rep,SUPPORT_RADIUS_KM).filter(p=>p.point.component===component):[];
      const effective=effectiveCount(connected);
      if(connected.length>=MIN_SOURCES&&effective>=MIN_EFFECTIVE_SOURCES)r.connectedEstimate++;
      if(allRadius.length>=MIN_SOURCES&&effectiveCount(allRadius)>=MIN_EFFECTIVE_SOURCES&&
        !(connected.length>=MIN_SOURCES&&effective>=MIN_EFFECTIVE_SOURCES))r.euclideanOnly++;
      oceanCells[oceanCells.length-1].diagnostic={category,nearestKm:nearestObs?.distanceKm??null,within2500:allRadius.length,
        effective:effectiveCount(allRadius),sameWaterBodyWithin2500:connected.length,sameWaterBodyEffective:effective,
        sameWaterBodyNearestKm:connected.length?connected.reduce((a,b)=>a.distanceKm<=b.distanceKm?a:b).distanceKm:null};
    }
  }
  cellMaskCounts.eligible=oceanCells.length;

  // Audit how often the current Euclidean method accepts support that fails
  // the same criterion after restricting candidates to the diagnostic water body.
  let euclideanSupported=0, connectedSupported=0, euclideanOnlyCovered=0, missingWithConnectedSupport=0;
  const connectedOnlyExamples=[];
  const euclideanOnlyCells=[];
  const nearestDistanceHistogram={'0-25km':0,'25-250km':0,'250-1000km':0,'1000-2500km':0,'2500-5000km':0,'>5000km':0};
  const nearestCoveredDistanceHistogram={'0-25km':0,'25-50km':0,'50-100km':0,'100-250km':0,'250-500km':0,'500-1000km':0,'1000-1500km':0,'1500-2000km':0,'2000-2500km':0,'>2500km':0};
  const missingDist=[];
  for(const cell of oceanCells){
    const euclidean=estimateStatus(rawIndex,siteIndex,cell.location);
    const connectedRaw=cell.component?pointsWithin(rawGraphIndex,cell.location,LOCAL_RADIUS_KM).filter(p=>p.point.component===cell.component):[];
    const connectedCandidates=cell.component?pointsWithin(connectedSiteIndex,cell.location,SUPPORT_RADIUS_KM).filter(p=>p.point.component===cell.component):[];
    const componentSupport=connectedRaw.length>0 || (connectedCandidates.length>=MIN_SOURCES&&effectiveCount(connectedCandidates)>=MIN_EFFECTIVE_SOURCES);
    if(!euclidean.supported&&componentSupport&&connectedOnlyExamples.length<5)connectedOnlyExamples.push({index:cell.index,location:cell.location,component:cell.component,localRaw:connectedRaw.length,connectedSites:connectedCandidates.length,connectedEffective:effectiveCount(connectedCandidates),euclidean:euclidean.mode,euclideanSources:euclidean.sourceCount,euclideanEffective:euclidean.effective});
    if(euclidean.supported)euclideanSupported++;
    if(componentSupport)connectedSupported++;
    if(cell.hasFish&&euclidean.supported&&!componentSupport){
      euclideanOnlyCovered++;
      euclideanOnlyCells.push({index:cell.index,lat:cell.location.lat,lng:cell.location.lng,region:cell.name,score:reef[cellCount+cell.index]});
    }
    if(!cell.hasFish&&componentSupport)missingWithConnectedSupport++;
    if(cell.hasFish){
      const sources=pointsWithin(siteIndex,cell.location,SUPPORT_RADIUS_KM);
      const nearest=sources.length?sources.reduce((a,b)=>a.distanceKm<=b.distanceKm?a:b).distanceKm:null;
      const key=nearest==null?'>2500km':nearest<=25?'0-25km':nearest<=50?'25-50km':nearest<=100?'50-100km':nearest<=250?'100-250km':nearest<=500?'250-500km':nearest<=1000?'500-1000km':nearest<=1500?'1000-1500km':nearest<=2000?'1500-2000km':'2000-2500km';
      nearestCoveredDistanceHistogram[key]++;
    }
    if(!cell.hasFish){
      const d=cell.diagnostic?.nearestKm;
      if(d!=null){const key=d<=25?'0-25km':d<=250?'25-250km':d<=1000?'250-1000km':d<=2500?'1000-2500km':d<=5000?'2500-5000km':'>5000km';nearestDistanceHistogram[key]++;missingDist.push(d);}
    }
  }
  for(const r of Object.values(regions))delete r.cause;
  const fishCovered=reef.reduce((n,v,i)=>i>=cellCount&&i<cellCount*2&&v<=100?n+1:n,0);
  const actualEligible=oceanCells.length;
  const actualMissing=actualEligible-fishCovered;
  if(actualEligible!==Number(manifest.oceanMask.eligibleCellCount)) throw new Error(`Mask eligibility mismatch: rebuilt ${actualEligible}, manifest ${manifest.oceanMask.eligibleCellCount}`);
  if(fishCovered!==Number(manifest.coverageDiagnosis.reefDimensionAvailableCellCounts.fishDensity)) throw new Error(`Fish cache coverage mismatch: rebuilt ${fishCovered}, manifest ${manifest.coverageDiagnosis.reefDimensionAvailableCellCounts.fishDensity}`);
  const radiusCoverage=Object.fromEntries(RADIUS_SENSITIVITY_KM.map(radius=>[radius,0]));
  for(const cell of oceanCells){
    if(pointsWithin(rawIndex,cell.location,LOCAL_RADIUS_KM).length){for(const radius of RADIUS_SENSITIVITY_KM)radiusCoverage[radius]++;continue;}
    const sources=pointsWithin(siteIndex,cell.location,SUPPORT_RADIUS_KM).sort((a,b)=>a.distanceKm-b.distanceKm);
    let n=0,sum=0,sum2=0,cursor=0;
    for(const radius of RADIUS_SENSITIVITY_KM){
      while(cursor<sources.length&&sources[cursor].distanceKm<=radius){
        const w=1/(1+(sources[cursor].distanceKm/DECAY_KM)**3);n++;sum+=w;sum2+=w*w;cursor++;
      }
      const effective=sum2?sum*sum/sum2:0;
      if(n>=MIN_SOURCES&&effective>=MIN_EFFECTIVE_SOURCES)radiusCoverage[radius]++;
    }
  }
  const report={generatedAt:new Date().toISOString(),scope:'Current local NRMN fish-density support only; no production assets changed.',
    source:{name:fishJson.dataset,provider:fishJson.source,unit:fishJson.density_unit,rawObservationRows:fishJson.raw_rows,
      retainedSurveyUnits:raw.length,uniqueCoordinateSites:sites.length,eligibleCells:actualEligible,fishSupportedCells:fishCovered,
      missingCells:actualMissing,coveragePercent:100*fishCovered/actualEligible},
    missingCauses:Object.fromEntries(Object.entries(causes).map(([cause,count])=>[cause,{count,percent:100*count/actualMissing}])),
    regionalCoverage:Object.fromEntries(regionOrder.filter(n=>regions[n].eligible).map(n=>{const r=regions[n];return[n,{eligibleCells:r.eligible,fishCoveredCells:r.covered,missingCells:r.missing,coveragePercent:100*r.covered/r.eligible,
      missingWithMarineConnectedSupport:r.connectedEstimate,euclideanSupportNotAvailableWithinSameMarineComponent:r.euclideanOnly}]})),
    supportDiagnostics:{searchRadiusKm:SUPPORT_RADIUS_KM,localDirectRadiusKm:LOCAL_RADIUS_KM,decayKm:DECAY_KM,
      minDistinctSurveyLocations:MIN_SOURCES,minEffectiveSources:MIN_EFFECTIVE_SOURCES,nearestObservationDistanceBandsAmongMissing:nearestDistanceHistogram,
      nearestObservationDistanceBandsAmongCoveredCells:nearestCoveredDistanceHistogram,
      euclideanSupportedCells:euclideanSupported,marineConnectedSupportedCells:connectedSupported,
      connectedOnlyExamples,
      currentlyCoveredCellsWhoseEuclideanSupportFailsSameComponentCheck:euclideanOnlyCovered,
      currentlyMissingCellsThatMeetSameComponentSupport:missingWithConnectedSupport,
      connectedWaterSubcellCount:graph.wetCount,approximateConnectedWaterBodyCount:graph.componentCount,
      fishSiteOceanAssignment:siteAssignReasons,fishSurveyLocationsNotAssignedToOceanComponent:sites.length-connectedSites.length},
    estimatedFishSupportCellsByMaximumRadius:Object.fromEntries(RADIUS_SENSITIVITY_KM.map(radius=>[radius,{supportedCells:radiusCoverage[radius],eligibleCells:actualEligible,coveragePercent:100*radiusCoverage[radius]/actualEligible}])),
    coarseConnectivityFlaggedCells:euclideanOnlyCells,
    maskAccounting:{fullyLandCells:cellMaskCounts.fullyLand,waterCellsRejectedBelowOceanFraction:cellMaskCounts.waterBelowCurrentThreshold,
      currentThreshold:Number(manifest.oceanMask.minimumOceanFraction),eligibleCells:actualEligible,
      note:'Mask exclusions are outside the eligible-cell denominator; no eligible cell can be missing fish because the cell itself was rejected by this mask.'},
    methodology:{regionWindows:'Approximate non-overlapping geographic screening boxes/polygon defined in the script; not official marine ecoregions.',
      marineConnectivity:'4-neighbor connected components on 8x8 wet subcells in each 0.5-degree cell (~7 km at the equator), with dateline wrap. Fish survey locations are assigned only when the local bathymetry says ocean and a wet subcell is within 6.5 km. This is a conservative diagnostic, not a production barrier model.',
      existingSupport:'Exact implementation criteria: any raw survey point within 25 km yields a direct percentile; otherwise average duplicate locations, compute weighted support within 2,500 km using 1/(1+(d/250)^3), and require at least 3 distinct locations and effective support >=2.5.',
      sourceNoData:'The original source parquet is not bundled, so invalid/dropped raw source rows cannot be reconstructed from the processed snapshot; cell-level absence is classified from the processed survey locations and cached score dimension.',
      mermaid:'No MERMAID locations were bulk-enumerated. MERMAID Terms prohibit automated API scraping and require project/protocol-specific restrictions and attribution; coverage gain is therefore not estimated without an authorized/licensed export.'}};
  await fs.mkdir(REPORT_DIR,{recursive:true});
  // Compact analysis-only point list lets the GEBCO audit recheck all eligible
  // score cells without bloating the human-readable report JSON with 166k rows.
  const cellBytes=Buffer.alloc(oceanCells.length*17);
  oceanCells.forEach((cell,i)=>{const offset=i*17;cellBytes.writeDoubleLE(cell.location.lat,offset);cellBytes.writeDoubleLE(cell.location.lng,offset+8);cellBytes.writeUInt8(cell.hasFish?1:0,offset+16);});
  await fs.writeFile(path.join(REPORT_DIR,'fish-density-eligible-cells.bin.gz'),zlib.gzipSync(cellBytes,{level:9}));
  await fs.writeFile(path.join(REPORT_DIR,'fish-density-coverage-diagnostics.json'),JSON.stringify(report,null,2)+'\n');
  const pct=n=>`${n.toFixed(1)}%`;
  let md='# Fish-density coverage diagnosis\n\n';
  md+=`Generated ${report.generatedAt}. This is a read-only analysis of the bundled NRMN snapshot and cached reef-dimension grid; production scores were not changed.\n\n`;
  md+='## Current coverage\n\n';
  md+=`- Eligible ocean cells: **${actualEligible.toLocaleString()}**\n- Fish-density-supported: **${fishCovered.toLocaleString()} (${pct(report.source.coveragePercent)})**\n- Missing fish-density support: **${actualMissing.toLocaleString()} (${pct(100-report.source.coveragePercent)})**\n- Processed AODN/NRMN survey rows: **${raw.length.toLocaleString()}** across **${sites.length.toLocaleString()}** coordinate sites; reported source unit: **${fishJson.density_unit}**.\n\n`;
  md+='## Source-distance bands for currently covered cells\n\n| Nearest survey distance | Covered cells |\n|---|---:|\n';
  for(const [band,count] of Object.entries(nearestCoveredDistanceHistogram))md+=`| ${band} | ${count.toLocaleString()} |\n`;
  md+='\nDistance is to the nearest processed survey coordinate. It measures proximity, not independent validation accuracy.\n\n';
  md+='## Estimated coverage under candidate maximum support radii\n\n| Maximum radius | Supported cells | Eligible ocean cells | Coverage |\n|---:|---:|---:|---:|\n';
  for(const radius of RADIUS_SENSITIVITY_KM){const r=report.estimatedFishSupportCellsByMaximumRadius[radius];md+=`| ${radius.toLocaleString()} km | ${r.supportedCells.toLocaleString()} | ${r.eligibleCells.toLocaleString()} | ${pct(r.coveragePercent)} |\n`;}
  md+='\nCandidates apply the same direct-within-25-km rule, cubic-decay weights, minimum three distinct sites and effective support ≥2.5, but cap non-direct support at each listed radius. This is a sensitivity estimate, not a production score rebuild.\n\n';
  md+='## Missing-cell causes\n\n| Cause | Cells | Share of missing |\n|---|---:|---:|\n';
  for(const [cause,v] of Object.entries(report.missingCauses))md+=`| ${cause} | ${v.count.toLocaleString()} | ${pct(v.percent)} |\n`;
  md+='\n';
  md+='## Regional gaps\n\n| Region | Eligible cells | Fish-covered cells | Missing cells | Coverage | Same-water support among missing |\n|---|---:|---:|---:|---:|---:|\n';
  for(const name of regionOrder){const r=report.regionalCoverage[name];if(r)md+=`| ${name} | ${r.eligibleCells.toLocaleString()} | ${r.fishCoveredCells.toLocaleString()} | ${r.missingCells.toLocaleString()} | ${pct(r.coveragePercent)} | ${r.missingWithMarineConnectedSupport.toLocaleString()} |\n`;}
  md+='\nRegions are approximate, non-overlapping screening windows, not official marine ecoregions. See the JSON for boundaries, support diagnostics and limitations.\n\n';
  md+='## Spatial-support and connectivity audit\n\n';
  md+=`Among all eligible cells, the current Euclidean rule finds support for **${euclideanSupported.toLocaleString()}**; restricting sites to the same 8x8-bathymetry connected component finds support for **${connectedSupported.toLocaleString()}**. **${euclideanOnlyCovered.toLocaleString()}** currently fish-covered cells pass the Euclidean rule but fail the same-component rule. This flags possible across-land influence; it is not a production correction. **${missingWithConnectedSupport.toLocaleString()}** currently missing cells would meet support thresholds using same-component observations. This is not a cache discrepancy: removing distant, very low-weight sites can raise the effective-source statistic above its threshold. It is a candidate behavior change that needs scientific review before production.\n\n`;
  md+='## MERMAID assessment\n\n';
  md+='MERMAID Fish Belt captures survey date, fish counts and size, surveyed transect length, and belt width; documented calculations include abundance and biomass in kg/ha. Fish per surveyed area is derivable only when counts, effective area (including mixed-width rules), and the intended size/protocol filters are available. Biomass is a different measure. MERMAID documents a supported public-data path through its mermaidr R package; public-summary access provides site/event summaries while individual observations may remain private. Terms require project/protocol restriction checks and attribution, and prohibit API scraping.\n\n';
  md+='The documented public-data route is mermaid_get_summary_sampleevents(limit = NULL). This workspace has no R/Rscript runtime, so this iteration did not enumerate public fish sites or calculate cell/region gain. A prior unauthenticated summary response contained 16,555 sample events across all survey methods; that is not a fish-only site count and is not used as a gain estimate. A defensible gain/overlap result requires the supported export, filtering to public fish-protocol metrics, checking project/protocol terms and usable fields, then applying the same support and marine-connectivity screens.\n\n';
  md+='Sources: [MERMAID fish survey fields](https://datamermaid.org/documentation/collect-fish-data); [public data access with mermaidr](https://datamermaid.org/documentation/mermaidr-project-data-access); [official aggregated API rules and summary views](https://github.com/data-mermaid/mermaid-api/blob/master/docs/source/aggregated.rst); [data sharing policies](https://datamermaid.org/documentation/collect-project-data-sharing); [Terms of Service](https://datamermaid.org/terms-of-service).\n\n';
  md+='## Recommendation\n\n**D for production now; defer the evidence-based A/B/C choice until the supported public export can be run and project/protocol terms checked.** MERMAID is a plausible secondary source, but this run cannot quantify gain or compatibility, and public visibility alone does not establish redistribution rights. Do not alter production scores. Next, run the documented mermaidr public-summary workflow in an R-enabled environment; retain only fish-protocol records with clear reuse permissions and sufficient area/count metadata, then measure overlap and coverage gain. Keep NRMN primary, provider provenance explicit, and unsupported cells unknown unless that analysis supports a defensible secondary estimate.\n';
  await fs.writeFile(path.join(REPORT_DIR,'fish-density-coverage-diagnostics.md'),md);
  console.log(JSON.stringify({report:path.relative(ROOT,path.join(REPORT_DIR,'fish-density-coverage-diagnostics.md')),
    json:path.relative(ROOT,path.join(REPORT_DIR,'fish-density-coverage-diagnostics.json')),eligible:actualEligible,covered:fishCovered,
    missing:actualMissing,causes:report.missingCauses,regionalCoverage:report.regionalCoverage,
    support:report.supportDiagnostics},null,2));
}

main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
