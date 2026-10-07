#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'data', 'dive_conditions_score');
const GRID = Object.freeze({ step:0.5, west:-180, south:-85, width:720, height:340 });
const OCEAN_MASK_SAMPLES_PER_AXIS = 8;
const MIN_OCEAN_CELL_FRACTION = 0.25;
const ESTIMATE_RADIUS_KM = 2500;
const ESTIMATE_DECAY_KM = 250;
const LOCAL_RADIUS_KM = 25;
const MIN_ESTIMATE_SOURCES = 3;
const MIN_EFFECTIVE_SOURCES = 2.5;
const BUCKET_DEGREES = 5;
const MONTH_KEYS = Object.freeze(['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']);

const localFetch = async input => {
  const relative = decodeURIComponent(String(input).split('?')[0]).replace(/^\/+/, '');
  const filename = path.resolve(ROOT, relative);
  if (filename !== ROOT && !filename.startsWith(`${ROOT}${path.sep}`)) throw new Error(`Refusing to read outside project data: ${input}`);
  try { return new Response(await fs.readFile(filename)); }
  catch { return new Response(`Not found: ${relative}`, { status:404 }); }
};

function loadApis() {
  const temp = require('../js/temperature-query.js').createTemperatureQuery({ fetchImpl:localFetch, maxChunks:648 });
  const clarity = require('../js/water-clarity-query.js').createWaterClarityQuery({ fetchImpl:localFetch, maxChunks:594 });
  require('../js/current-math.js');
  require('../js/current-tile-cache.js');
  const current = require('../js/regional-currents.js').createCurrentView({ L:{}, map:{}, fetchImpl:localFetch, tileCacheEntries:512 });
  const waves = require('../js/waves-view.js').createWavesView({ L:{}, map:{}, fetchImpl:localFetch, queryCacheEntries:256 });
  require('../js/coral-heat-stress-style.js');
  const heat = require('../js/coral-heat-stress-view.js').createCoralHeatStressView({ L:{}, map:{}, fetchImpl:localFetch, queryCacheEntries:512 });
  const model = require('../js/dive-conditions-model.js');
  const service = require('../js/dive-conditions-service.js').createDiveConditionsService({ temperature:temp, clarity,
    current, waves, model });
  return { service, heat, model, sources:{temperature:temp,clarity,current,waves} };
}

function normalizeLongitude(value) {
  return ((Number(value) + 180) % 360 + 360) % 360 - 180;
}

function distanceKm(aLat, aLng, bLat, bLng) {
  const radians = value => value * Math.PI / 180;
  const dLat = radians(bLat - aLat);
  const dLng = radians(bLng - aLng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function makeSpatialIndex(points) {
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
  const lngRadius = Math.min(180, radiusKm / Math.max(11.1, 111.32 * Math.cos(location.lat * Math.PI / 180)));
  const minY = Math.max(0, Math.floor((Math.max(-90, location.lat - latRadius) + 90) / BUCKET_DEGREES));
  const maxY = Math.min(35, Math.floor((Math.min(90, location.lat + latRadius) + 90) / BUCKET_DEGREES));
  const centerX = Math.floor((normalizeLongitude(location.lng) + 180) / BUCKET_DEGREES);
  const xOffsets = lngRadius >= 180 ? Array.from({ length:360 / BUCKET_DEGREES }, (_, i) => i - centerX)
    : Array.from({ length:Math.ceil(2 * lngRadius / BUCKET_DEGREES) + 2 }, (_, i) => i - Math.ceil(lngRadius / BUCKET_DEGREES));
  const xIndices = [...new Set(xOffsets.map(offset => ((centerX + offset) % (360 / BUCKET_DEGREES) + (360 / BUCKET_DEGREES)) % (360 / BUCKET_DEGREES)))];
  const result = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (const x of xIndices) {
      for (const point of index.get(`${y}:${x}`) || []) {
        const distance = distanceKm(location.lat, location.lng, point.lat, point.lng);
        if (distance <= radiusKm) result.push({ point, distanceKm:distance });
      }
    }
  }
  return result;
}

function buildProbeLocations(location, count) {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length:count }, (_, index) => {
    const distanceKm = ESTIMATE_RADIUS_KM * Math.sqrt((index + 0.5) / count);
    const bearing = index * goldenAngle;
    const angularDistance = distanceKm / 6371.0088;
    const latitude = location.lat * Math.PI / 180;
    const longitude = location.lng * Math.PI / 180;
    const nextLatitude = Math.asin(Math.sin(latitude) * Math.cos(angularDistance) +
      Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing));
    const nextLongitude = longitude + Math.atan2(Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(nextLatitude));
    return { lat:nextLatitude * 180 / Math.PI, lng:normalizeLongitude(nextLongitude * 180 / Math.PI) };
  });
}

