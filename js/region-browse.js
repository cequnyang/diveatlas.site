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
  const areaHeroContext = document.getElementById('regionAreaPhotoContext');
  const areaHeroName = document.getElementById('regionAreaPhotoName');
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
  let areaIndex;
  let currentArea = null;

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

  function createListItem(linkText, href, detail = '') {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = href;
    link.textContent = linkText;
    item.append(link);
    if (detail) {
      const metadata = document.createElement('span');
      metadata.className = 'coordinates';
      metadata.textContent = detail;
      item.append(metadata);
    }
    return item;
  }

  function indexedSiteCount(count) {
    return `${count.toLocaleString()} indexed dive sites`;
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
    areaHeroContext.textContent = indexedSiteCount(count);
    areaHeroName.textContent = area.label;
    areaHeroImage.removeAttribute('title');
    if (typeof photo?.src === 'string' && photo.src.length > 0) {
      frame.classList.remove('region-area-card__frame--fallback');
      areaHeroImage.classList.remove('region-area-card__image--fallback');
      areaHeroImage.alt = photo.alt || photo.photoDescription || photo.photoTitle || `Sourced photo for ${area.label}`;
      areaHeroImage.onerror = () => useAreaLogoFallback(areaHeroImage, frame, area.label);
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
      separator.textContent = '›';
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
      areaPagination.className = 'region-browser__pagination';
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
      siteList.append(createListItem(site.name, `/dive-site.html?id=${encodeURIComponent(site.site_id)}`, detail));
    }
    siteCount.textContent = siteIndices.length
      ? `Showing ${(startIndex + 1).toLocaleString()}–${(startIndex + visible.length).toLocaleString()} of ${siteIndices.length.toLocaleString()} dive sites in this area`
      : 'No dive sites are currently indexed in this area.';

    pagination?.remove();
    pagination = null;
    if (pageCount > 1) {
      pagination = document.createElement('nav');
      pagination.className = 'region-browser__pagination';
      pagination.setAttribute('aria-label', 'Dive-site pages');
      siteList.after(pagination);
      const previous = document.createElement('button');
      previous.type = 'button';
      previous.textContent = 'Previous';
      previous.disabled = page <= 1;
      previous.addEventListener('click', () => setPage(page - 1));
      const pageLabel = document.createElement('span');
      pageLabel.textContent = `Page ${page.toLocaleString()} of ${pageCount.toLocaleString()}`;
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
    siteHeading.textContent = `Dive sites in ${area.label}`;
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
