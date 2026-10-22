(() => {
  'use strict';

  const page = document.getElementById('detailPage');
  // Large feature and difficulty matches stay out of the initial DOM until requested.
  const recommendationPreviewLimit = 5;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const idValue = new URLSearchParams(location.search).get('id')?.toLowerCase() || '';
  const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  const idMatch = idValue.match(new RegExp(`^(?:[a-z0-9]+(?:[-_][a-z0-9]+)*[-_])?(${uuidPattern})$`, 'i'));
  const siteId = idMatch?.[1] || '';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
  const safeUrl = value => {
    if (typeof value !== 'string' || !value) return '';
    try {
      const url = new URL(value, location.origin + '/');
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch (_) { return ''; }
  };
  const safeRegionBrowseUrl = value => {
    if (typeof value !== 'string') return '';
    try {
      const url = new URL(value, location.origin);
      return url.origin === location.origin && url.pathname === '/regions/browse.html'
        && url.searchParams.has('area') ? `${url.pathname}${url.search}` : '';
    } catch (_) { return ''; }
  };
  const siteSlug = name => String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'dive-site';
  const detailUrl = site => `/dive-site.html?id=${encodeURIComponent(`${siteSlug(site.name)}-${site.site_id}`)}`;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
  }

  function showError(title, message, retry = false) {
    document.querySelectorAll('.seo-top-menu-controls, .seo-menu-wrap').forEach(control => { control.hidden = true; });
    page.setAttribute('aria-busy', 'false');
    page.innerHTML = `<section role="status"><h1>${escape(title)}</h1><p>${escape(message)}</p>
      ${retry ? '<button type="button" class="seo-primary-button" id="retryDetails">Try again</button>' : ''}
      <p><a href="/">Return to the DiveAtlas map</a></p></section>`;
    document.getElementById('retryDetails')?.addEventListener('click', () => location.reload());
    document.title = `${title} | DiveAtlas`;
  }

  function validate(record) {
    if (record?.schema !== 'dive-site-detail-v1' || record.site_id !== siteId
      || typeof record.name !== 'string' || !record.name.trim()
      || !Number.isFinite(record.lat) || Math.abs(record.lat) > 90
      || !Number.isFinite(record.lon) || Math.abs(record.lon) > 180
      || !record.categories || typeof record.categories !== 'object'
      || !Array.isArray(record.sources) || !Array.isArray(record.related)) {
      throw new Error('Invalid dive-site record');
    }
    return record;
  }

  function recommendationDistance(site, candidate) {
    const latitudeDelta = candidate.lat - site.lat;
    const longitudeDelta = (candidate.lon - site.lon) * Math.cos(site.lat * Math.PI / 180);
    return latitudeDelta ** 2 + longitudeDelta ** 2;
  }

  function recommendationDifficulty(value) {
    const levels = String(value || '').split(/\s*(?:\||,|;|\bto\b)\s*/i).map(level => level.toLowerCase());
    return ['beginner', 'intermediate', 'advanced', 'expert'].find(level => levels.includes(level)) || '';
  }

  function recommendationTokens(value) {
    return String(value || '').split(/\s*(?:\||,|;)\s*/).map(token => token.trim()).filter(Boolean);
  }

  function spreadByPreview(values, getPreview = candidate => candidate?.photo?.src || candidate?.photo) {
    const groups = new Map();
    values.forEach((value, index) => {
      let preview = '';
      try { preview = getPreview(value); } catch (_) { /* Keep malformed previews together. */ }
      if (preview) {
        const source = String(preview).trim();
        try { preview = new URL(source, location.origin + '/').href; }
        catch (_) { preview = source; }
      } else {
        preview = '';
      }
      if (!groups.has(preview)) groups.set(preview, { items:[], firstIndex:index, nextIndex:0, priority:index });
      const group = groups.get(preview);
      group.items.push({ value, index });
    });

    // Keep shuffling local to six ranked image groups, favor the front of that window,
    // and discount (rather than exclude) the previous image so two-image lists can vary.
    const randomLookahead = 6;
    const rankWindow = 4;
    const repeatedPreviewWeight = 0.35;
    const heap = [];
    const outranks = (left, right) => left.priority < right.priority
      || (left.priority === right.priority && left.firstIndex < right.firstIndex);
    const push = group => {
      let index = heap.push(group) - 1;
      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);
        if (!outranks(heap[index], heap[parent])) break;
        [heap[index], heap[parent]] = [heap[parent], heap[index]];
        index = parent;
      }
    };
    const pop = () => {
      const first = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let index = 0;
        while (true) {
          const left = index * 2 + 1;
          const right = left + 1;
          let best = index;
          if (left < heap.length && outranks(heap[left], heap[best])) best = left;
          if (right < heap.length && outranks(heap[right], heap[best])) best = right;
          if (best === index) break;
          [heap[index], heap[best]] = [heap[best], heap[index]];
          index = best;
        }
      }
      return first;
    };

    for (const group of groups.values()) push(group);
    const ordered = [];
    let previous = null;
    while (heap.length) {
      const choices = [];
      while (heap.length && choices.length < randomLookahead) choices.push(pop());
      const firstPriority = choices[0].priority;
      const weights = choices.map(group => {
        const rankWeight = 1 / (1 + (group.priority - firstPriority) / rankWindow);
        return rankWeight * (group === previous && choices.length > 1 ? repeatedPreviewWeight : 1);
      });
      let target = Math.random() * weights.reduce((sum, weight) => sum + weight, 0);
      let selected = choices.length - 1;
      for (let index = 0; index < choices.length; index += 1) {
        target -= weights[index];
        if (target < 0) {
          selected = index;
          break;
        }
      }

      const group = choices[selected];
      ordered.push(group.items[group.nextIndex].value);
      group.nextIndex += 1;
      if (group.nextIndex < group.items.length) {
        group.priority = group.items[group.nextIndex].index;
        push(group);
      }
      previous = group;
      choices.forEach((candidate, index) => { if (index !== selected) push(candidate); });
    }
    return ordered;
  }

  // Add local variety while preserving candidate order within each preview group.
  window.DiveAtlasRecommendationOrdering = { spreadByPreview };

  async function renderRecommendations(site) {
    const aside = document.getElementById('relatedSites');
    if (!aside) return;
    const relatedFallback = () => {
      const related = spreadByPreview((site.related || [])
        .filter(other => uuid.test(other.site_id) && other.site_id !== siteId)).slice(0, 8);
      if (!related.length) return;
      aside.innerHTML = `<h2>More in this region</h2><ul>${related.map(other => {
        const image = safeUrl(other.photo?.src);
        return `<li><a class="site-recommendations__card" href="${detailUrl(other)}">${image ? `<img class="site-recommendations__image" src="${escape(image)}" alt="" loading="lazy">` : '<span class="site-recommendations__image site-recommendations__image--placeholder" aria-hidden="true"></span>'}<span class="site-recommendations__card-body"><span class="site-recommendations__name">${escape(other.name)}</span><span class="site-recommendations__location">${escape(other.region)}</span></span></a></li>`;
      }).join('')}</ul>`;
      aside.hidden = false;
    };

    try {
      const response = await fetch(window.DiveAtlasDataAssets.url('data/dive-site-details/v2/recommendations.json'),
        { signal:AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Recommendation catalog HTTP ${response.status}`);
      const payload = await response.json();
      let catalogSites;
      if (payload?.schema === 'dive-site-recommendations-v1' && Array.isArray(payload.sites)) {
        // Keep compatibility with releases that still publish one catalog file.
        catalogSites = payload.sites;
      } else if (payload?.schema === 'dive-site-recommendation-manifest-v1'
        && Number.isSafeInteger(payload.site_count) && payload.site_count >= 0
        && Array.isArray(payload.shards)) {
        const shardNames = new Set();
        const expectedCount = payload.shards.reduce((sum, shard) => {
          if (!shard || !/^recommendations-\d{4}\.json$/.test(shard.file)
            || shardNames.has(shard.file) || !Number.isSafeInteger(shard.site_count) || shard.site_count < 1) {
            throw new Error('Invalid dive-site recommendation shard manifest');
          }
          shardNames.add(shard.file);
          return sum + shard.site_count;
        }, 0);
        if (expectedCount !== payload.site_count) throw new Error('Recommendation shard counts do not match the manifest');
        const shardPayloads = await Promise.all(payload.shards.map(async shard => {
          const shardResponse = await fetch(window.DiveAtlasDataAssets.url(
            `data/dive-site-details/v2/${shard.file}`), { signal:AbortSignal.timeout(15000) });
          if (!shardResponse.ok) throw new Error(`Recommendation shard HTTP ${shardResponse.status}`);
          const shardPayload = await shardResponse.json();
          if (shardPayload?.schema !== 'dive-site-recommendations-v1'
            || !Array.isArray(shardPayload.sites) || shardPayload.sites.length !== shard.site_count) {
            throw new Error(`Invalid dive-site recommendation shard: ${shard.file}`);
          }
          return shardPayload.sites;
        }));
        catalogSites = shardPayloads.flat();
        if (catalogSites.length !== payload.site_count) throw new Error('Recommendation shard contents do not match the manifest');
      } else {
        throw new Error('Invalid dive-site recommendation catalog');
      }
      // Share this already-loaded compact catalog with the header control; site pages do not need the map's full search dataset.
      window.DIVE_ATLAS_SEO_SEARCH_CATALOG = catalogSites.filter(candidate => candidate && uuid.test(candidate.site_id)
        && typeof candidate.name === 'string' && Number.isFinite(candidate.lat) && Number.isFinite(candidate.lon));
      window.dispatchEvent(new CustomEvent('diveatlas:seo-search-catalog-ready', {
        detail:{ sites:window.DIVE_ATLAS_SEO_SEARCH_CATALOG }
      }));
      const candidates = window.DIVE_ATLAS_SEO_SEARCH_CATALOG.filter(candidate => candidate.site_id !== siteId);
      const comparable = value => String(value || '').toLowerCase();
      const distanceSorted = values => values.sort((a, b) => recommendationDistance(site, a)
        - recommendationDistance(site, b) || a.name.localeCompare(b.name));
      const nearby = spreadByPreview(distanceSorted(candidates.filter(candidate => site.region
        ? comparable(candidate.country) === comparable(site.country)
          && comparable(candidate.region) === comparable(site.region)
        : site.country && comparable(candidate.country) === comparable(site.country))));
      const primaryFeatures = recommendationTokens(site.categories?.features || site.characteristics).slice(0, 2);
      const primaryFeatureKeys = new Set(primaryFeatures.map(feature => feature.toLowerCase()));
      const features = spreadByPreview(candidates.map(candidate => ({ candidate,
        matches:recommendationTokens(candidate.feature_values || candidate.features)
          .filter(feature => primaryFeatureKeys.has(feature.toLowerCase())).length
      })).filter(item => item.matches > 0)
        .sort((a, b) => b.matches - a.matches
          || recommendationDistance(site, a.candidate) - recommendationDistance(site, b.candidate)
          || a.candidate.name.localeCompare(b.candidate.name)).map(item => item.candidate));
      const difficulty = recommendationDifficulty(site.difficulty);
      const difficultyMatches = spreadByPreview(distanceSorted(candidates.filter(candidate => difficulty
        && recommendationDifficulty(candidate.difficulty) === difficulty)));
      // Ratings can be compared against the full catalog on demand; keep that
      // large list out of the DOM attribute so it isn't serialized twice.
      const ratingCandidates = candidates;
      const featureLabel = primaryFeatures.length
        ? `<span class="site-recommendations__feature-values"> · ${escape(primaryFeatures.join(' · '))}</span>` : '';
      const card = (candidate, expanded = false) => {
        const image = safeUrl(candidate.photo);
        const featuresMarkup = (Array.isArray(candidate.features) ? candidate.features : []).slice(0, 2).map(feature =>
          `<span class="site-recommendations__feature">${escape(feature)}</span>`).join('')
          || '<span class="site-recommendations__feature site-recommendations__feature--empty">Features unavailable</span>';
        return `<li${expanded ? ' data-recommendation-expanded-item' : ''}><a class="site-recommendations__card" data-recommendation-card data-rating-lat="${candidate.lat}" data-rating-lng="${candidate.lon}" href="${detailUrl(candidate)}">${image
          ? `<img class="site-recommendations__image" src="${escape(image)}" alt="" loading="lazy"${candidate.photo_credit ? ` title="${escape(candidate.photo_credit)}"` : ''}>`
          : '<span class="site-recommendations__image site-recommendations__image--placeholder" aria-hidden="true"></span>'}<span class="site-recommendations__card-body"><span class="site-recommendations__name" title="${escape(candidate.name)}">${escape(candidate.name)}</span><span class="site-recommendations__meta"><span class="site-recommendations__location">${escape(candidate.region || candidate.country || '')}</span><span class="site-recommendations__rating" aria-label="diveAtlas Rating">Rating loading</span></span><span class="site-recommendations__features" aria-label="Recorded features">${featuresMarkup}</span></span></a></li>`;
      };
      const group = (key, values, emptyText) => `<section class="site-recommendations__group" data-recommendation-group="${key}"><ul>${values.length
        ? values.slice(0, recommendationPreviewLimit).map(candidate => card(candidate)).join('') : `<li class="site-recommendations__empty">${emptyText}</li>`}</ul></section>`;
      const ratingGroup = '<section class="site-recommendations__group" data-recommendation-group="rating"><ul data-recommendation-rating-candidates aria-live="polite"><li class="site-recommendations__empty">Select Rating to compare this site with the full catalog.</li></ul></section>';
      aside.innerHTML = `<div class="site-recommendations__tabs" hidden><button class="site-recommendations__scroll" type="button" data-recommendation-scroll="-1" aria-label="Scroll recommendation filters left"><span class="site-recommendations__scroll-glyph" aria-hidden="true">‹</span></button><div class="site-recommendations__tablist" role="tablist" aria-label="Recommendation filters" tabindex="0"><button type="button" role="tab" id="recommendation-tab-all" aria-controls="recommendation-panel" aria-selected="true" data-recommendation-tab="all">All</button><button type="button" role="tab" id="recommendation-tab-nearby" aria-controls="recommendation-panel" aria-selected="false" data-recommendation-tab="nearby" tabindex="-1">Nearby</button><button type="button" role="tab" id="recommendation-tab-rating" aria-controls="recommendation-panel" aria-selected="false" data-recommendation-tab="rating" tabindex="-1">Rating</button><button type="button" role="tab" id="recommendation-tab-features" aria-controls="recommendation-panel" aria-selected="false" data-recommendation-tab="features" tabindex="-1">Features${featureLabel}</button><button type="button" role="tab" id="recommendation-tab-difficulty" aria-controls="recommendation-panel" aria-selected="false" data-recommendation-tab="difficulty" tabindex="-1">Difficulty</button></div><button class="site-recommendations__scroll" type="button" data-recommendation-scroll="1" aria-label="Scroll recommendation filters right"><span class="site-recommendations__scroll-glyph" aria-hidden="true">›</span></button></div><div class="site-recommendations__content" id="recommendation-panel" data-recommendation-content>${group('nearby', nearby, 'No nearby sites are available in the full catalog.')}${ratingGroup}${group('features', features, primaryFeatures.length ? 'No sites match the recorded features.' : 'No primary features are recorded for this site.')}${group('difficulty', difficultyMatches, difficulty ? 'No sites with the same recorded difficulty are available.' : 'Difficulty is not recorded for this site.')}</div>`;
      aside.querySelector('[data-recommendation-rating-candidates]').recommendationCandidates = ratingCandidates;
      for (const [key, values] of Object.entries({ nearby, features, difficulty:difficultyMatches })) {
        const list = aside.querySelector(`[data-recommendation-group="${key}"] ul`);
        list.recommendationTotal = values.length;
        list.recommendationRenderMore = (start, count) => values.slice(start, start + count)
          .map(candidate => card(candidate, true)).join('');
      }
      aside.hidden = false;
    } catch (error) {
      console.warn('Dive-site recommendations could not be loaded; showing regional sites instead.', error);
      relatedFallback();
    }
  }

  function render(site) {
    document.title = `${site.name} Dive Site | DiveAtlas`;
    document.querySelector('meta[name="description"]').content =
      `Explore ${site.name}${site.region ? ` in ${site.region}` : ''}. View recorded dive-site details and mapped coordinates.`;
    const link = document.createElement('link');
    link.rel = 'canonical';
    const canonicalId = `${siteSlug(site.name)}-${siteId}`;
    const canonical = `https://diveatlas.site/dive-site.html?id=${encodeURIComponent(canonicalId)}`;
    link.href = canonical;
    const currentQuery = new URLSearchParams(location.search);
    if (currentQuery.get('id') !== canonicalId) {
      currentQuery.set('id', canonicalId);
      history.replaceState(null, '', `${location.pathname}?${currentQuery}${location.hash}`);
    }
    document.head.append(link);
    const schema = document.createElement('script');
    schema.type = 'application/ld+json';
    schema.textContent = JSON.stringify({ '@context':'https://schema.org', '@type':'Place',
      name:site.name, url:canonical, geo:{ '@type':'GeoCoordinates', latitude:site.lat, longitude:site.lon } });
    document.head.append(schema);

    const photo = site.photo;
    const photoUrl = safeUrl(photo?.src);
    const mapUrl = `/?site=${encodeURIComponent(siteId)}&lat=${site.lat}&lng=${site.lon}&z=14`;
    const locationHierarchy = Array.isArray(site.location_hierarchy) && site.location_hierarchy.length
      ? site.location_hierarchy : [site.country, site.region].filter(Boolean);
    const locationHierarchyUrls = Array.isArray(site.location_hierarchy_urls)
      && site.location_hierarchy_urls.length === locationHierarchy.length
      ? site.location_hierarchy_urls
      : locationHierarchy.map((_, index) => `/regions/browse.html?area=${encodeURIComponent(
        JSON.stringify(locationHierarchy.slice(0, index + 1).map(value =>
          String(value).normalize('NFKD').toLowerCase().replace(/\p{M}/gu, ''))))}`);
    const locationHierarchyMarkup = locationHierarchy.length
      ? locationHierarchy.map((label, index) => {
        const destination = safeRegionBrowseUrl(locationHierarchyUrls[index]);
        const item = destination ? `<a href="${escape(destination)}">${escape(label)}</a>` : escape(label);
        return `${index ? '<span aria-hidden="true">›</span>' : ''}${item}`;
      }).join(' ')
      : 'Mapped dive site';
    const credit = photo?.source === 'illustrative-fallback'
      ? `Illustrative image · ${photo.credit || ''}` : photo?.credit || '';
    const facts = [];
    const fact = (label, value, attributes = '', className = '') => {
      if (value !== '' && value != null) facts.push(`<div class="fact ${className}"><dt>${escape(label)}</dt><dd ${attributes}>${escape(value)}</dd></div>`);
    };
    facts.push(`<div class="fact fact-coordinates"><dt>Coordinates</dt><dd><a class="coordinate-map-button" href="https://www.google.com/maps/search/?api=1&amp;query=${site.lat}%2C${site.lon}" target="_blank" rel="noopener noreferrer"><img src="/assets/google-maps-icon-2026.png?v=1" alt="" width="22" height="22"><span>Open in Maps</span></a></dd></div>`);
    const minimum = site.depth_min || site.recorded_depth || '';
    const maximum = site.depth_max || site.recorded_depth || '';
    if (minimum || maximum) {
      const same = minimum !== '' && maximum !== '' && Number(minimum) === Number(maximum);
      const value = same ? minimum : [minimum, maximum].filter(value => value !== '').join('–');
      fact(same || !site.depth_min && !site.depth_max ? 'Recorded depth' : 'Recorded depth range', `${value} m`,
        `data-depth-min="${escape(minimum)}" data-depth-max="${escape(maximum)}"`);
    }
    const levels = String(site.difficulty || '').split(/\s*(?:\||,|;|\bto\b)\s*/i);
    const ranks = ['beginner', 'intermediate', 'advanced', 'expert'];
    fact('Difficulty', ranks.find(level => levels.some(value => value.toLowerCase() === level))
      ?.replace(/^./, value => value.toUpperCase()) || site.difficulty);
    const category = value => String(value || '').split('|').map(part => part.trim().replaceAll('_', ' ')).filter(Boolean).join(' · ');
    fact('Setting', category(site.categories.setting), '', 'fact-setting');
    fact('Access', category(site.categories.access));
    fact('Features', category(site.categories.features), '', 'fact-features');
    const sources = site.sources.filter(source => Array.isArray(source) && safeUrl(source[1]));
    page.dataset.siteId = siteId;
    page.classList.toggle('has-photo', Boolean(photoUrl));
    page.classList.toggle('no-photo', !photoUrl);
    page.innerHTML = `
      <section class="site-hero" aria-labelledby="site-title">
        <div class="site-photo-feature"><figure class="site-photo site-photo-gallery">
          <div class="site-photo-gallery-main">${photoUrl
            ? `<button class="site-photo-preview-trigger" type="button" aria-label="Open full-size photo preview"><img src="${escape(photoUrl)}" alt="${escape(photo.alt || site.name)}"></button>${credit ? `<figcaption>${escape(credit)}</figcaption>` : ''}`
            : '<p>No site photo is available.</p>'}</div>
        </figure><aside class="site-photo-gallery-rail" aria-label="Dive site actions">
          <section class="site-photo-gallery-rating" data-rating-lat="${site.lat}" data-rating-lng="${site.lon}" aria-label="diveAtlas Rating" tabindex="0">
            <div class="site-photo-gallery-rating__brand"><img src="/assets/diveatlas-logo.svg?v=3" alt="DiveAtlas"><span data-i18n-ignore>Rating</span></div>
            <p class="site-photo-gallery-rating__score" role="status" aria-live="polite" data-status="loading">Loading rating…</p>
            <div class="site-photo-gallery-rating__trend"><p class="site-photo-gallery-rating__trend-title">Monthly Rating</p><div class="site-photo-gallery-rating__trend-chart" role="img" aria-label="Monthly dive-site rating scores"></div></div>
          </section>
          <div class="site-photo-gallery-map"><iframe class="site-photo-gallery-map__embed" title="Map preview" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" tabindex="-1" aria-hidden="true" src="https://www.google.com/maps?q=${site.lat}%2C${site.lon}&amp;z=12&amp;output=embed"></iframe><a class="site-photo-gallery-map__mask" href="${mapUrl}" aria-label="View on the DiveAtlas map"></a><a class="site-photo-gallery-map__cta" href="${mapUrl}">View on map</a></div>
        </aside></div>
        <div class="hero-copy">
          <div class="site-title-row"><h1 id="site-title" data-seo-site-name>${escape(site.name)}</h1><button class="site-title-share" id="siteTitleShareButton" type="button" aria-label="Share this dive site"><svg class="site-title-share-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m0 0L7 8m5-5 5 5M3 14v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></svg></button></div>
          <p class="lead location-hierarchy" aria-label="Location hierarchy">${locationHierarchyMarkup}</p>
        </div>
      </section>
      ${site.aliases || site.summary ? `<p class="intro-details">${site.aliases ? `<strong>Also recorded as:</strong> <span data-i18n-ignore>${escape(site.aliases)}</span>.<br>` : ''}${site.summary ? `<span data-seo-summary>${escape(site.summary)}</span>` : ''}</p>` : ''}
      <section class="detail-section facts-section" aria-labelledby="site-details-heading"><h2 id="site-details-heading">Dive details</h2><dl class="fact-grid">${facts.join('')}</dl></section>
      ${sources.length ? `<section class="detail-section source-section"><h2>Sources</h2><ul class="source-list">${sources.map(source => `<li><a href="${escape(safeUrl(source[1]))}" target="_blank" rel="noopener noreferrer">${escape(source[0] || 'Reference')}</a></li>`).join('')}</ul></section>` : ''}
      <aside class="data-note"><span class="note-icon" aria-hidden="true"></span><p>Recorded details may not reflect current conditions. Check local guidance before diving.</p></aside>`;
    page.setAttribute('aria-busy', 'false');
    return renderRecommendations(site);
  }

  async function start() {
    if (!uuid.test(siteId)) {
      showError('Choose a dive site', 'This link needs a valid dive-site ID. Open a dive site from the map.');
      return;
    }
    let response;
    try {
      // A finite deadline gives people a retry action if the cloud request stalls.
      response = await fetch(window.DiveAtlasDataAssets.url(`data/dive-site-details/v1/${siteId}.json`),
        { signal:AbortSignal.timeout(15000) });
      if (response.status === 404) {
        showError('Dive site unavailable', 'This dive site is not available in the published data. You can still explore the map.');
        return;
      }
      if (!response.ok) throw new Error(`Detail HTTP ${response.status}`);
      await render(validate(await response.json()));
    } catch (error) {
      console.warn('Dive-site details could not be loaded.', error);
      showError('Unable to load this dive site', 'Please check your connection and try again.', true);
      return;
    }
    // Existing page modules inspect the DOM once at startup. Load them only
    // after the record is rendered so they bind to the correct site and title.
    for (const src of ['/datasets/dive-site-name-translations.js?v=1',
      '/js/dive-site-name-localization.js?v=1', '/js/dive-site-summary-translations.js?v=1',
      '/js/dive-photo-preview.js?v=5', '/js/seo-page-controls.js?v=15',
      '/js/dive-conditions-chart.js?v=37', '/js/site-recommendations.js?v=17',
      '/js/dive-site-rating-card.js?v=21']) {
      try { await loadScript(src); }
      catch (_) { console.warn(`Optional dive-site feature could not load: ${src}`); }
    }
  }
  start();
})();