function weightedEstimate(samples) {
  const bySource = new Map();
  for (const sample of samples) {
    if (!Number.isFinite(sample.value) || !Number.isFinite(sample.score) || !Number.isFinite(sample.distanceKm)) continue;
    const key = `${sample.lat.toFixed(5)}:${normalizeLongitude(sample.lng).toFixed(5)}`;
    const source = bySource.get(key) || { lat:sample.lat, lng:sample.lng, distanceKm:sample.distanceKm, valueTotal:0, scoreTotal:0, count:0 };
    source.valueTotal += sample.value;
    source.scoreTotal += sample.score;
    source.count += 1;
    bySource.set(key, source);
  }
  const sources = [...bySource.values()];
  if (sources.length < MIN_ESTIMATE_SOURCES) return null;
  let valueTotal = 0, scoreTotal = 0, weightTotal = 0, squaredWeightTotal = 0;
  for (const source of sources) {
    const weight = 1 / (1 + (source.distanceKm / ESTIMATE_DECAY_KM) ** 3);
    valueTotal += source.valueTotal / source.count * weight;
    scoreTotal += source.scoreTotal / source.count * weight;
    weightTotal += weight;
    squaredWeightTotal += weight ** 2;
  }
  const effectiveSources = weightTotal ** 2 / squaredWeightTotal;
  if (!weightTotal || effectiveSources < MIN_EFFECTIVE_SOURCES) return null;
  return { value:valueTotal / weightTotal, score:Math.round(scoreTotal / weightTotal) };
}

function percentileFromSorted(sorted, value) {
  if (!Number.isFinite(Number(value)) || !sorted.length) return null;
  let low = 0, high = sorted.length;
  while (low < high) { const middle = (low + high) >>> 1; if (sorted[middle] < value) low = middle + 1; else high = middle; }
  const firstEqual = low;
  high = sorted.length;
  while (low < high) { const middle = (low + high) >>> 1; if (sorted[middle] <= value) low = middle + 1; else high = middle; }
  return Math.round(((firstEqual + (low - firstEqual) / 2) / sorted.length) * 100);
}

function parseCoralSnapshot(source) {
  const match = source.match(/DIVEATLAS_CORAL_SNAPSHOT\s*=\s*"([^"]+)"/);
  if (!match) throw new Error('The bundled coral records snapshot is missing.');
  const snapshot = JSON.parse(zlib.gunzipSync(Buffer.from(match[1], 'base64')).toString('utf8'));
  const step = Number(snapshot.step) || 0.015625;
  return (snapshot.cells || []).map(row => ({
    lat:Number(row[0]) * step - 90 + step / 2,
    lng:Number(row[1]) * step - 180 + step / 2,
    value:Number(row[2])
  })).filter(point => Number.isFinite(point.value) && point.value > 0);
}

async function loadSnapshots() {
  const [coralSource, fishBytes] = await Promise.all([
    fs.readFile(path.join(ROOT, 'datasets', 'coral_records_snapshot.js'), 'utf8'),
    fs.readFile(path.join(ROOT, 'datasets', 'fish_map_units.json.gz'))
  ]);
  const coral = parseCoralSnapshot(coralSource);
  const fishSnapshot = JSON.parse(zlib.gunzipSync(fishBytes).toString('utf8'));
  const fish = (fishSnapshot.rows || []).map(row => ({ lat:Number(row[0]), lng:Number(row[1]), value:Number(row[2]) }))
    .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng) && Number.isFinite(point.value));
  const fishByLocation = new Map();
  for (const point of fish) {
    const key = `${point.lat.toFixed(5)}:${normalizeLongitude(point.lng).toFixed(5)}`;
    const group = fishByLocation.get(key) || { lat:point.lat, lng:point.lng, valueTotal:0, count:0 };
    group.valueTotal += point.value;
    group.count += 1;
    fishByLocation.set(key, group);
  }
  return {
    coral:{ points:coral, values:coral.map(point => point.value).sort((a,b) => a-b) },
    fish:{ points:fish, estimatePoints:[...fishByLocation.values()].map(point => ({ lat:point.lat, lng:point.lng, value:point.valueTotal / point.count })),
      values:fish.map(point => point.value).sort((a,b) => a-b) }
  };
}

