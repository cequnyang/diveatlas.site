(() => {
  'use strict';

  const PAGE_SIZE = 50;
  const title = document.getElementById('regionPageTitle');
  const description = document.getElementById('regionPageDescription');
  const breadcrumbs = document.getElementById('regionPageBreadcrumbs');
  const status = document.getElementById('regionPageStatus');
  const areaSection = document.getElementById('regionAreaSection');
  const areaHeading = document.getElementById('regionAreaHeading');
  const areaList = document.getElementById('regionAreaList');
  const siteSection = document.getElementById('regionSiteSection');
  const siteHeading = document.getElementById('regionSiteHeading');
  const search = document.getElementById('regionSiteSearch');
  const siteCount = document.getElementById('regionSiteCount');
  const siteList = document.getElementById('regionSiteList');
  const pagination = document.getElementById('regionPagination');
  const areasByKey = new Map();
  let areaIndex;
  let currentArea = null;

  function normalized(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
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
    const regions = document.createElement('a');
    regions.href = '/regions/';
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
    const ordered = [...items].sort((a, b) => a.label.localeCompare(b.label));
    for (const area of ordered) {
      const count = Array.isArray(area.site_indices) ? area.site_indices.length : 0;
      areaList.append(createListItem(area.label, browseUrl(area.key), `${count.toLocaleString()} dive sites`));
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
    siteSection.hidden = true;
    areaSection.hidden = false;

    if (!areaKey) {
      title.textContent = 'Browse dive sites by area';
      document.title = 'Browse Dive Sites by Area | DiveAtlas';
      description.textContent = 'Choose a continent or starting area to see all dive sites with matching recorded locations.';
      areaHeading.textContent = 'Continents and starting areas';
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
    description.textContent = `${area.site_indices.length.toLocaleString()} dive sites have a matching recorded location in this area.`;
    showBreadcrumbs(area);
    areaHeading.textContent = `Explore areas in ${area.label}`;
    renderAreas(areaIndex.areas.filter(item => item.parent === area.key));
    siteSection.hidden = false;
    siteHeading.textContent = `Dive sites in ${area.label}`;
    renderSites();
  }

  async function start() {
    try {
      const response = await fetch('/regions/area-index.json', { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Region index request failed (${response.status})`);
      const payload = await response.json();
      if (payload?.schema !== 'dive-site-region-index-v1' || !Array.isArray(payload.areas)
        || !Array.isArray(payload.sites) || payload.site_count !== payload.sites.length) {
        throw new Error('The published region index has an unsupported format');
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
