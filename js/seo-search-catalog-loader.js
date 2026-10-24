(() => {
  'use strict';

  const path = 'data/dive-site-details/v2/recommendations.json';
  const assets = window.DiveAtlasDataAssets;
  const urlFor = value => assets?.external ? assets.url(value) : `/${value}`;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  async function loadCatalog() {
    const response = await fetch(urlFor(path), { signal:AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Recommendation catalog HTTP ${response.status}`);
    const payload = await response.json();
    let sites;

    if (payload?.schema === 'dive-site-recommendations-v1' && Array.isArray(payload.sites)) {
      sites = payload.sites;
    } else if (payload?.schema === 'dive-site-recommendation-manifest-v1'
      && Number.isSafeInteger(payload.site_count) && payload.site_count >= 0
      && Array.isArray(payload.shards)) {
      const names = new Set();
      const count = payload.shards.reduce((sum, shard) => {
        if (!shard || !/^recommendations-\d{4}\.json$/.test(shard.file)
          || names.has(shard.file) || !Number.isSafeInteger(shard.site_count) || shard.site_count < 1) {
          throw new Error('Invalid dive-site recommendation shard manifest');
        }
        names.add(shard.file);
        return sum + shard.site_count;
      }, 0);
      if (count !== payload.site_count) throw new Error('Recommendation shard counts do not match the manifest');
      const shards = await Promise.all(payload.shards.map(async shard => {
        const shardResponse = await fetch(urlFor(`data/dive-site-details/v2/${shard.file}`),
          { signal:AbortSignal.timeout(15000) });
        if (!shardResponse.ok) throw new Error(`Recommendation shard HTTP ${shardResponse.status}`);
        const data = await shardResponse.json();
        if (data?.schema !== 'dive-site-recommendations-v1'
          || !Array.isArray(data.sites) || data.sites.length !== shard.site_count) {
          throw new Error(`Invalid dive-site recommendation shard: ${shard.file}`);
        }
        return data.sites;
      }));
      sites = shards.flat();
      if (sites.length !== payload.site_count) throw new Error('Recommendation shard contents do not match the manifest');
    } else {
      throw new Error('Invalid dive-site recommendation catalog');
    }

    return sites.filter(site => site && uuid.test(site.site_id)
      && typeof site.name === 'string' && Number.isFinite(site.lat) && Number.isFinite(site.lon));
  }

  loadCatalog().then(sites => {
    window.DIVE_ATLAS_SEO_SEARCH_CATALOG = sites;
    window.dispatchEvent(new CustomEvent('diveatlas:seo-search-catalog-ready', { detail:{ sites } }));
  }).catch(error => {
    console.error('Dive-site search catalog could not be loaded.', error);
  });
})();