function localSnapshotMetric(source, estimateSource, sortedValues, location) {
  const local = pointsWithin(source, location, LOCAL_RADIUS_KM);
  let nearest = null;
  for (const candidate of local) if (!nearest || candidate.distanceKm < nearest.distanceKm) nearest = candidate;
  if (nearest) return percentileFromSorted(sortedValues, nearest.point.value);
  const regional = pointsWithin(estimateSource, location, ESTIMATE_RADIUS_KM).map(candidate => ({
    ...candidate.point, score:percentileFromSorted(sortedValues, candidate.point.value), distanceKm:candidate.distanceKm
  }));
  return weightedEstimate(regional)?.score ?? null;
}

function heatStressScore(dhw) {
  const value = Number(dhw);
  if (!Number.isFinite(value) || value < 0) return null;
  return value < 4 ? 100 : value < 8 ? 50 : 0;
}

async function reefMetricsForPoint(location, { coral, fish }, heatView) {
  const coralScore = localSnapshotMetric(coral.index, coral.index, coral.values, location);
  const fishScore = localSnapshotMetric(fish.index, fish.estimateIndex, fish.values, location);
  const directHeat = await heatView.sampleNearest(location.lat, location.lng, { allowInactive:true }).catch(() => null);
  let heatScore = directHeat?.dhw_c_weeks == null ? null : heatStressScore(directHeat.dhw_c_weeks);
  if (heatScore == null) {
    const probes = buildProbeLocations(location, 48);
    const points = [];
    for (let start = 0; start < probes.length; start += 6) {
      const results = await Promise.all(probes.slice(start, start + 6).map(point => heatView.sample(point.lat, point.lng, { allowInactive:true }).catch(() => null)));
      for (const sample of results) if (sample?.dhw_c_weeks != null) points.push({ value:sample.dhw_c_weeks,
        score:heatStressScore(sample.dhw_c_weeks), lat:sample.source_latitude, lng:sample.source_longitude,
        distanceKm:distanceKm(location.lat, location.lng, sample.source_latitude, sample.source_longitude) });
    }
    heatScore = weightedEstimate(points)?.score ?? null;
  }
  return [coralScore, fishScore, heatScore];
}

function comfortScore(model, key, value) {
  return value == null ? null : model.metricScore(key, Number(value));
}

async function estimateMissingPhysicalScores(sources, model, location, month, result) {
  const missing = ['temperature','clarity','current','waves'].filter(key => result.metrics?.[key]?.value == null);
  if (!missing.length) return {};
  const probes = buildProbeLocations(location, 24);
  const samples = new Map(missing.map(key=>[key,[]]));
  const read = async (key,point) => {
    if(key==='temperature'){
      const sample=await sources.temperature.query(point,{month,depth:5,maxDistanceKm:LOCAL_RADIUS_KM});
      return sample?.unavailable?null:{value:Number(sample?.value_c),lat:Number(sample?.source_latitude),lng:Number(sample?.source_longitude)};
    }
    if(key==='clarity'){
      const sample=await sources.clarity.query(point,{month,maxDistanceKm:LOCAL_RADIUS_KM});
      return sample?.unavailable?null:{value:Number(sample?.value_m),lat:Number(sample?.source_latitude),lng:Number(sample?.source_longitude)};
    }
    if(key==='current'){
      const sample=await sources.current.sample(point.lat,point.lng,month,'10');
      return sample?{value:Number(sample.speed),lat:Number(sample.source_latitude),lng:Number(sample.source_longitude)}:null;
    }
    const sample=await sources.waves.sample(point.lat,point.lng,month);
    return sample?{value:Number(sample.height_m),lat:Number(sample.source_latitude),lng:Number(sample.source_longitude)}:null;
  };
  for (let start=0;start<probes.length;start+=8) {
    const batch=await Promise.all(probes.slice(start,start+8).map(async point=>Promise.all(missing.map(async key=>({key,sample:await read(key,point).catch(()=>null)})))));
    for(const pointResults of batch) for(const {key,sample} of pointResults){
      if(!sample||!Number.isFinite(sample.value)||!Number.isFinite(sample.lat)||!Number.isFinite(sample.lng)) continue;
      samples.get(key).push({value:sample.value,score:comfortScore(model,key,sample.value),lat:sample.lat,lng:sample.lng,
        distanceKm:distanceKm(location.lat,location.lng,sample.lat,sample.lng)});
    }
  }
  const estimates = {};
  for (const key of missing) {
    estimates[key] = weightedEstimate(samples.get(key).filter(point=>point.distanceKm<=ESTIMATE_RADIUS_KM))?.score ?? null;
  }
  return estimates;
}

