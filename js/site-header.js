(() => {
  'use strict';
  if (window.DiveAtlasHeader) { window.DiveAtlasHeader.mount(); return; }
  const loadScript = src => new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = src;
    script.onload = resolve; script.onerror = () => reject(new Error(`Header dependency failed: ${src}`));
    document.head.append(script);
  });
  function stylesheet(href) {
    let link = [...document.querySelectorAll('link[rel="stylesheet"]')].find(node => node.getAttribute('href')?.split('?')[0] === href.split('?')[0]);
    if (!link) { link = document.createElement('link'); link.rel = 'stylesheet'; }
    // Cached generated HTML may still name an older component stylesheet.
    link.href = href;
    document.head.append(link);
  }
  function decorate(header, map = false) {
    header.classList.add('shared-site-header');
    header.dataset.sharedHeaderReady = 'true';
    // Keep comparison units in the shared settings rail, using the same
    // segmented-control styles and existing preference handlers as the map.
    if (!map) {
      const units = document.querySelector('.comparison-units');
      const controls = header.querySelector('.seo-top-menu-controls');
      if (units && controls) {
        units.className = 'comparison-header-units';
        units.querySelectorAll(':scope > span').forEach(group => {
          group.className = 'unit-segmented-control unit-segmented-control--compact';
          group.querySelectorAll('button').forEach(button => button.classList.remove('seo-secondary-button'));
        });
        controls.insertBefore(units, controls.querySelector('.seo-language-menu'));
      }
    }

    document.body.classList.add('has-shared-header');
    // One navigation definition drives both menu implementations; reuse the
    // map's existing links where present so repeated mounts never duplicate them.
    const menu = header.querySelector(map ? '#topMenuDropdown' : '#seoMenuDropdown');
    if (menu) {
      const links = [
        ['/dive-sites/', 'browseDiveSites', 'Browse dive sites'],
        ['/regions/', 'browseRegions', 'Browse regions'],
        ['/destinations/', 'browseDestinations', 'Browse destinations'],
        ['/compare/', 'menu', 'Compare destinations']
      ];
      const anchor = menu.querySelector('.top-menu-divider, .top-menu-about-wrap');
      const items = links.map(([href, key, label]) => {
        let item = menu.querySelector(`a[href="${href}"]`);
        if (!item) { item = document.createElement('a'); item.className = 'top-menu-dropdown-item'; item.href = href; item.textContent = label; }
        item.dataset.sharedNavigation = key;
        if (key === 'menu') { item.dataset.comparisonMenu = ''; item.dataset.i18nIgnore = ''; }
        if (!map) item.dataset.i18nIgnore = '';
        menu.insertBefore(item, anchor);
        return item;
      });
      const compare = items[items.length - 1];
      const divider = () => {
        const element = document.createElement('div');
        element.className = 'top-menu-divider';
        element.setAttribute('role', 'separator');
        return element;
      };
      if (!compare.previousElementSibling?.classList.contains('top-menu-divider')) menu.insertBefore(divider(), compare);
      if (!compare.nextElementSibling?.classList.contains('top-menu-divider')) menu.insertBefore(divider(), compare.nextElementSibling);
      window.DiveAtlasComparisonCopyReady ||= window.DiveAtlasComparisonCopy
        ? Promise.resolve(window.DiveAtlasComparisonCopy)
        : loadScript('/js/destination-comparison-i18n.js?v=9').then(() => window.DiveAtlasComparisonCopy);
      const localize = () => {
        const copy = window.DiveAtlasComparisonCopy;
        if (copy) items.forEach(item => { item.textContent = copy.text(document.documentElement.lang, item.dataset.sharedNavigation); });
      };
      window.DiveAtlasComparisonCopyReady.then(localize).catch(error => console.warn('Navigation labels unavailable:', error));
      window.addEventListener('diveatlas:language-change', localize);
      new MutationObserver(localize).observe(document.documentElement, {attributes:true, attributeFilter:['lang']});
    }
    if (!map && (document.body.classList.contains('seo-site-detail-layout') || document.querySelector('[data-detail-scroll]')) &&
        !document.querySelector('.detail-scroll-rail')) {
      // A document scrollbar reserves a full-height gutter even when its track
      // has a top margin. Mirror its position into a separate native rail so
      // the glass header can cover the complete viewport. Window scrolling
      // remains authoritative for pull gestures and history restoration.
      const rail = document.createElement('div');
      rail.className = 'detail-scroll-rail';
      rail.tabIndex = 0;
      rail.setAttribute('aria-label', 'Page scroll');
      const extent = document.createElement('div');
      extent.setAttribute('aria-hidden', 'true');
      rail.append(extent);
      document.body.append(rail);
      document.documentElement.classList.add('has-detail-scroll-rail');
      let forwardedScroll = null;
      let mirroredScroll = null;
      const updateRail = () => {
        const headerBottom = Math.max(0, header.getBoundingClientRect().bottom);
        rail.style.top = `${headerBottom}px`;
        const height = document.documentElement.scrollHeight;
        extent.style.height = `${Math.max(0, height - headerBottom)}px`;
        rail.hidden = height <= innerHeight + 1;
        // A rail-originated scroll may be a native keyboard/wheel animation.
        // Echoing it back into scrollTop cancels that animation mid-flight.
        const fromRail = forwardedScroll != null && Math.abs(scrollY - forwardedScroll) < 0.5;
        forwardedScroll = null;
        if (!fromRail && Math.abs(rail.scrollTop - scrollY) >= 0.5) {
          mirroredScroll = scrollY;
          rail.scrollTop = scrollY;
        }
      };
      rail.addEventListener('scroll', () => {
        const fromPage = mirroredScroll != null && Math.abs(rail.scrollTop - mirroredScroll) < 0.5;
        mirroredScroll = null;
        if (fromPage) return;
        if (Math.abs(scrollY - rail.scrollTop) >= 0.5) {
          forwardedScroll = rail.scrollTop;
          window.scrollTo({ top:rail.scrollTop, behavior:'instant' });
        }
      }, { passive:true });
      window.addEventListener('scroll', updateRail, { passive:true });
      window.addEventListener('resize', updateRail);
      window.addEventListener('pageshow', updateRail);
      const resize = new ResizeObserver(updateRail);
      resize.observe(document.documentElement);
      resize.observe(document.body);
      resize.observe(header);
      updateRail();
    }
    if (map) {
      // Retain native map nodes and IDs: map search and settings own their state.
      for (const [selector, name] of [['.top-menu-brand','brand'],['.top-menu-controls','seo-top-menu-controls'],['.top-menu-lang','seo-language-menu'],['.top-menu-menu','seo-menu-wrap'],['#languageDropdown','seo-language-dropdown'],['#topMenuDropdown','seo-menu-dropdown']]) {
        header.querySelector(selector)?.classList.add(name);
      }
    }
    stylesheet('/assets/site-header.css?v=14');
    window.dispatchEvent(new CustomEvent('diveatlas:header-ready', { detail:{ map } }));
    return header;
  }
  function mount() {
    if (!document.body) return null;
    if (!document.querySelector('meta[name="viewport"]')) {
      const viewport = document.createElement('meta');
      viewport.name = 'viewport'; viewport.content = 'width=device-width, initial-scale=1';
      document.head.append(viewport);
    }
    const map = document.getElementById('topMenuBar');
    if (map) return map.dataset.sharedHeaderReady ? map : decorate(map, true);
    const current = document.querySelector('body > .site-header');
    if (current?.dataset.sharedHeaderReady) return current;
    const detail = document.body.classList.contains('seo-site-detail-layout');
    if (!detail) document.body.classList.add('seo-browse-layout', 'shared-header-document');
    if (!document.querySelector('link[href*="/assets/seo.css"]')) stylesheet('/assets/seo.css?v=200');
    stylesheet('/assets/seo-site-search.css?v=13');
    stylesheet('/assets/search-results-menu.css?v=1');
    const fallback = current;
    // Keep a logo-only server-rendered header for no-JavaScript users, then replace it
    // with the shared detail-page controls once their dependencies can run.
    const header = document.createElement('header');
    header.className = 'site-header';
    header.innerHTML = `
      <a href="/" class="brand"><img src="/assets/diveatlas-logo.svg?v=3" alt="DiveAtlas"></a>
      <div class="top-menu-search-slot seo-site-search-slot" id="seoSiteSearchSlot">
        <div class="search-float" id="seoSiteSearchSection">
          <div class="dive-search">
            <div class="dive-search-box">
              <button class="dive-search-icon" id="seoSiteSearchToggle" type="button" aria-label="Search dive sites" title="Search dive sites" aria-controls="seoSiteSearchInput" aria-expanded="false"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="6.75" cy="6.75" r="4.25"></circle><path d="M10.4 10.4 14 14"></path></svg></button>
              <input class="dive-search-input" id="seoSiteSearchInput" type="text" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="seoSiteSearchResultsScroll" placeholder="Where Will You Dive Next?" aria-label="Where Will You Dive Next?">
              <button class="dive-search-clear" id="seoSiteSearchClear" type="button" title="Clear search" aria-label="Clear search"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 0 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 1 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"></path></svg></button>
              <button class="dive-search-filter-toggle" id="seoSiteSearchFilterToggle" type="button" aria-label="Search filters" title="Search filters" aria-controls="seoSiteSearchFilterControls" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 7h10.1M18.9 7H21M3 17h2.1M10.9 17H21"></path><circle cx="16" cy="7" r="2.9"></circle><circle cx="8" cy="17" r="2.9"></circle></svg></button>
            </div>
            <div class="dive-search-results" id="seoSiteSearchResults" aria-busy="false">
              <div class="dive-search-results-scroll" id="seoSiteSearchResultsScroll" role="listbox" aria-label="Dive-site search results"></div>
              <div class="dive-search-filter-controls" id="seoSiteSearchFilterControls" role="group" aria-label="Dive-site filters" hidden>
                <label class="dive-search-filter-field"><span id="seoSiteSearchCountryLabel">Country</span><select id="seoSiteSearchCountry" aria-labelledby="seoSiteSearchCountryLabel"><option value="">Any country</option></select></label>
                <label class="dive-search-filter-field"><span id="seoSiteSearchDifficultyLabel">Difficulty</span><select id="seoSiteSearchDifficulty" aria-labelledby="seoSiteSearchDifficultyLabel"><option value="">Any difficulty</option></select></label>
                <label class="dive-search-filter-field"><span id="seoSiteSearchFeatureLabel">Feature</span><select id="seoSiteSearchFeature" aria-labelledby="seoSiteSearchFeatureLabel"><option value="">Any feature</option></select></label>
                <button class="dive-search-filter-clear" id="seoSiteSearchFilterClear" type="button" hidden>Clear All</button>
              </div>
              <button class="dive-search-results-handle" id="seoSiteSearchResultsHandle" type="button" aria-label="Close dive-site search" title="Drag up to close"></button>
            </div>
          </div>
        </div>
      </div>
      <div class="top-menu-controls seo-top-menu-controls" aria-label="Page settings">
        <button class="top-menu-share" id="seoShareButton" type="button" aria-label="Share this page" title="Share this page"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 15V3m0 0L7 8m5-5 5 5M3 14v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></svg></button>
        <button class="top-menu-theme" id="seoThemeButton" type="button" title="Toggle page theme" aria-label="Toggle page theme" aria-pressed="false"><span class="theme-mode-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.7"/><path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M12.6 3.4l-.9.9M4.3 11.7l-.9.9"/></svg></span><span class="theme-mode-icon" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M12.8 10.2A5.8 5.8 0 0 1 5.8 3.1a5.8 5.8 0 1 0 7 7.1Z"/></svg></span></button>
        <div class="seo-language-menu"><button class="top-menu-menu-button top-menu-lang-trigger" id="seoLanguageButton" type="button" aria-label="Language" aria-haspopup="menu" aria-expanded="false" aria-controls="seoLanguageDropdown"><span id="seoLanguageLabel">EN</span><svg class="language-chevron-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><svg class="language-globe-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2.8 10h14.4M10 2.5c2 2 3 4.5 3 7.5s-1 5.5-3 7.5c-2-2-3-4.5-3-7.5s1-5.5 3-7.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="top-menu-dropdown seo-language-dropdown" id="seoLanguageDropdown" role="menu" aria-label="Language" hidden></div>
          <label class="sr-only" for="seoLanguageSelect">Language</label><select class="sr-only-select" id="seoLanguageSelect" aria-label="Language" tabindex="-1" aria-hidden="true"><option value="en">EN</option><option value="zh">简体中文</option><option value="zh-TW">繁體中文</option><option value="es">ES</option><option value="de">DE</option><option value="fr">FR</option><option value="ja">日本語</option><option value="pt">PT</option><option value="it">IT</option><option value="ru">RU</option><option value="ko">한국어</option><option value="nl">NL</option><option value="id">ID</option><option value="sv">SV</option><option value="no">NO</option></select>
        </div>
        <div class="top-menu-menu seo-menu-wrap"><button class="top-menu-menu-button" id="seoMenuButton" type="button" title="Menu" aria-label="Menu" aria-expanded="false" aria-controls="seoMenuDropdown"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button><div class="top-menu-dropdown seo-menu-dropdown" id="seoMenuDropdown" hidden><div class="top-menu-page-header">Menu</div><button class="top-menu-dropdown-item seo-menu-share" id="seoMenuShareButton" type="button" aria-label="Share this page" title="Share this page"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 15V3m0 0L7 8m5-5 5 5M3 14v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></svg><span>Share this page</span></button><div class="seo-menu-account" role="status">Checking account…</div><div class="top-menu-about-wrap seo-menu-about-wrap"><button class="top-menu-dropdown-item" id="seoAboutButton" type="button" aria-expanded="false" aria-controls="seoAboutDetails">About</button><div class="top-menu-about-tooltip" id="seoAboutDetails" hidden><p>DiveAtlas is an interactive map for exploring dive sites and regions alongside reef extent, coral and fish records, bathymetry, and ocean conditions.</p><p class="top-menu-about-copyright">© 2026 DiveAtlas. Original DiveAtlas code, text, and design; third-party materials remain under their own terms.</p></div></div><button class="top-menu-dropdown-item" id="seoContactButton" type="button">Contact</button><div class="top-menu-version" data-version="0.0.1" aria-label="DiveAtlas version 0.0.1">v0.0.1</div></div></div>
      </div>`;
    const previousVersion = fallback?.querySelector('.top-menu-version');
    const version = document.querySelector('script[src*="/js/site-header.js"]')?.dataset.appVersion || previousVersion?.dataset.version || '0.0.1';
    const versionLabel = header.querySelector('.top-menu-version');
    versionLabel.dataset.version = version;
    versionLabel.setAttribute('aria-label', `DiveAtlas version ${version}`);
    versionLabel.textContent = `v${version}`;
    if (fallback) fallback.replaceWith(header);
    else document.body.prepend(header);

    const backdrop = document.createElement('div');
    backdrop.className = 'seo-menu-backdrop';
    backdrop.id = 'seoMenuBackdrop';
    backdrop.hidden = true;
    if (!document.getElementById('seoMenuBackdrop')) header.insertAdjacentElement('afterend', backdrop);

    const dialogs = document.createElement('template');
    dialogs.innerHTML = `
      <div class="seo-share-modal" id="seoShareModal" hidden></div>
      <div class="seo-contact-modal" id="seoContactModal" hidden>
        <div class="seo-modal-backdrop" data-seo-contact-close></div>
        <section class="seo-dialog" role="dialog" aria-modal="true" aria-labelledby="seoContactTitle">
          <div class="seo-dialog-header"><div><h2 id="seoContactTitle">Contact DiveAtlas</h2><p>Send a message to the DiveAtlas maintainer.</p></div><button class="seo-dialog-close" type="button" aria-label="Close" data-seo-contact-close>×</button></div>
          <form id="seoContactForm" class="seo-contact-form" novalidate>
            <label>Name <small>(optional)</small><input name="name" id="seoContactName" maxlength="100" autocomplete="name"></label>
            <label>Email<input name="email" id="seoContactEmail" type="email" maxlength="254" autocomplete="email" required></label>
            <label>Subject <small>(optional)</small><input name="subject" id="seoContactSubject" maxlength="150"></label>
            <label>Message<textarea name="message" id="seoContactMessage" maxlength="5000" required></textarea></label>
            <label class="seo-honeypot" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
            <div id="seoContactTurnstile"></div><p class="seo-dialog-status" id="seoContactStatus" role="status" aria-live="polite"></p>
            <div class="seo-dialog-actions"><button class="seo-secondary-button" type="button" data-seo-contact-close>Cancel</button><button class="seo-primary-button" type="submit">Send message</button></div>
          </form>
        </section>
      </div>`;
    for (const dialog of dialogs.content.children) {
      if (!document.getElementById(dialog.id)) document.body.append(dialog.cloneNode(true));
    }

    decorate(header);
    return header;
  }
  // Shared by geographic hover, pointer and wheel handlers. Optical
  // transparency must never change which surface owns an interaction.
  const overlaySelector = [
    '.leaflet-popup', '.leaflet-control', '.shared-site-header', '#bioLegend',
    '#diveSearchResults', '#seoSiteSearchResults', '.top-menu-dropdown', '.tutorial-language-dropdown', '.top-menu-about-tooltip',
    '.dive-filter-options', '.dive-layer-filter-menu', '.bio-legend-overflow-menu',
    '.temperature-scroll-wheel', '.temperature-info-popover',
    '.dive-conditions-info-popover', '.dive-experience-info-popover',
    '.dive-conditions-sources-tooltip', '.dive-popup-sources__tooltip',
    '.dive-location-coordinate-tooltip', '.depth-meaning-unknown',
    '.site-photo-upload-policy-popover', '.site-photo-gallery-rating__trend',
    '.share-modal', '.site-suggestion-modal', '.contact-modal',
    '.share-dialog', '.site-suggestion-dialog', '.contact-dialog', '.seo-dialog', '.tutorial-dialog',
    '.seo-contact-modal', '.seo-share-modal', '.tutorial-backdrop',
    '.dive-photo-preview', '.cinematic-pilot__recommendations',
    '.mobile-map-credits-panel'
  ].join(', ');
  const isOverlayTarget = event => Boolean((event?.originalEvent || event)?.target?.closest?.(overlaySelector));
  window.DiveAtlasHeader = Object.freeze({ mount, overlaySelector, isOverlayTarget });
  const header = mount();
  // Existing page scripts own data-ready startup. Plain pages and detail
  // failures still need working navigation, even when no record can load.
  function bootDocumentControls() {
    if (!header || document.getElementById('topMenuBar') ||
        document.querySelector('script[src*="seo-page-controls.js"]')) return;
    window.DiveAtlasHeaderDependencies ||= (async () => {
      if (!window.DiveAtlasDataAssets) {
        await loadScript('/js/data-assets-config.js'); await loadScript('/js/data-assets.js');
      }
      await loadScript('/js/seo-page-controls.js?v=29');
      if (!document.querySelector('script[src*="seo-site-search.js"]')) await loadScript('/js/seo-site-search.js?v=16');
      await loadScript('/js/seo-search-catalog-loader.js?v=1');
    })().catch(error => console.error('Shared header could not initialize.', error));
  }
  window.addEventListener('diveatlas:detail-error', bootDocumentControls);
  if (!document.body.classList.contains('seo-site-detail-layout')) bootDocumentControls();
})();
