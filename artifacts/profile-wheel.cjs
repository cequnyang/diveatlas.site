const { chromium } = require('@playwright/test');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:1280, height:900 } });
  const errors = [];
  const earlyVector = process.argv.includes('--early-vector');
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://127.0.0.1:8765/?*', async route => {
    const response = await route.fetch();
    let body = await response.text();
    if (earlyVector) {
      body = body.replaceAll('map.getZoom() < REEF_VECTOR_MIN_ZOOM', 'map.getZoom() <= REEF_RASTER_MAX_ZOOM')
        .replace('if (zoom < REEF_VECTOR_MIN_ZOOM)', 'if (zoom <= REEF_RASTER_MAX_ZOOM)');
    }
    for (const name of ['createLocalReefWorldLayer', 'renderSpeciesCache']) {
      body = body.replace(`function ${name}(`, `function ${name}(...args) {
        const start = performance.now();
        try { return __profile_${name}(...args); }
        finally {
          const entry = window.__wheelStats?.work?.${name};
          if (entry) { entry.calls++; entry.ms += performance.now()-start; }
        }
      }\n function __profile_${name}(`);
    }
    body = body.replace('}).setView(INITIAL_CENTER, INITIAL_ZOOM);', '}).setView(INITIAL_CENTER, INITIAL_ZOOM); window.__wheelMap = map;');
    await route.fulfill({ response, body });
  });
  console.log('loading');
  await page.goto('http://127.0.0.1:8765/?hl=en&z=7.31&l=c,t,r,s,f,d&v=i&g=5ck3giept0&tt=0', { waitUntil:'domcontentloaded', timeout:30000 });
  console.log('loaded');
  await page.waitForFunction(() => window.__wheelMap);
  await page.waitForTimeout(12000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  const reports = [];
  for (const snap of [0]) {
    console.log('snap',snap);
    await page.evaluate(snap => {
      const map = window.__wheelMap;
      map.options.zoomSnap = snap;
      map.options.wheelPxPerZoomLevel = 90;
      map.options.wheelDebounceTime = 40;
      map.setView([-5.7,131],7,{ animate:false });
    }, snap);
    await page.waitForTimeout(2500);
    console.log('view ready');
    await page.evaluate(() => {
      const map = window.__wheelMap;
      window.__wheelStats = { wheel:0, zoom:0, zoomend:0, moveend:0, longTasks:[], frames:[], zooms:[], work:{ createLocalReefWorldLayer:{ calls:0, ms:0 }, renderSpeciesCache:{ calls:0, ms:0 } } };
      if (!window.__wheelObserved) {
        window.__wheelObserved = true;
        map.getContainer().addEventListener('wheel', () => window.__wheelStats.wheel++);
        map.on('zoom zoomend moveend', event => {
          window.__wheelStats[event.type]++;
          if (event.type === 'zoomend') window.__wheelStats.zooms.push(map.getZoom());
        });
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) window.__wheelStats.longTasks.push(entry.duration);
        }).observe({ type:'longtask' });
        let last;
        const frame = now => { if (last) window.__wheelStats.frames.push(now-last); last=now; requestAnimationFrame(frame); };
        requestAnimationFrame(frame);
      }
    });
    await page.mouse.move(640,450);
    console.log('starting profiler');
    await cdp.send('Profiler.start');
    console.log('scrolling');
    for (let i=0;i<20;i++) {
      if (i%10===0) console.log('wheel',i);
      await page.mouse.wheel(0, i<10 ? -12 : 12);
      await page.waitForTimeout(35);
    }
    await page.waitForTimeout(1500);
    const { profile } = await cdp.send('Profiler.stop');
    const counts = new Map();
    for (const id of profile.samples || []) counts.set(id,(counts.get(id)||0)+1);
    const top = profile.nodes.map(n => ({ name:n.callFrame.functionName, url:n.callFrame.url, line:n.callFrame.lineNumber+1, samples:counts.get(n.id)||0 })).sort((a,b)=>b.samples-a.samples).slice(0,20);
    const stats = await page.evaluate(() => ({ ...window.__wheelStats, layers:Object.values(window.__wheelMap._layers).length }));
    reports.push({ earlyVector, snap, stats, top, errors, profileDurationMs:(profile.endTime-profile.startTime)/1000 });
  }
  fs.writeFileSync(process.argv[2] || 'artifacts/wheel-before.json', JSON.stringify(reports,null,2));
  console.log(JSON.stringify(reports.map(({ earlyVector, stats, profileDurationMs })=>({ earlyVector, profileDurationMs, wheel:stats.wheel, zoomend:stats.zoomend, work:stats.work, maxTask:Math.max(0,...stats.longTasks), blockingMs:stats.longTasks.reduce((n,t)=>n+Math.max(0,t-50),0) })),null,2));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