const depthChunkCache = new Map();
async function loadDepthChunk(y, x) {
  const key = `${y}/${x}`;
  if (depthChunkCache.has(key)) return depthChunkCache.get(key);
  const packed = await fs.readFile(path.join(ROOT,'data','depth_samples',String(y),`${x}.bin.gz`));
  const bytes = zlib.gunzipSync(packed);
  const size = 225;
  if (bytes.byteLength !== size * size * 2) throw new Error(`Invalid bathymetry sample chunk ${key}`);
  const values = new Int16Array(size * size);
  for (let i=0;i<values.length;i+=1) values[i]=bytes.readInt16LE(i*2);
  depthChunkCache.set(key,values);
  return values;
}

async function preloadDepthSamples() {
  await Promise.all(Array.from({length:12}, (_, y) => Array.from({length:24}, (_, x) => loadDepthChunk(y, x))).flat());
}

function depthAt(location) {
  const longitude = normalizeLongitude(location.lng);
  const latitude = Math.max(-90,Math.min(90,location.lat));
  const x = Math.max(0,Math.min(23,Math.floor((longitude+180)/15)));
  const y = Math.max(0,Math.min(11,Math.floor((90-latitude)/15)));
  const values = depthChunkCache.get(`${y}/${x}`);
  const column = Math.max(0,Math.min(224,Math.floor((longitude-(-180+x*15))*15)));
  const row = Math.max(0,Math.min(224,Math.floor(((90-y*15)-latitude)*15)));
  const elevation = values[row*225+column];
  return Number.isFinite(elevation) && elevation < 0 && elevation > -12000;
}

function createOceanMask(mask) {
  const bytes = Buffer.alloc(16 + mask.length);
  bytes.write('DAOM',0,'ascii');
  bytes.writeUInt8(1,4);
  bytes.writeUInt8(OCEAN_MASK_SAMPLES_PER_AXIS,5);
  bytes.writeUInt16LE(GRID.width,6);
  bytes.writeUInt16LE(GRID.height,8);
  bytes.writeUInt16LE(Math.round(GRID.step*100),10);
  bytes.writeInt16LE(Math.round(GRID.west*10),12);
  bytes.writeInt16LE(Math.round(GRID.south*10),14);
  Buffer.from(mask).copy(bytes,16);
  return zlib.gzipSync(bytes,{level:9});
}

function parseOceanMask(packed) {
  const bytes = zlib.gunzipSync(packed);
  const expectedLength = GRID.width * GRID.height * OCEAN_MASK_SAMPLES_PER_AXIS;
  if (bytes.length !== 16 + expectedLength || bytes.toString('ascii',0,4) !== 'DAOM' || bytes.readUInt8(4) !== 1 ||
      bytes.readUInt8(5) !== OCEAN_MASK_SAMPLES_PER_AXIS || bytes.readUInt16LE(6) !== GRID.width ||
      bytes.readUInt16LE(8) !== GRID.height || bytes.readUInt16LE(10) !== Math.round(GRID.step*100) ||
      bytes.readInt16LE(12) !== Math.round(GRID.west*10) || bytes.readInt16LE(14) !== Math.round(GRID.south*10)) {
    throw new Error('Invalid fixed-grid ocean mask.');
  }
  return new Uint8Array(bytes.buffer,bytes.byteOffset+16,expectedLength);
}

