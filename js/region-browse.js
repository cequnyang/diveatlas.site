(() => {
  'use strict';

  const PAGE_SIZE = 50;
  const AREA_PHOTO_R2_PREFIX = '/preview/';
  const title = document.getElementById('regionPageTitle');
  const breadcrumbs = document.getElementById('regionPageBreadcrumbs');
  const status = document.getElementById('regionPageStatus');
  const areaHero = document.getElementById('regionAreaPhoto');
  const areaHeroImage = document.getElementById('regionAreaPhotoImage');
  const areaHeroContext = document.getElementById('regionAreaPhotoContext');
  const areaHeroName = document.getElementById('regionAreaPhotoName');
  const areaSection = document.getElementById('regionAreaSection');
  const areaList = document.getElementById('regionAreaList');
  const siteSection = document.getElementById('regionSiteSection');
  const siteHeading = document.getElementById('regionSiteHeading');
  const search = document.getElementById('regionSiteSearch');
  const siteCount = document.getElementById('regionSiteCount');
  const siteList = document.getElementById('regionSiteList');
  const pagination = document.getElementById('regionPagination');
  const areasByKey = new Map();
  const photosByKey = new Map();
  let areaIndex;
  let currentArea = null;

  function normalized(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
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
    return `/regions/browse.html?area=${encodeURIComponent(key)}`;
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
    if (!assets?.external || typeof assets.baseUrl !== 'string') return null;

    // Area photos are published under the same R2 origin as data releases, in their own preview prefix.
    const base = new URL(assets.baseUrl);
    if (base.protocol !== 'https:') throw new Error('Area photo assets must use HTTPS.');
    return new URL(AREA_PHOTO_R2_PREFIX, base);
  }

  function areaPhotoUrl(photo, r2BaseUrl) {
    if (r2BaseUrl) {
      if (typeof photo.r2Key !== 'string' || !/^objects\/[a-f0-9]{64}\.webp$/.test(photo.r2Key)) return '';
      const url = new URL(photo.r2Key, r2BaseUrl);
      return url.origin === r2BaseUrl.origin ? url.href : '';
    }
    if (typeof photo.src !== 'string') return '';
    const url = new URL(photo.src, location.origin);
    return url.protocol === 'https:' || url.origin === location.origin ? url.href : '';
  }

  function renderAreaPhoto(area) {
    const photo = area ? photosByKey.get(area.key) : null;
    if (!photo || !areaHero) {
      if (areaHero) areaHero.hidden = true;
      return;
    }
    const count = Array.isArray(area.site_indices) ? area.site_indices.length : 0;
    areaHeroContext.textContent = indexedSiteCount(count);
    areaHeroName.textContent = area.label;
    areaHeroImage.alt = photo.alt || photo.photoDescription || photo.photoTitle || `Sourced photo for ${area.label}`;
    areaHeroImage.removeAttribute('title');
    areaHeroImage.src = photo.src;
    areaHeroImage.onerror = () => { areaHero.hidden = true; };
    areaHero.hidden = false;
  }

  function currentPage() {
    const value = Number.parseInt(new URLSearchParams(location.search).get('page') || '1', 10);
    return Number.isInteger(value) && value > 0 ? value : 1;
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
    const regions = document.createElement('span');
    regions.textContent = 'Regions';
    breadcrumbs.append(regions);
    for (const [index, item] of chain.entries()) {
      const separator = document.createElement('span');
      separator.setAttribute('aria-hidden', 'true');
      separator.textContent = '›';
      breadcrumbs.append(separator);
      if (index === chain.length - 1) {
        const current = document.createElement('span');
        current.setAttribute('aria-current', 'page');
        current.textContent = item.label;
        breadcrumbs.append(current);
      } else {
        const link = document.createElement('a');
        link.href = browseUrl(item.key);
        link.textContent = item.label;
        breadcrumbs.append(link);
      }
    }
  }

  function renderAreas(items) {
    areaList.replaceChildren();
    const ordered = [...items].sort((a, b) => {
      const photoOrder = Number(photosByKey.has(b.key)) - Number(photosByKey.has(a.key));
      return photoOrder || a.label.localeCompare(b.label);
    });
    for (const area of ordered) {
      const count = Array.isArray(area.site_indices) ? area.site_indices.length : 0;
      const photo = photosByKey.get(area.key);
      if (!photo) {
        const linkItem = createListItem(area.label, browseUrl(area.key), indexedSiteCount(count));
        linkItem.classList.add('region-area-card--text-only');
        linkItem.querySelector('.coordinates')?.classList.add('region-area-card__count');
        areaList.append(linkItem);
        continue;
      }

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
      image.alt = photo.alt || photo.photoDescription || photo.photoTitle || `Sourced photo for ${area.label}`;
      frame.setAttribute('aria-label', `Open ${area.label} area. Photo: ${image.alt}`);
      image.src = photo.src;
      image.addEventListener('error', () => { image.hidden = true; }, { once: true });
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
  }

  function renderSites() {
    if (!currentArea) return;
    const term = normalized(search.value.trim());
    const matching = currentArea.site_indices.filter(index => {
      const site = areaIndex.sites[index];
      if (!site || !term) return Boolean(site);
      return normalized([site.name, site.region, site.country].join(' ')).includes(term);
    });
    const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
    const page = Math.min(currentPage(), pageCount);
    const startIndex = (page - 1) * PAGE_SIZE;
    const visible = matching.slice(startIndex, startIndex + PAGE_SIZE);

    siteList.replaceChildren();
    for (const index of visible) {
      const site = areaIndex.sites[index];
      const detail = [site.region, site.country].filter(Boolean).join(' · ');
      siteList.append(createListItem(site.name, `/dive-site.html?id=${encodeURIComponent(site.site_id)}`, detail));
    }
    siteCount.textContent = matching.length
      ? `Showing ${(startIndex + 1).toLocaleString()}–${(startIndex + visible.length).toLocaleString()} of ${matching.length.toLocaleString()} matching sites · ${currentArea.site_indices.length.toLocaleString()} in this area`
      : `No dive sites match this search · ${currentArea.site_indices.length.toLocaleString()} in this area`;

    pagination.replaceChildren();
    if (pageCount > 1) {
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
      const photoManifestUrl = photoR2BaseUrl
        ? new URL('manifest.json', photoR2BaseUrl).href
        : '/datasets/area-photos.json';
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
        const validManifest = photoEntries && (photoR2BaseUrl
          ? photoPayload.schema === 'diveatlas-r2-area-photo-upload-v1'
            && photoPayload.r2Prefix === 'preview/'
            && photoPayload.readyCount === photoEntries.length
          : photoPayload.schema === 'dive-site-area-photo-manifest-v1');
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
      search.addEventListener('input', () => {
        const url = new URL(location.href);
        url.searchParams.delete('page');
        history.replaceState(null, '', url);
        renderSites();
      });
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
