/* Build-time only. The page receives a cached PNG, never a second map runtime.
   Usage: node tools/render_destination_map.cjs [--force] */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'assets/destination-maps');
const styleUrl = 'https://tiles.openfreemap.org/styles/positron';
const rendererUrl = 'https://unpkg.com/maplibre-gl@5.8.0/dist/maplibre-gl.js';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

async function main() {
  const index = JSON.parse(await fs.readFile(path.join(root, 'regions/area-index.json'), 'utf8'));
  const area = index.areas.find(area => area.key === '["asia","south-eastern asia","indonesia","raja ampat"]');
  if (!area?.site_indices.length) throw Error('Raja Ampat coordinates unavailable');
  const sites = area.site_indices.map(i => index.sites[i]);
  const lat = sites.reduce((sum, site) => sum + site.lat, 0) / sites.length;
  const lon = sites.reduce((sum, site) => sum + site.lon, 0) / sites.length;
  const bounds = [Math.min(...sites.map(s => s.lon)), Math.min(...sites.map(s => s.lat)),
    Math.max(...sites.map(s => s.lon)), Math.max(...sites.map(s => s.lat))];
  const response = await fetch(styleUrl);
  if (!response.ok) throw Error(`Style request failed: ${response.status}`);
  const styleText = await response.text();
  const inputs = {schema:1, region:area.key, center:[lon,lat], bounds, size:600,
    padding:66, styleUrl, styleHash:hash(styleText), rendererUrl, marker:'destination-centre-v4', compass:'rose-v1', attribution:'page-overlay-v1'};
  const fingerprint = hash(JSON.stringify(inputs));
  const file = `raja-ampat-${fingerprint.slice(0,16)}.png`;
  await fs.mkdir(output, {recursive:true});
  let previous;
  try {previous = JSON.parse(await fs.readFile(path.join(output, 'raja-ampat.json'), 'utf8'));} catch {}
  if (!process.argv.includes('--force') && previous?.fingerprint === fingerprint &&
      await fs.stat(path.join(output, file)).then(() => true, () => false)) {
    console.log(`Cached: ${file}`); return;
  }
  const browser = await chromium.launch({args:['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  try {
    const page = await browser.newPage({viewport:{width:600,height:600}, deviceScaleFactor:1,
      userAgent:'DiveAtlasDestinationPreview/1.0 (+https://diveatlas.site)'});
    // Respect the provider's bounded offline-render concurrency. Download only
    // the tiles/glyphs needed for this single view; do not prefetch an area.
    let active = 0; const waiting = [];
    await page.route('https://tiles.openfreemap.org/**', async route => {
      if (active >= 4) await new Promise(resolve => waiting.push(resolve));
      active++;
      try {const response = await route.fetch(); await route.fulfill({response});}
      finally {active--; waiting.shift()?.();}
    });
    await page.setContent('<style>html,body,#map{margin:0;width:600px;height:600px;background:#dce5e8}#north{position:absolute;right:20px;top:16px;background:#ffffffdf;border-radius:50%;width:58px;height:58px;padding:6px;color:#244651}</style><div id="map"></div><div id="north" aria-label="Compass: north is up"><svg viewBox="0 0 48 48" width="58" height="58" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="21" fill="none" stroke="#789296" stroke-width="1.2"/><path d="M24 3v5M45 24h-5M24 45v-5M3 24h5" stroke="#244651" stroke-width="1.5"/><path d="m24 9 7 22-7-4-7 4Z" fill="#246b72"/><path d="m24 39-7-22 7 4 7-4Z" fill="#b5c4c5"/><path d="m24 9 7 22-7-4Z" fill="#16464e"/><circle cx="24" cy="24" r="2.5" fill="#fff"/></svg></div>');
    await page.addScriptTag({url:rendererUrl});
    const camera = await page.evaluate(async ({inputs,style}) => {
      const map = new maplibregl.Map({container:'map',style,center:inputs.center,zoom:7,
        interactive:false,attributionControl:false,fadeDuration:0,preserveDrawingBuffer:true});
      const errors=[]; map.on('error', event => errors.push(event.error?.message || 'Map resource error'));
      await new Promise((resolve,reject) => {map.once('load',resolve);setTimeout(()=>reject(Error('Map load timeout')),45000);});
      map.fitBounds(inputs.bounds,{padding:inputs.padding,duration:0});
      map.addSource('destination-marker',{type:'geojson',data:{type:'Feature',geometry:{type:'Point',coordinates:inputs.center}}});
      map.addLayer({id:'destination-halo',type:'circle',source:'destination-marker',paint:{'circle-radius':15,'circle-color':'#ffffff','circle-opacity':0.65}});
      map.addLayer({id:'destination-point',type:'circle',source:'destination-marker',paint:{'circle-radius':8,'circle-color':'#246b72','circle-stroke-width':3,'circle-stroke-color':'#ffffff'}});
      await new Promise((resolve,reject)=>{map.once('idle',resolve);setTimeout(()=>reject(Error('Map tiles did not settle')),45000);});
      if(errors.length) throw Error(errors.join('; '));
      return {center:map.getCenter().toArray(),zoom:map.getZoom(),markerPixel:[map.project(inputs.center).x,map.project(inputs.center).y]};
    }, {inputs,style:JSON.parse(styleText)});
    await page.screenshot({path:path.join(output,file)});
    const manifest = {fingerprint,inputs,camera,src:`/assets/destination-maps/${file}`,
      mapHref:`/?lat=${camera.center[1].toFixed(5)}&lng=${camera.center[0].toFixed(5)}&z=${camera.zoom.toFixed(2)}&layers=dive`,
      markerMeaning:'Mean of recorded Raja Ampat site coordinates; not an individual dive site',
      renderedAt:new Date().toISOString(),attribution:['OpenFreeMap','© OpenMapTiles','© OpenStreetMap contributors']};
    await fs.writeFile(path.join(output,'raja-ampat.json'),JSON.stringify(manifest,null,2)+'\n');
    console.log(JSON.stringify({file,camera},null,2));
  } finally {await browser.close();}
}
(process.argv.includes('--all') ? require('./render_destination_maps.cjs').main() : main()).catch(error=>{console.error(error);process.exitCode=1;});
