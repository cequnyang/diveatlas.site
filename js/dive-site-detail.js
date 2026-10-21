(() => {
  'use strict';

  const page = document.getElementById('detailPage');
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
          <section class="site-photo-gallery-rating" data-rating-lat="${site.lat}" data-rating-lng="${site.lon}" aria-label="DiveAtlas Rating" tabindex="0">
            <div class="site-photo-gallery-rating__brand"><img src="/assets/diveatlas-logo.svg?v=3" alt="DiveAtlas"><span>Rating</span></div>
            <p class="site-photo-gallery-rating__score" role="status" aria-live="polite" data-status="loading">Loading rating…</p>
            <div class="site-photo-gallery-rating__trend"><p class="site-photo-gallery-rating__trend-title">Monthly Rating</p><div class="site-photo-gallery-rating__trend-chart" role="img" aria-label="Monthly dive-site rating scores"></div></div>
          </section>
          <div class="site-photo-gallery-map"><iframe class="site-photo-gallery-map__embed" title="Map preview" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" tabindex="-1" aria-hidden="true" src="https://www.google.com/maps?q=${site.lat}%2C${site.lon}&amp;z=12&amp;output=embed"></iframe><a class="site-photo-gallery-map__mask" href="${mapUrl}" aria-label="View on the DiveAtlas map"></a><a class="site-photo-gallery-map__cta" href="${mapUrl}">View on map</a></div>
        </aside></div>
        <div class="hero-copy"><nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/">Home</a><span>›</span><a href="/dive-sites/">Dive sites</a></nav>
          <div class="site-title-row"><h1 id="site-title" data-seo-site-name>${escape(site.name)}</h1><button class="site-title-share" id="siteTitleShareButton" type="button" aria-label="Share this dive site"><svg class="site-title-share-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m0 0L7 8m5-5 5 5M3 14v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></svg></button></div>
          <p class="lead" aria-label="Location hierarchy">${escape([site.country, site.region].filter(Boolean).join(' › ') || 'Mapped dive site')}</p>
        </div>
      </section>
      ${site.aliases || site.summary ? `<p class="intro-details">${site.aliases ? `<strong>Also recorded as:</strong> ${escape(site.aliases)}.<br>` : ''}${site.summary ? `<span data-seo-summary>${escape(site.summary)}</span>` : ''}</p>` : ''}
      <section class="detail-section facts-section" aria-labelledby="site-details-heading"><h2 id="site-details-heading">Dive details</h2><dl class="fact-grid">${facts.join('')}</dl></section>
      ${sources.length ? `<section class="detail-section source-section"><h2>Sources</h2><ul class="source-list">${sources.map(source => `<li><a href="${escape(safeUrl(source[1]))}" target="_blank" rel="noopener noreferrer">${escape(source[0] || 'Reference')}</a></li>`).join('')}</ul></section>` : ''}
      <aside class="data-note"><span class="note-icon" aria-hidden="true"></span><p>Recorded details may not reflect current conditions. Check local guidance before diving.</p></aside>`;
    page.setAttribute('aria-busy', 'false');
    const related = site.related.filter(other => uuid.test(other.site_id) && other.site_id !== siteId).slice(0, 8);
    if (related.length) {
      const aside = document.getElementById('relatedSites');
      aside.innerHTML = `<h2>More in this region</h2><ul>${related.map(other => {
        const image = safeUrl(other.photo?.src);
        return `<li><a class="site-recommendations__card" href="${detailUrl(other)}">${image ? `<img class="site-recommendations__image" src="${escape(image)}" alt="" loading="lazy">` : ''}<span class="site-recommendations__card-body"><span class="site-recommendations__name">${escape(other.name)}</span><span class="site-recommendations__location">${escape(other.region)}</span></span></a></li>`;
      }).join('')}</ul>`;
      aside.hidden = false;
    }
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
      render(validate(await response.json()));
    } catch (error) {
      console.warn('Dive-site details could not be loaded.', error);
      showError('Unable to load this dive site', 'Please check your connection and try again.', true);
      return;
    }
    // Existing page modules inspect the DOM once at startup. Load them only
    // after the record is rendered so they bind to the correct site and title.
    for (const src of ['/datasets/dive-site-name-translations.js?v=1',
      '/js/dive-site-name-localization.js?v=1', '/js/dive-site-summary-translations.js?v=1',
      '/js/dive-photo-preview.js?v=1', '/js/seo-page-controls.js?v=10',
      '/js/dive-conditions-chart.js?v=30', '/js/dive-site-rating-card.js?v=13']) {
      try { await loadScript(src); }
      catch (_) { console.warn(`Optional dive-site feature could not load: ${src}`); }
    }
  }
  start();
})();
