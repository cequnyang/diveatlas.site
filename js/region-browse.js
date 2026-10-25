(() => {
  'use strict';

  const PAGE_SIZE = 30;
  const AREA_PHOTO_R2_PREFIX = '/preview/';
  const LOCAL_AREA_PHOTO_R2_BASE_URL = 'https://assets.diveatlas.site/preview/';
  const title = document.getElementById('regionPageTitle');
  const breadcrumbs = document.getElementById('regionPageBreadcrumbs');
  const status = document.getElementById('regionPageStatus');
  const areaHero = document.getElementById('regionAreaPhoto');
  const areaHeroImage = document.getElementById('regionAreaPhotoImage');
  const areaHeroAttribution = document.getElementById('regionAreaPhotoAttribution');
  const areaHeroDescription = document.getElementById('regionAreaDescription');
  const areaHeroMapLink = document.getElementById('regionAreaMapLink');
  const areaBrowser = document.getElementById('regionAreaBrowser');
  const destinationDirectory = document.getElementById('destinationDirectory');
  const areaSection = document.getElementById('regionAreaSection');
  const areaList = document.getElementById('regionAreaList');
  let areaPagination = null;
  const siteSection = document.getElementById('regionSiteSection');
  const siteHeading = document.getElementById('regionSiteHeading');
  const siteCount = document.getElementById('regionSiteCount');
  const siteList = document.getElementById('regionSiteList');
  let pagination = null;
  const areasByKey = new Map();
  const photosByKey = new Map();
  const recommendationSitesById = new Map();
  let areaIndex;
  let currentArea = null;
  let areaRatingStorePromise = null;
  let ratingRenderGeneration = 0;

  function setRecommendationSites(sites) {
    recommendationSitesById.clear();
    for (const site of sites) {
      if (site && typeof site.site_id === 'string') recommendationSitesById.set(site.site_id, site);
    }
    if (currentArea) renderSites();
  }

  window.addEventListener('diveatlas:seo-search-catalog-ready', event => {
    if (Array.isArray(event.detail?.sites)) setRecommendationSites(event.detail.sites);
  });
  if (Array.isArray(window.DIVE_ATLAS_SEO_SEARCH_CATALOG)) {
    setRecommendationSites(window.DIVE_ATLAS_SEO_SEARCH_CATALOG);
  }

  if (new URLSearchParams(location.search).has('area')) {
    document.documentElement.classList.add('region-area-detail-page');
    if (areaBrowser) areaBrowser.open = true;
    if (destinationDirectory) destinationDirectory.hidden = true;
  }

  function safeHttpsUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function browseUrl(key) {
    return `/regions/?area=${encodeURIComponent(key)}`;
  }

  function safeRecommendationPhoto(value) {
    if (typeof value !== 'string' || !value) return '';
    try {
      const url = new URL(value, location.origin);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function createRegionSiteCard(site) {
    const recommendation = recommendationSitesById.get(site.site_id) || {};
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'site-recommendations__card';
    link.dataset.recommendationCard = '';
    link.dataset.ratingLat = String(site.lat);
    link.dataset.ratingLng = String(site.lon);
    link.href = `/dive-site.html?id=${encodeURIComponent(site.site_id)}`;

    const photoUrl = safeRecommendationPhoto(recommendation.photo);
    if (photoUrl) {
      const image = document.createElement('img');
      image.className = 'site-recommendations__image';
      image.src = photoUrl;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      if (recommendation.photo_credit) image.title = recommendation.photo_credit;
      image.addEventListener('error', () => image.classList.add('site-recommendations__image--placeholder'), { once: true });
      link.append(image);
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'site-recommendations__image site-recommendations__image--placeholder';
      placeholder.setAttribute('aria-hidden', 'true');
      link.append(placeholder);
    }

    const body = document.createElement('span');
    body.className = 'site-recommendations__card-body';
    const name = document.createElement('span');
    name.className = 'site-recommendations__name';
    name.textContent = site.name;
    name.title = site.name;

    const meta = document.createElement('span');
    meta.className = 'site-recommendations__meta';
    const locationLabel = document.createElement('span');
    locationLabel.className = 'site-recommendations__location';
    locationLabel.textContent = recommendation.region || recommendation.country || site.region || site.country || '';
    const rating = document.createElement('span');
    rating.className = 'site-recommendations__rating';
    rating.setAttribute('aria-label', 'DiveAtlas rating');
    rating.textContent = 'Rating loading';
    meta.append(locationLabel, rating);

    const features = document.createElement('span');
    features.className = 'site-recommendations__features';
    features.setAttribute('aria-label', 'Recorded features');
    const featureValues = Array.isArray(recommendation.features)
      ? recommendation.features.filter(feature => typeof feature === 'string' && feature).slice(0, 2)
      : [];
    for (const feature of featureValues) {
      const badge = document.createElement('span');
      badge.className = 'site-recommendations__feature';
      badge.textContent = feature;
      features.append(badge);
    }
    if (!features.childElementCount) {
      const unavailable = document.createElement('span');
      unavailable.className = 'site-recommendations__feature site-recommendations__feature--empty';
      unavailable.textContent = 'Features unavailable';
      features.append(unavailable);
    }

    body.append(name, meta, features);
    link.append(body);
    item.append(link);
    return item;
  }

  function loadAreaRatingStore() {
    if (!areaRatingStorePromise) {
      areaRatingStorePromise = (async () => {
        await import('./dive-experience-outlook-map.js?v=7');
        const outlook = window.DiveAtlasDiveExperienceMap;
        if (!outlook) throw new Error('Dive Experience Outlook module did not initialize.');
        const assets = window.DiveAtlasDataAssets;
        const manifestUrl = assets?.external && typeof assets.url === 'function'
          ? assets.url('data/dive-experience-outlook/v3/manifest.json')
          : new URL('/data/dive-experience-outlook/v3/manifest.json', location.origin).href;
        return outlook.createDataStore({
          baseUrl: new URL('./', manifestUrl).href,
          landMaskUrl: new URL('/datasets/dive-experience-land-mask-v1.bin.gz', location.origin).href,
        });
      })();
      areaRatingStorePromise.catch(() => { areaRatingStorePromise = null; });
    }
    return areaRatingStorePromise;
  }

  function refreshRegionSiteRatings(cards) {
    const generation = ++ratingRenderGeneration;
    if (!cards.length) return;
    loadAreaRatingStore().then(async store => {
      // Use the same current-month environmental sample as detail-page recommendation cards.
      const month = new Date().getMonth() + 1;
      for (const [index, card] of cards.entries()) {
        if (generation !== ratingRenderGeneration) return;
        const rating = card.querySelector('.site-recommendations__rating');
        const lat = Number(card.dataset.ratingLat);
        const lng = Number(card.dataset.ratingLng);
        if (!rating || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        try {
          const result = await store.sample({ lat, lng }, month);
          rating.textContent = result?.score == null ? 'Rating unavailable' : `${Math.round(result.score)}/100`;
        } catch (_) {
          rating.textContent = 'Rating unavailable';
        }
        if ((index + 1) % 8 === 0) await new Promise(resolve => window.setTimeout(resolve, 0));
      }
    }).catch(() => {
      if (generation !== ratingRenderGeneration) return;
      for (const card of cards) {
        const rating = card.querySelector('.site-recommendations__rating');
        if (rating) rating.textContent = 'Rating unavailable';
      }
    });
  }

  function indexedSiteCount(count) {
    return `${count.toLocaleString()} indexed dive sites`;
  }

  function appendPhotoAttributionPart(container, className, value, href = '') {
    if (!value) return;
    if (container.childNodes.length > 0) {
      const separator = document.createElement('span');
      separator.className = 'destination-photo__separator';
      separator.setAttribute('aria-hidden', 'true');
      separator.textContent = ' · ';
      container.append(separator);
    }
    const part = document.createElement(href ? 'a' : 'span');
    part.className = className;
    part.textContent = value;
    if (href) {
      part.href = href;
      part.target = '_blank';
      part.rel = className === 'destination-photo__terms'
        ? 'license noopener noreferrer'
        : 'noopener noreferrer';
    }
    container.append(part);
  }

  function renderPhotoAttribution(photo) {
    areaHeroAttribution.replaceChildren();
    if (!photo) {
      areaHeroAttribution.hidden = true;
      return;
    }
    const sourcePage = safeHttpsUrl(photo?.sourcePage);
    appendPhotoAttributionPart(
      areaHeroAttribution,
      'destination-photo__title',
      typeof photo?.photoTitle === 'string' ? photo.photoTitle : 'Photo source',
      sourcePage,
    );
    appendPhotoAttributionPart(
      areaHeroAttribution,
      'destination-photo__credit',
      typeof photo?.credit === 'string' ? photo.credit : '',
    );
    appendPhotoAttributionPart(areaHeroAttribution, 'destination-photo__change', 'WebP conversion');
    appendPhotoAttributionPart(
      areaHeroAttribution,
      'destination-photo__terms',
      typeof photo?.license === 'string' ? photo.license : '',
      safeHttpsUrl(photo?.licenseUrl),
    );
    areaHeroAttribution.hidden = areaHeroAttribution.childNodes.length === 0;
  }

  function areaLocations(area) {
    if (!Array.isArray(area?.site_indices) || !Array.isArray(areaIndex?.sites)) return [];
    return area.site_indices
      .map(index => areaIndex.sites[index])
      .filter(site => Number.isFinite(site?.lat) && Number.isFinite(site?.lon));
  }

  function coordinateRange(locations) {
    if (locations.length === 0) return '';
    const range = locations.reduce((bounds, site) => ({
      minLatitude: Math.min(bounds.minLatitude, site.lat),
      maxLatitude: Math.max(bounds.maxLatitude, site.lat),
      minLongitude: Math.min(bounds.minLongitude, site.lon),
      maxLongitude: Math.max(bounds.maxLongitude, site.lon),
    }), {
      minLatitude: Infinity,
      maxLatitude: -Infinity,
      minLongitude: Infinity,
      maxLongitude: -Infinity,
    });
    return `${range.minLatitude.toFixed(5)} to ${range.maxLatitude.toFixed(5)} latitude; `
      + `${range.minLongitude.toFixed(5)} to ${range.maxLongitude.toFixed(5)} longitude`;
  }

  function areaPhotoR2BaseUrl() {
    const assets = window.DiveAtlasDataAssets;
    if (!assets?.external || typeof assets.baseUrl !== 'string') {
      // A plain local server has no injected production data base, but area previews are still published in R2.
      return new URL(LOCAL_AREA_PHOTO_R2_BASE_URL);
    }

    // Area photos are published under the same R2 origin as data releases, in their own preview prefix.
    const base = new URL(assets.baseUrl);
    if (base.protocol !== 'https:') throw new Error('Area photo assets must use HTTPS.');
    return new URL(AREA_PHOTO_R2_PREFIX, base);
  }

  function areaPhotoUrl(photo, r2BaseUrl) {
    if (typeof photo.r2Key !== 'string' || !/^objects\/[a-f0-9]{64}\.webp$/.test(photo.r2Key)) return '';
    const url = new URL(photo.r2Key, r2BaseUrl);
    return url.origin === r2BaseUrl.origin ? url.href : '';
  }

  function useAreaLogoFallback(image, frame, areaLabel) {
    image.onerror = null;
    frame.classList.add('region-area-card__frame--fallback');
    image.classList.add('region-area-card__image--fallback');
    image.alt = `DiveAtlas logo; no representative photo is available for ${areaLabel}`;
    image.src = '/assets/diveatlas-logo.svg?v=3';
    if (frame instanceof HTMLAnchorElement) {
      frame.setAttribute('aria-label', `Open ${areaLabel} area. No representative photo is available; showing the DiveAtlas logo.`);
    }
  }

  function renderAreaPhoto(area) {
    if (!area || !areaHero) {
      if (areaHero) areaHero.hidden = true;
      return;
    }
    const photo = photosByKey.get(area.key);
    const frame = areaHero.querySelector('.region-area-card__frame');
    const count = Array.isArray(area.site_indices) ? area.site_indices.length : 0;
    const locations = areaLocations(area);
    const bounds = coordinateRange(locations);
    areaHeroDescription.textContent = `This page lists ${count.toLocaleString()} dive sites with recorded country and region fields matching this destination.`
      + (bounds ? ` The coordinate range is ${bounds}.` : '');
    if (locations.length > 0) {
      const latitude = locations.reduce((sum, site) => sum + site.lat, 0) / locations.length;
      const longitude = locations.reduce((sum, site) => sum + site.lon, 0) / locations.length;
      areaHeroMapLink.href = `/?lat=${latitude.toFixed(5)}&lng=${longitude.toFixed(5)}&z=7&layers=dive`;
      areaHeroMapLink.hidden = false;
    } else {
      areaHeroMapLink.hidden = true;
    }
    renderPhotoAttribution(photo);
    areaHeroImage.removeAttribute('title');
    if (typeof photo?.src === 'string' && photo.src.length > 0) {
      frame.classList.remove('region-area-card__frame--fallback');
      areaHeroImage.classList.remove('region-area-card__image--fallback');
      areaHeroImage.alt = photo.alt || photo.photoDescription || photo.photoTitle || `Sourced photo for ${area.label}`;
      areaHeroImage.onerror = () => {
        useAreaLogoFallback(areaHeroImage, frame, area.label);
        areaHeroAttribution.hidden = true;
      };
      areaHeroImage.src = photo.src;
    } else {
      useAreaLogoFallback(areaHeroImage, frame, area.label);
    }
    areaHero.hidden = false;
  }

  function currentPage() {
    const value = Number.parseInt(new URLSearchParams(location.search).get('page') || '1', 10);
    return Number.isInteger(value) && value > 0 ? value : 1;
  }

  function currentAreaPage() {
    const value = Number.parseInt(new URLSearchParams(location.search).get('areaPage') || '1', 10);
    return Number.isInteger(value) && value > 0 ? value : 1;
  }

  function setAreaPage(page, items) {
    const url = new URL(location.href);
    if (page <= 1) url.searchParams.delete('areaPage');
    else url.searchParams.set('areaPage', String(page));
    history.pushState(null, '', url);
    renderAreas(items);
  }

  function setPage(page) {
    const url = new URL(location.href);
    if (page <= 1) url.searchParams.delete('page');
    else url.searchParams.set('page', String(page));
    history.pushState(null, '', url);
    renderSites();
  }

  function showBreadcrumbs(area) {
    const chain = [];
    const visited = new Set();
    let cursor = area;
    while (cursor && !visited.has(cursor.key)) {
      visited.add(cursor.key);
      chain.unshift(cursor);
      cursor = cursor.parent ? areasByKey.get(cursor.parent) : null;
    }

    breadcrumbs.replaceChildren();
    breadcrumbs.hidden = false;
    const regions = document.createElement('a');
    regions.href = '/regions/';
    regions.textContent = 'Regions';
    breadcrumbs.append(regions);
    for (const [index, item] of chain.entries()) {
      const separator = document.createElement('span');
      separator.setAttribute('aria-hidden', 'true');
      separator.textContent = '/';
      breadcrumbs.append(separator);
      const link = document.createElement('a');
      link.href = browseUrl(item.key);
      link.textContent = item.label;
      if (index === chain.length - 1) link.setAttribute('aria-current', 'page');
      breadcrumbs.append(link);
    }
  }

  function renderAreas(items) {
    areaList.replaceChildren();
    const ordered = [...items].sort((a, b) => {
      const photoOrder = Number(photosByKey.has(b.key)) - Number(photosByKey.has(a.key));
      return photoOrder || a.label.localeCompare(b.label);
    });
    const pageCount = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
    const page = Math.min(currentAreaPage(), pageCount);
    const startIndex = (page - 1) * PAGE_SIZE;
    const visible = ordered.slice(startIndex, startIndex + PAGE_SIZE);
    for (const area of visible) {
      const count = Array.isArray(area.site_indices) ? area.site_indices.length : 0;
      const photo = photosByKey.get(area.key);
      const hasPhoto = typeof photo?.src === 'string' && photo.src.length > 0;

      const item = document.createElement('li');
      item.className = 'region-area-card';
      const article = document.createElement('article');
      const figure = document.createElement('figure');
      const frame = document.createElement('a');
      frame.className = 'region-area-card__frame';
      frame.href = browseUrl(area.key);
      const image = document.createElement('img');
      image.className = 'region-area-card__image';
      image.loading = 'lazy';
      image.decoding = 'async';
      if (hasPhoto) {
        image.alt = photo.alt || photo.photoDescription || photo.photoTitle || `Sourced photo for ${area.label}`;
        frame.setAttribute('aria-label', `Open ${area.label} area. Photo: ${image.alt}`);
        image.src = photo.src;
        image.addEventListener('error', () => useAreaLogoFallback(image, frame, area.label), { once: true });
      } else {
        useAreaLogoFallback(image, frame, area.label);
      }
      frame.append(image);

      const caption = document.createElement('figcaption');
      caption.className = 'region-area-card__caption';
      const name = document.createElement('h3');
      name.className = 'region-area-card__name';
      const areaLink = document.createElement('a');
      areaLink.href = browseUrl(area.key);
      areaLink.textContent = area.label;
      name.append(areaLink);

      const placeLine = document.createElement('div');
      placeLine.className = 'region-area-card__place-line';
      const context = document.createElement('span');
      context.className = 'region-area-card__count';
      context.textContent = indexedSiteCount(count);
      placeLine.append(name, context);

      caption.append(placeLine);
      figure.append(frame, caption);
      article.append(figure);
      item.append(article);
      areaList.append(item);
    }
    areaSection.hidden = ordered.length === 0;
    areaPagination?.remove();
    areaPagination = null;
    if (pageCount > 1) {
      areaPagination = document.createElement('nav');
      areaPagination.className = 'region-list-pagination';
      areaPagination.setAttribute('aria-label', 'Area pages');
      areaList.after(areaPagination);
      const previous = document.createElement('button');
      previous.type = 'button';
      previous.textContent = 'Previous';
      previous.disabled = page <= 1;
      previous.addEventListener('click', () => setAreaPage(page - 1, ordered));
      const pageLabel = document.createElement('span');
      const endIndex = startIndex + visible.length;
      pageLabel.textContent = `Page ${page.toLocaleString()} of ${pageCount.toLocaleString()} · showing ${(startIndex + 1).toLocaleString()}–${endIndex.toLocaleString()} of ${ordered.length.toLocaleString()} areas`;
      const next = document.createElement('button');
      next.type = 'button';
      next.textContent = 'Next';
      next.disabled = page >= pageCount;
      next.addEventListener('click', () => setAreaPage(page + 1, ordered));
      areaPagination.append(previous, pageLabel, next);
    }
  }

  function renderSites() {
    if (!currentArea) return;
    const siteIndices = currentArea.site_indices.filter(index => areaIndex.sites[index]);
    const pageCount = Math.max(1, Math.ceil(siteIndices.length / PAGE_SIZE));
    const page = Math.min(currentPage(), pageCount);
    const startIndex = (page - 1) * PAGE_SIZE;
    const visible = siteIndices.slice(startIndex, startIndex + PAGE_SIZE);

    siteList.replaceChildren();
    for (const index of visible) {
      const site = areaIndex.sites[index];
      const detail = [site.region, site.country].filter(Boolean).join(' · ');
      siteList.append(createRegionSiteCard(site));
    }
    refreshRegionSiteRatings([...siteList.querySelectorAll('.site-recommendations__card')]);
    siteCount.textContent = siteIndices.length
      ? `Showing ${(startIndex + 1).toLocaleString()}–${(startIndex + visible.length).toLocaleString()} of ${siteIndices.length.toLocaleString()} dive sites in this area`
      : 'No dive sites are currently indexed in this area.';

    pagination?.remove();
    pagination = null;
    if (pageCount > 1) {
      pagination = document.createElement('nav');
      pagination.className = 'region-list-pagination';
      pagination.setAttribute('aria-label', 'Dive-site pages');
      siteList.after(pagination);
      const previous = document.createElement('button');
      previous.type = 'button';
      previous.textContent = 'Previous';
      previous.disabled = page <= 1;
      previous.addEventListener('click', () => setPage(page - 1));
      const pageLabel = document.createElement('span');
      const endIndex = startIndex + visible.length;
      pageLabel.textContent = `Page ${page.toLocaleString()} of ${pageCount.toLocaleString()} · showing ${(startIndex + 1).toLocaleString()}–${endIndex.toLocaleString()} of ${siteIndices.length.toLocaleString()} dive sites`;
      const next = document.createElement('button');
      next.type = 'button';
      next.textContent = 'Next';
      next.disabled = page >= pageCount;
      next.addEventListener('click', () => setPage(page + 1));
      pagination.append(previous, pageLabel, next);
    }
  }

  function renderPage() {
    const areaKey = new URLSearchParams(location.search).get('area');
    const area = areaKey ? areasByKey.get(areaKey) : null;
    currentArea = area;
    status.hidden = true;
    breadcrumbs.hidden = true;
    renderAreaPhoto(null);
    siteSection.hidden = true;
    areaSection.hidden = false;

    if (!areaKey) {
      title.textContent = 'Dive Site Regions';
      document.title = 'Dive Site Regions | DiveAtlas';
      renderAreas(areaIndex.areas.filter(item => !item.parent));
      return;
    }
    if (!area) {
      document.title = 'Dive Site Areas | DiveAtlas';
      status.textContent = 'This area link is no longer available in the published dive-site data. Browse all current areas instead.';
      status.hidden = false;
      renderAreas(areaIndex.areas.filter(item => !item.parent));
      return;
    }

    title.textContent = `Dive Sites in ${area.label}`;
    document.title = `${title.textContent} | DiveAtlas`;
    showBreadcrumbs(area);
    renderAreaPhoto(area);
    renderAreas(areaIndex.areas.filter(item => item.parent === area.key));
    siteSection.hidden = false;
    siteHeading.textContent = `Dive sites (${area.site_indices.length.toLocaleString()})`;
    renderSites();
  }

  async function start() {
    try {
      const photoR2BaseUrl = areaPhotoR2BaseUrl();
      const photoManifestUrl = new URL('manifest.json', photoR2BaseUrl).href;
      const [response, photoResponse] = await Promise.all([
        fetch('/regions/area-index.json', { cache: 'no-store', signal: AbortSignal.timeout(20000) }),
        fetch(photoManifestUrl, { cache: 'no-store', signal: AbortSignal.timeout(20000) }).catch(() => null),
      ]);
      if (!response.ok) throw new Error(`Region index request failed (${response.status})`);
      const payload = await response.json();
      if (payload?.schema !== 'dive-site-region-index-v1' || !Array.isArray(payload.areas)
        || !Array.isArray(payload.sites) || payload.site_count !== payload.sites.length) {
        throw new Error('The published region index has an unsupported format');
      }
      if (photoResponse?.ok) {
        let photoPayload = null;
        try {
          photoPayload = await photoResponse.json();
        } catch (_) {
          // Area photos are optional; a bad photo manifest should not hide the area index.
        }
        const photoEntries = Array.isArray(photoPayload?.entries) ? photoPayload.entries : null;
        const validManifest = photoEntries
          && photoPayload.schema === 'diveatlas-r2-area-photo-upload-v1'
          && photoPayload.r2Prefix === 'preview/'
          && photoPayload.readyCount === photoEntries.length;
        if (validManifest) {
          for (const photo of photoEntries) {
            if (photo && typeof photo.areaKey === 'string') {
              try {
                const imageUrl = areaPhotoUrl(photo, photoR2BaseUrl);
                if (imageUrl) {
                  photosByKey.set(photo.areaKey, {
                    ...photo,
                    src: imageUrl,
                    sourcePage: safeHttpsUrl(photo.sourcePage),
                    licenseUrl: safeHttpsUrl(photo.licenseUrl),
                  });
                }
              } catch (_) {
                // Ignore malformed image URLs while keeping text-only area links usable.
              }
            }
          }
        }
      }
      areaIndex = payload;
      for (const area of payload.areas) {
        if (area && typeof area.key === 'string' && typeof area.label === 'string'
          && Array.isArray(area.site_indices)) areasByKey.set(area.key, area);
      }
      window.addEventListener('popstate', renderPage);
      renderPage();
    } catch (error) {
      status.textContent = 'Dive-site area data could not be loaded. Please try again later or open the DiveAtlas map.';
      const mapLink = document.createElement('a');
      mapLink.href = '/';
      mapLink.textContent = 'Open the map';
      status.append(' ', mapLink);
      status.hidden = false;
      console.error('Could not load the DiveAtlas region index:', error);
    }
  }

  start();
})();
