(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasDestinationComparison = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';

  const DESTINATIONS = [
    { id: 'bali', name: 'Bali', country: 'Indonesia', region: 'Bali', path: '/regions/indonesia/bali/' },
    { id: 'komodo', name: 'Komodo', country: 'Indonesia', region: 'Komodo National Park', path: '/regions/indonesia/komodo-national-park/' }
  ];
  const METRICS = {
    temperature: { label: 'Water temperature', depth: '5 m', digits: 1, unit: '°C', source: 'WOA23 · 1991–2020 · 0.25°', metadata: 'temperature/query/v2' },
    clarity: { label: 'Secchi transparency', depth: '', digits: 1, unit: 'm', source: 'Ocean colour · 2016–2025 · 4 km', metadata: 'water_clarity/query/v2' },
    current: { label: 'Model current', depth: '~10 m', digits: 2, unit: 'm/s', source: 'Copernicus · 1993–2016 · ~37 km', metadata: 'currents' },
    waves: { label: 'Significant wave height', depth: '', digits: 2, unit: 'm', source: 'Copernicus · 1993–2020 · 0.2°', metadata: 'waves' }
  };

  function selectSites(index, destination) {
    if (index?.schema !== 'dive-site-region-index-v1' || !Array.isArray(index.sites)) throw new Error('Unsupported public region index');
    const unique = new Map();
    for (const site of index.sites) {
      if (site.country !== destination.country || site.region !== destination.region) continue;
      if (!site.site_id || !Number.isFinite(site.lat) || !Number.isFinite(site.lon)) throw new Error('Invalid destination record');
      unique.set(site.site_id, { id: site.site_id, name: site.name, lat: site.lat, lng: site.lon });
    }
    if (!unique.size) throw new Error(`No public records for ${destination.name}`);
    return [...unique.values()];
  }

  function buildDestinations(index) {
    if (index?.schema !== 'dive-site-region-index-v1' || !Array.isArray(index.sites)) throw new Error('Unsupported public region index');
    const areas = new Map();
    const countries = new Map((index.areas || []).filter(area => area.kind === 'country').map(area => [area.key, area.label]));
    for (const area of index.areas || []) {
      if (area.kind === 'place') for (const position of area.site_indices) areas.set(position, area);
    }
    const groups = new Map();
    index.sites.forEach((site, position) => {
      if (!site.region) return;
      const area = areas.get(position);
      // Country-only legacy records are promoted by the owning index and do
      // not create a second, invented destination with the country's name.
      if (Array.isArray(index.areas) && !area) return;
      const country = countries.get(area?.parent) || site.country;
      const region = area?.label || site.region;
      // Use the public area's existing membership, including normalized case
      // variants. A region name alone would merge different countries.
      const key = area?.key || JSON.stringify([country, region]);
      if (!groups.has(key)) {
        const previous = DESTINATIONS.find(d => d.country === country && d.region === region);
        groups.set(key, {
          id: previous?.id || key, areaKey: area?.key || null, name: previous?.name || region, region, country,
          path: previous?.path || (area ? '/regions/?area=' + encodeURIComponent(area.key) : '/regions/'),
          sites: new Map()
        });
      }
      if (!site.site_id || !Number.isFinite(site.lat) || !Number.isFinite(site.lon)) throw new Error('Invalid destination record');
      groups.get(key).sites.set(site.site_id, { id: site.site_id, name: site.name, lat: site.lat, lng: site.lon });
    });
    return [...groups.values()].map(group => ({ ...group, sites: [...group.sites.values()] }))
      .sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));
  }

  function summarize(samples, key) {
    const measures = samples.map(sample => sample.result.metrics[key]);
    const valid = measures.filter(m => m.value !== null && Number.isFinite(m.value));
    return {
      total: samples.length, valid: valid.length,
      missing: measures.filter(m => m.lookupStatus === 'no_data').length,
      failed: measures.filter(m => m.lookupStatus === 'request_failed').length,
      min: valid.length ? Math.min(...valid.map(m => m.value)) : null,
      max: valid.length ? Math.max(...valid.map(m => m.value)) : null,
      cells: new Set(valid.map(m => `${m.sourceLatitude},${m.sourceLongitude}`)).size
    };
  }

  function create({ service, fetchIndex, concurrency = 6 }) {
    let inventory;
    const cache = new Map(), queue = [];
    let active = 0;
    function enqueue(task) {
      return new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); drain(); });
    }
    function drain() {
      while (active < concurrency && queue.length) {
        const { task, resolve, reject } = queue.shift();
        active++;
        Promise.resolve().then(task).then(resolve, reject).finally(() => { active--; drain(); });
      }
    }
    function loadDestinations() {
      inventory ||= Promise.resolve().then(fetchIndex).then(buildDestinations)
        .catch(error => { inventory = null; throw error; });
      return inventory;
    }
    function loadInventory() {
      return loadDestinations().then(destinations => Object.fromEntries(destinations.map(d => [d.id, d.sites])));
    }
    function query(id, month, { retry = false } = {}) {
      if (!Number.isInteger(month) || month < 1 || month > 12) return Promise.reject(new Error('Invalid destination or month'));
      const key = `${id}:${month}`;
      if (retry) cache.delete(key);
      if (!cache.has(key)) {
        const pending = loadInventory().then(async sites => {
          if (!Object.hasOwn(sites, id)) throw new Error('Invalid destination or month');
          const samples = await Promise.all(sites[id].map(site => enqueue(async () => ({
            site, result: await service.query(site, month)
          }))));
          return {
            samples, total: samples.length,
            complete: samples.filter(s => Object.keys(METRICS).every(key => s.result.metrics[key].value !== null)).length,
            metrics: Object.fromEntries(Object.keys(METRICS).map(key => [key, summarize(samples, key)]))
          };
        });
        cache.set(key, pending);
        // Keep browsing many destination pairs from retaining an unbounded
        // collection of complete per-site/month results.
        while (cache.size > 12) cache.delete(cache.keys().next().value);
        // Rejected index/transport requests must be retryable, not cached forever.
        pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
      }
      return cache.get(key);
    }
    return { query, loadInventory, loadDestinations };
  }

  function createBrowserService(root) {
    // Production modules author data/ paths from the app root. A nested page
    // must also honor the deployment-owned R2 configuration without changing global fetch.
    const fetchData = (path, options) => root.fetch(
      root.DiveAtlasDataAssets?.external && path.startsWith('data/')
        ? root.DiveAtlasDataAssets.url(path)
        : new URL(path, root.location.origin + '/').href,
      options
    );
    return create({
      fetchIndex: async () => {
        const response = await root.fetch('/regions/area-index.json');
        if (!response.ok) throw new Error(`Region index returned HTTP ${response.status}`);
        return response.json();
      },
      service: root.DiveAtlasConditionsService.createDiveConditionsService({
        temperature: root.DiveAtlasTemperatureQuery.createTemperatureQuery({ fetchImpl: fetchData }),
        clarity: root.DiveAtlasWaterClarityQuery.createWaterClarityQuery({ fetchImpl: fetchData }),
        current: root.DiveAtlasRegionalCurrents.createCurrentView({ fetchImpl: fetchData }),
        waves: root.DiveAtlasWavesView.createWavesView({ fetchImpl: fetchData }),
        model: root.DiveAtlasConditionsModel
      })
    });
  }
  // Compare both range endpoints, not their midpoint: the displayed ranges are
  // site extrema, so their midpoint is not a destination average. Mixed ranges
  // cannot establish a winner. Missing/failed samples never become zero.
  function preferredRange(key, left, right) {
    if (![left, right].every(metric => metric && Number.isFinite(metric.min) && Number.isFinite(metric.max) && !metric.failed)) return -1;
    const direction = ['temperature', 'clarity'].includes(key) ? 1 : -1;
    const low = (left.min - right.min) * direction;
    const high = (left.max - right.max) * direction;
    if (low >= 0 && high >= 0 && (low > 0 || high > 0)) return 0;
    if (low <= 0 && high <= 0 && (low < 0 || high < 0)) return 1;
    return -1;
  }
  return { DESTINATIONS, METRICS, preferredRange, selectSites, buildDestinations, summarize, create, createBrowserService };
});