function collectOceanCells(mask) {
  const cells = [];
  const samples = OCEAN_MASK_SAMPLES_PER_AXIS;
  for (let row=0;row<GRID.height;row+=1) {
    const cellSouth=GRID.south+row*GRID.step;
    for (let column=0;column<GRID.width;column+=1) {
      const index=row*GRID.width+column;
      const offset=index*samples;
      let count=0, nearestDistance=Infinity, representative=null;
      const cellWest=GRID.west+column*GRID.step;
      const centerLat=cellSouth+GRID.step/2, centerLng=cellWest+GRID.step/2;
      for (let subrow=0;subrow<samples;subrow+=1) {
        const bits=mask[offset+subrow];
        for (let subcolumn=0;subcolumn<samples;subcolumn+=1) {
          if (!(bits & (1<<subcolumn))) continue;
          count+=1;
          const lat=cellSouth+(subrow+0.5)*GRID.step/samples;
          const lng=cellWest+(subcolumn+0.5)*GRID.step/samples;
          const dy=lat-centerLat, dx=(lng-centerLng)*Math.cos(centerLat*Math.PI/180);
          const distance=dx*dx+dy*dy;
          if(distance<nearestDistance){nearestDistance=distance;representative={lat,lng};}
        }
      }
      if (count / (samples*samples) >= MIN_OCEAN_CELL_FRACTION) cells.push({index,location:representative,oceanFraction:count/(samples*samples)});
    }
  }
  return cells;
}

function createGridLayer(month, scores) {
  const bytes = Buffer.alloc(16 + scores.length);
  bytes.write('DASM',0,'ascii');
  bytes.writeUInt8(1,4);
  bytes.writeUInt8(month,5);
  bytes.writeUInt16LE(GRID.width,6);
  bytes.writeUInt16LE(GRID.height,8);
  bytes.writeUInt16LE(Math.round(GRID.step*100),10);
  bytes.writeInt16LE(Math.round(GRID.west*10),12);
  bytes.writeInt16LE(Math.round(GRID.south*10),14);
  Buffer.from(scores).copy(bytes,16);
  return zlib.gzipSync(bytes,{ level:9 });
}

function createReefCache(scores) {
  const bytes=Buffer.alloc(16+scores.length);
  bytes.write('DARS',0,'ascii');
  bytes.writeUInt8(2,4);
  bytes.writeUInt8(0,5);
  bytes.writeUInt16LE(GRID.width,6);
  bytes.writeUInt16LE(GRID.height,8);
  bytes.writeUInt16LE(Math.round(GRID.step*100),10);
  bytes.writeInt16LE(Math.round(GRID.west*10),12);
  bytes.writeInt16LE(Math.round(GRID.south*10),14);
  Buffer.from(scores).copy(bytes,16);
  return zlib.gzipSync(bytes,{level:9});
}

function parseGridFile(packed,magic,month=0,payloadLength=GRID.width*GRID.height,version=1) {
  const bytes=zlib.gunzipSync(packed);
  if(bytes.length!==16+payloadLength||bytes.toString('ascii',0,4)!==magic||bytes.readUInt8(4)!==version||bytes.readUInt8(5)!==month||
    bytes.readUInt16LE(6)!==GRID.width||bytes.readUInt16LE(8)!==GRID.height||bytes.readUInt16LE(10)!==Math.round(GRID.step*100)||
    bytes.readInt16LE(12)!==Math.round(GRID.west*10)||bytes.readInt16LE(14)!==Math.round(GRID.south*10)) throw new Error(`Invalid ${magic} fixed-grid asset.`);
  return new Uint8Array(bytes.buffer,bytes.byteOffset+16,payloadLength);
}

async function main() {
  const started = Date.now();
  await fs.mkdir(OUTPUT,{recursive:true});
  const resume=process.argv.includes('--resume');
  const coastalOnly=process.argv.includes('--coastal-only');
  const skippedMonths=new Set((process.argv.find(argument=>argument.startsWith('--skip-months='))?.split('=')[1]||'')
    .split(',').filter(Boolean).map(Number));
  try {
    const previousManifest=JSON.parse(await fs.readFile(path.join(OUTPUT,'manifest.json'),'utf8'));
    if(resume && previousManifest.oceanMask?.file==='ocean-mask.bin.gz') {
      throw new Error('A completed score-grid manifest already exists; omit --resume to regenerate all assets.');
    }
  } catch(error) { if(error.code!=='ENOENT' && !(error instanceof SyntaxError)) throw error; }
  const {service,model,sources,heat}=loadApis();
  const cellCount=GRID.width*GRID.height;
  const oceanMaskPath=path.join(OUTPUT,'ocean-mask.bin.gz');
  let oceanMask=null;
  try { oceanMask=parseOceanMask(await fs.readFile(oceanMaskPath)); }
  catch(error) { if(error.code!=='ENOENT') throw error; }
  if(!oceanMask){
    await preloadDepthSamples();
    oceanMask=new Uint8Array(cellCount*OCEAN_MASK_SAMPLES_PER_AXIS);
    for(let row=0;row<GRID.height;row+=1){
      const cellSouth=GRID.south+row*GRID.step;
      for(let column=0;column<GRID.width;column+=1){
        const cellWest=GRID.west+column*GRID.step;
        const offset=(row*GRID.width+column)*OCEAN_MASK_SAMPLES_PER_AXIS;
        for(let subrow=0;subrow<OCEAN_MASK_SAMPLES_PER_AXIS;subrow+=1){
          const latitude=cellSouth+(subrow+0.5)*GRID.step/OCEAN_MASK_SAMPLES_PER_AXIS;
          let bits=0;
          for(let subcolumn=0;subcolumn<OCEAN_MASK_SAMPLES_PER_AXIS;subcolumn+=1){
            const longitude=cellWest+(subcolumn+0.5)*GRID.step/OCEAN_MASK_SAMPLES_PER_AXIS;
            if(depthAt({lat:latitude,lng:longitude})) bits|=1<<subcolumn;
          }
          oceanMask[offset+subrow]=bits;
        }
      }
      if((row+1)%40===0) console.log(`Ocean-area mask sampled through latitude row ${row+1}/${GRID.height}.`);
    }
    const supported=collectOceanCells(oceanMask).length;
    await fs.writeFile(oceanMaskPath,createOceanMask(oceanMask));
    console.log(`Ocean-area mask saved: ${supported.toLocaleString()} grid cells meet the ${Math.round(MIN_OCEAN_CELL_FRACTION*100)}% ocean threshold.`);
  }
  const eligibleOceanCells=collectOceanCells(oceanMask);
  let oceanCells=eligibleOceanCells;
  if(coastalOnly){
    await preloadDepthSamples();
    oceanCells=oceanCells.filter(({index})=>{
      const row=Math.floor(index/GRID.width),column=index%GRID.width;
      return !depthAt({lat:GRID.south+(row+0.5)*GRID.step,lng:GRID.west+(column+0.5)*GRID.step});
    });
  }
  const reefCachePath=path.join(OUTPUT,'reef-dimensions.bin.gz');
  let reefData=null;
  if(resume||coastalOnly){
    try { reefData=parseGridFile(await fs.readFile(reefCachePath),'DARS',0,cellCount*3,2); }
    catch(error) { if(error.code!=='ENOENT') throw error; }
  }
  if(!reefData){
    if(coastalOnly) throw new Error('Coastal-only scoring requires the version 2 reef-dimension cache; run a full build first.');
    let snapshots=await loadSnapshots();
    snapshots.coral.index=makeSpatialIndex(snapshots.coral.points);
    snapshots.fish.index=makeSpatialIndex(snapshots.fish.points);
    snapshots.fish.estimateIndex=makeSpatialIndex(snapshots.fish.estimatePoints);
    reefData=new Uint8Array(cellCount*3).fill(255);
    let supported=0;
    console.log(`Preparing fixed ${GRID.step}° grid (${GRID.width} × ${GRID.height}); sampling ocean cells with at least ${Math.round(MIN_OCEAN_CELL_FRACTION*100)}% water coverage.`);
    for(let start=0;start<oceanCells.length;start+=1){
      const {index,location}=oceanCells[start];
      const reefScores=await reefMetricsForPoint(location,snapshots,heat);
      reefScores.forEach((score,dimension)=>{if(Number.isFinite(score))reefData[cellCount*dimension+index]=score;});
      if(reefScores.every(score=>Number.isFinite(score)&&score<=100)) supported+=1;
      if((start+1)%5000===0) console.log(`Ocean and reef dimensions indexed ${start+1}/${oceanCells.length}; ${supported.toLocaleString()} cells have all three reef dimensions.`);
    }
    await fs.writeFile(reefCachePath,createReefCache(reefData));
    snapshots=null;
    console.log(`Static reef dimension grid saved: ${supported.toLocaleString()} cells.`);
  }
  const reefDimensionCoverage={coralRecords:0,fishDensity:0,heatStress:0,allThree:0};
  for(const {index} of eligibleOceanCells){
    if(reefData[index]<=100)reefDimensionCoverage.coralRecords+=1;
    if(reefData[cellCount+index]<=100)reefDimensionCoverage.fishDensity+=1;
    if(reefData[cellCount*2+index]<=100)reefDimensionCoverage.heatStress+=1;
    if(reefData[index]<=100&&reefData[cellCount+index]<=100&&reefData[cellCount*2+index]<=100)reefDimensionCoverage.allThree+=1;
  }
  oceanCells.forEach(cell=>{cell.reefScores=[reefData[cell.index],reefData[cellCount+cell.index],reefData[cellCount*2+cell.index]];});
  console.log(coastalOnly
    ? `Updating newly eligible coastal cells only: ${oceanCells.length.toLocaleString()} cells.`
    : `Precomputing twelve months for ${oceanCells.length.toLocaleString()} ocean cells.`);
  await fs.mkdir(OUTPUT,{recursive:true});
  const monthCoverage=[];
  for (let month=1;month<=12;month+=1) {
    const filename=`month-${String(month).padStart(2,'0')}.bin.gz`;
    if(skippedMonths.has(month)){
      const existing=parseGridFile(await fs.readFile(path.join(OUTPUT,filename)),'DASM',month).slice();
      let update='preserved existing grid';
      if(coastalOnly && month===1){
        for(let index=0;index<cellCount;index+=1){
          if(reefData[index]>100||reefData[cellCount+index]>100||reefData[cellCount*2+index]>100) existing[index]=255;
        }
        await fs.writeFile(path.join(OUTPUT,filename),createGridLayer(month,existing));
        update='existing grid retained after clearing unsupported reef-dimension scores';
      }
      const scored=existing.reduce((count,value)=>count+(value<=100?1:0),0);
      monthCoverage.push({month,scored,bytes:(await fs.stat(path.join(OUTPUT,filename))).size,update});
      console.log(`Month ${month} preserved: ${scored.toLocaleString()} existing scores.`);
      continue;
    }
    if(resume){
      try{
        const existing=parseGridFile(await fs.readFile(path.join(OUTPUT,filename)),'DASM',month);
        const scored=existing.reduce((count,value)=>count+(value<=100?1:0),0);
        monthCoverage.push({month,scored,bytes:(await fs.stat(path.join(OUTPUT,filename))).size});
        console.log(`Month ${month} reused from the interrupted build: ${scored.toLocaleString()} cells.`);
        continue;
      }catch(error){if(error.code!=='ENOENT') throw error;}
    }
    let scores;
    if(coastalOnly){
      scores=parseGridFile(await fs.readFile(path.join(OUTPUT,filename)),'DASM',month).slice();
    }else scores=new Uint8Array(GRID.width*GRID.height).fill(255);
    if(coastalOnly){
      for(const {index,reefScores} of oceanCells){
        if(reefScores.some(score=>score>100) && scores[index]<=100) scores[index]=255;
      }
    }
    let scored=scores.reduce((count,value)=>count+(value<=100?1:0),0);
    const missingReefDimensions={coralRecords:0,fishDensity:0,heatStress:0};
    const missingPhysicalDimensions={temperature:0,clarity:0,current:0,waves:0};
    let cellsMissingReefData=0;
    for (let start=0;start<oceanCells.length;start+=1) {
      const {index,location,reefScores}=oceanCells[start];
      if(reefScores.some(score=>score>100)){
        cellsMissingReefData+=1;
        ['coralRecords','fishDensity','heatStress'].forEach((key,dimension)=>{if(reefScores[dimension]>100)missingReefDimensions[key]+=1;});
        continue;
      }
      let result;
      try { result=await service.query(location,month); }
      catch { continue; }
      const physical={};
      for (const key of ['temperature','clarity','current','waves']) physical[key]=comfortScore(model,key,result.metrics[key]?.value);
      if (Object.values(physical).some(score=>score==null)) Object.assign(physical,await estimateMissingPhysicalScores(sources,model,location,month,result));
      const dimensions=[...reefScores,physical.temperature,physical.clarity,physical.current,physical.waves];
      ['temperature','clarity','current','waves'].forEach(key=>{if(!Number.isFinite(physical[key]))missingPhysicalDimensions[key]+=1;});
      if (dimensions.some(score=>!Number.isFinite(score))) continue;
      const wasUnscored=scores[index]>100;
      scores[index]=Math.round(dimensions.reduce((total,score)=>total+score,0)/7);
      if(wasUnscored)scored+=1;
      if ((start+1)%5000===0) console.log(`Month ${month}: scored ${start+1}/${oceanCells.length} reef-supported cells.`);
    }
    await fs.writeFile(path.join(OUTPUT,filename),createGridLayer(month,scores));
    monthCoverage.push({month,scored,update:coastalOnly?'newly eligible coastal cells only':'full ocean grid',
      diagnosticScope:coastalOnly?'newly eligible coastal cells only':'all eligible ocean cells',
      cellsMissingReefData,missingReefDimensions,missingPhysicalDimensionsAmongReefCompleteCells:missingPhysicalDimensions,
      bytes:(await fs.stat(path.join(OUTPUT,filename))).size});
    console.log(`Month ${month} complete: ${scored.toLocaleString()} total scores; ${cellsMissingReefData.toLocaleString()} cells in this pass lack reef dimensions (${JSON.stringify(missingReefDimensions)}); physical missing counts among reef-complete cells: ${JSON.stringify(missingPhysicalDimensions)}; ${Math.round((Date.now()-started)/1000)}s elapsed.`);
  }
  const manifest={
    format:'diveatlas-overall-score-grid',version:2,generatedAt:new Date().toISOString(),
    grid:{...GRID,cellCenterOffset:GRID.step/2,missingValue:255},
    oceanMask:{file:'ocean-mask.bin.gz',samplesPerAxis:OCEAN_MASK_SAMPLES_PER_AXIS,minimumOceanFraction:MIN_OCEAN_CELL_FRACTION,
      eligibleCellCount:eligibleOceanCells.length,
      classification:'Each subcell uses the bundled bathymetry; map pixels are drawn only over sampled ocean subcells.'},
    coverageDiagnosis:{reefDimensionAvailableCellCounts:reefDimensionCoverage,
      note:'Physical-dimension missing counts in each month are recorded for reef-complete cells in the processing pass; coastal-only runs report only newly eligible coastal cells.'},
    months:monthCoverage,
    scoring:{dimensions:['coralRecords','fishDensity','heatStress','temperature','clarity','current','waves'],weights:'equal',
      score:'rounded arithmetic mean; emitted only when all seven dimension scores are available',
      estimates:{radiusKm:ESTIMATE_RADIUS_KM,decayKm:ESTIMATE_DECAY_KM,minDistinctSources:MIN_ESTIMATE_SOURCES,minEffectiveSources:MIN_EFFECTIVE_SOURCES},
      heatStress:'current NOAA DHW product, shared across historical months, consistent with the popup score'},
    sourceSnapshots:{coral:'datasets/coral_records_snapshot.js',fish:'datasets/fish_map_units.json.gz',
      temperature:'data/temperature/query',clarity:'data/water_clarity/query',currents:'data/currents',waves:'data/waves',
      heatStress:'data/coral-heat-stress',bathymetry:'data/depth_samples'}
  };
  await fs.writeFile(path.join(OUTPUT,'manifest.json'),`${JSON.stringify(manifest,null,2)}\n`);
  console.log(`Score grids written to ${path.relative(ROOT,OUTPUT)} in ${Math.round((Date.now()-started)/1000)}s.`);
}

if (require.main === module) {
  main().catch(error=>{ console.error(error); process.exitCode=1; });
} else {
  // The parallel consumer-score prototype reuses these read-only samplers and
  // grid decoders, while writing its results under analysis/ rather than data/.
  module.exports = Object.freeze({ ROOT, OUTPUT, GRID, loadApis, localFetch, normalizeLongitude,
    distanceKm, comfortScore, estimateMissingPhysicalScores, parseOceanMask,
    collectOceanCells, parseGridFile });
}
