(() => {
  'use strict';
  const page = document.getElementById('detailPage') || document.querySelector('main.detail-page[data-site-id]');
  const hero = page?.querySelector('.site-hero');
  const rail = page?.querySelector('.site-photo-gallery-rail');
  const facts = page?.querySelector('.facts-section');
  if (!hero || !rail || !facts || page.dataset.appearanceInitialized) return;
  page.dataset.appearanceInitialized = 'true';
  // Generated permalinks share the structure but historically had no main ID.
  if (!page.id) page.id = 'detailPage';

  const stylesheet = document.querySelector('link[href*="/assets/dive-site-cinematic-pilot.css"]') || document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/assets/dive-site-cinematic-pilot.css?v=117';
  if (!stylesheet.isConnected) document.head.append(stylesheet);
  document.body.classList.add('cinematic-pilot');
  if (!hero.querySelector('.site-photo-preview-trigger img')) hero.classList.add('cinematic-pilot--no-photo');

  const arrivalKey = 'diveatlas-explorer-arrival';
  // Carry only a short-lived visual across native navigation. No fetched page
  // replaces the document, so history, localization and detail initialization
  // continue to use their normal lifecycle.
  try {
    const arrival = JSON.parse(sessionStorage.getItem(arrivalKey) || 'null');
    sessionStorage.removeItem(arrivalKey);
    if (arrival && arrival.url === location.href && Date.now() - arrival.time < 15000 &&
        !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const preview = hero.querySelector('.site-photo-gallery-main');
      if (preview) {
        const cover = document.createElement('img');
        cover.src = arrival.image;
        cover.alt = '';
        cover.className = 'cinematic-pilot__arrival';
        preview.append(cover);
        const image = preview.querySelector('.site-photo-preview-trigger img');
        const reveal = () => {
          cover.animate([{ opacity:1 }, { opacity:0 }], { duration:280, fill:'forwards' })
            .finished.catch(() => {}).finally(() => cover.remove());
        };
        // Decoding can fail offline; the bounded fallback must still reveal
        // the authoritative destination, including its no-photo state.
        Promise.race([
          image?.decode().catch(() => {}),
          new Promise(resolve => setTimeout(resolve, 1200))
        ]).then(() => {
          const ready = stylesheet.sheet ? Promise.resolve() : new Promise(resolve => {
            stylesheet.addEventListener('load', resolve, { once:true });
            stylesheet.addEventListener('error', resolve, { once:true });
            setTimeout(resolve, 1200);
          });
          ready.then(() => requestAnimationFrame(reveal));
        });
      }
    }
  } catch (_) { /* Storage restrictions must never prevent navigation. */ }

  // Move existing nodes rather than recreate them: retain provenance, map URLs,
  // localized fields, photo preview and rating hooks owned by the shared modules.
  // The conditions module inserts after the facts in their original parent.
  // Keep that insertion point intact so its full-width chart is not nested.
  rail.classList.add('cinematic-pilot__rail');
  rail.querySelector('.site-photo-gallery-rating').dataset.ratingTrendDetailScale = 'true';
  // Local guide enrichment replaces the intro in place, so placing the rail
  // before that anchor also keeps asynchronously loaded descriptions below it.
  const intro = page.querySelector('.intro-details,.site-intro-detail');
  (intro || page.querySelector('.enrichment-guide') || facts).before(rail);

  // Keep the original sibling structure: chart insertion and enrichment rely
  // on it. A single decorative shadow spans the measured intro and facts.
  const desktopCard = window.matchMedia('(min-width: 1061px)');
  let shadowIntro;
  const shadowResize = new ResizeObserver(updateSharedShadow);
  function updateSharedShadow() {
    const previous = facts.previousElementSibling;
    const candidate = previous?.matches('.intro-details:not([hidden]), .site-intro-detail:not([hidden]), .enrichment-guide') ? previous : null;
    if (candidate !== shadowIntro) {
      if (shadowIntro) shadowResize.unobserve(shadowIntro);
      shadowIntro = candidate;
      if (shadowIntro) shadowResize.observe(shadowIntro);
    }
    if (desktopCard.matches && shadowIntro) {
      facts.dataset.sharedCardShadow = '';
      facts.style.setProperty('--shared-card-intro-height', `${facts.getBoundingClientRect().top - shadowIntro.getBoundingClientRect().top}px`);
    } else {
      delete facts.dataset.sharedCardShadow;
      facts.style.removeProperty('--shared-card-intro-height');
    }
  }
  desktopCard.addEventListener('change', updateSharedShadow);
  new MutationObserver(updateSharedShadow).observe(page, { childList: true, subtree: true });
  updateSharedShadow();

  const recommendations = document.getElementById('relatedSites') || document.querySelector('.site-recommendations');
  if (!recommendations || recommendations.hidden) return;
  if (!recommendations.id) recommendations.id = 'relatedSites';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'cinematic-pilot__trigger';
  trigger.setAttribute('aria-label', 'Keep exploring. More dive sites');
  trigger.setAttribute('aria-controls', 'cinematicRecommendations');
  trigger.setAttribute('aria-expanded', 'false');
  const thumbnails = document.createElement('span');
  thumbnails.className = 'cinematic-pilot__stack';
  thumbnails.setAttribute('aria-hidden', 'true');
  const copy = document.createElement('span');
  copy.className = 'cinematic-pilot__trigger-copy';
  const label = document.createElement('span');
  label.textContent = 'Keep exploring';
  const hint = document.createElement('span');
  hint.className = 'cinematic-pilot__trigger-hint';
  hint.textContent = 'More dive sites';
  copy.append(label, hint);
  trigger.append(thumbnails, copy);
  hero.querySelector('.site-title-row').append(trigger);

  // Native modal containment keeps the full-page exploration view keyboard-accessible.
  const panel = document.createElement('dialog');
  panel.id = 'cinematicRecommendations';
  panel.className = 'cinematic-pilot__recommendations';
  // Show the selected pilot on ordinary detail links; retain a comparison URL.
  const immersionPilot = new URLSearchParams(location.search).get('relatedStyle') !== 'classic';
  panel.classList.toggle('cinematic-pilot__recommendations--immersion', immersionPilot);
  panel.setAttribute('aria-labelledby', 'cinematicRecommendationsTitle');
  const header = document.createElement('div');
  header.className = 'cinematic-pilot__recommendations-header';
  const title = document.createElement('h2');
  title.id = 'cinematicRecommendationsTitle';
  title.textContent = 'Related dive sites';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close');
  close.className = 'cinematic-pilot__close';
  header.append(title);
  const surface = document.createElement('div');
  surface.className = 'cinematic-pilot__recommendations-surface';
  surface.append(header, recommendations);
  // Keep dismissal outside the scroller. The dialog's glass creates a fixed
  // containing block, so a fixed child of a scrolling dialog can still move.
  panel.append(surface, close);
  document.body.append(panel);
  trigger.setAttribute('aria-haspopup', 'dialog');

  // Fetch only the inspected site's published summary, not every card's full
  // record. Cache across cloned/filter-rebuilt cards and preserve link clicks.
  const summaryCache = new Map();
  // Follow the actual title layout rather than a fixed inset: translated or
  // wrapped names and viewport changes must not jump when inspection opens.
  function alignSummary(card) {
    const title = card.querySelector('.site-recommendations__name');
    const summary = card.querySelector('.cinematic-pilot__card-summary');
    if (!title || !summary) return;
    let top = 0;
    for (let node = title; node && node !== card; node = node.offsetParent) top += node.offsetTop;
    summary.style.top = `${top}px`;
  }
  const summaryLayout = new ResizeObserver(entries => {
    for (const entry of entries) alignSummary(entry.target);
  });
  async function revealSummary(event) {
    if (!immersionPilot || (event.type === 'pointerover' && event.pointerType !== 'mouse')) return;
    const card = event.target.closest('a.site-recommendations__card');
    if (!card || !panel.contains(card) || card.querySelector('.cinematic-pilot__card-summary')) return;
    const url = new URL(card.href, location.href);
    if (url.origin !== location.origin) return;
    if (!summaryCache.has(url.href)) {
      summaryCache.set(url.href, (async () => {
        const id = (url.searchParams.get('id') || url.pathname).match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i)?.[0];
        const recordUrl = id && window.DiveAtlasDataAssets?.url(`data/dive-site-details/v1/${id.toLowerCase()}.json`);
        const response = await fetch(recordUrl || url.href, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) return '';
        if (recordUrl) {
          const record = await response.json();
          return record.site_id?.toLowerCase() === id.toLowerCase() && typeof record.summary === 'string' ? record.summary : '';
        }
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        return doc.querySelector('[data-seo-summary], .intro-details, .site-intro-detail')?.textContent?.trim() || '';
      })().catch(() => ''));
    }
    const text = await summaryCache.get(url.href);
    if (!text || !card.isConnected || card.querySelector('.cinematic-pilot__card-summary')) return;
    const summary = document.createElement('span');
    summary.className = 'cinematic-pilot__card-summary';
    const name = document.createElement('strong');
    name.textContent = card.querySelector('.site-recommendations__name')?.textContent || '';
    const copy = document.createElement('span');
    copy.textContent = text;
    summary.append(name, copy);
    card.append(summary);
    alignSummary(card);
    summaryLayout.observe(card);
  }
  panel.addEventListener('pointerover', revealSummary);
  panel.addEventListener('focusin', revealSummary);

  let expandedState = false;
  let previewItems = [];
  let pinnedItems = [];
  let thumbnailKey = '';
  function refreshPreview() {
    const combined = recommendations.querySelector('.site-recommendations__combined');
    const list = combined || recommendations.querySelector('ul');
    const items = list ? [...list.children].filter(item => item.querySelector('a[href]')) : [];
    items.forEach(item => { item.hidden = false; });
    if (expandedState) {
      // Shared filters/ratings can rebuild or reorder All. Pin the exact cards
      // shown in the launcher for this visit, including their original images.
      const signature = item => [item.querySelector('a[href]')?.getAttribute('href'),
        item.querySelector('.site-recommendations__image')?.getAttribute('src') || ''];
      if (JSON.stringify(items.slice(0, pinnedItems.length).map(signature)) !== JSON.stringify(pinnedItems.map(signature))) {
        const pinnedUrls = new Set(pinnedItems.map(item => signature(item)[0]));
        list.replaceChildren(...pinnedItems.map(item => item.cloneNode(true)),
          ...items.filter(item => !pinnedUrls.has(signature(item)[0])));
      }
      return;
    }
    previewItems = items.slice(0, 3).map(item => item.cloneNode(true));
    const images = items.slice(0, 3).map(item => item.querySelector('.site-recommendations__image'));
    const key = JSON.stringify(images.map(image => [image?.getAttribute('src'), image?.getAttribute('title')]));
    if (key === thumbnailKey) return;
    thumbnailKey = key;
    // Keep the image credits on the previews and retain neutral placeholders
    // when a recommendation has no image; never fabricate site photographs.
    thumbnails.replaceChildren(...Array.from({ length:3 }, (_, index) => {
      const src = images[index]?.getAttribute('src');
      const thumb = document.createElement(src ? 'img' : 'span');
      if (src) {
        thumb.src = src;
        thumb.alt = '';
        thumb.title = images[index].getAttribute('title') || '';
        thumb.addEventListener('error', () => thumb.replaceWith(document.createElement('span')), { once:true });
      }
      return thumb;
    }));
  }
  // Shared rating and filter modules rebuild the combined list after startup.
  // Observe child changes only: our visibility attributes cannot trigger a loop.
  new MutationObserver(refreshPreview).observe(recommendations, { childList:true, subtree:true });
  refreshPreview();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let revealAnimation;
  let cardAnimations = [];
  let flights = [];
  let stackOrigins = [];
  function clearFlights() {
    flights.forEach(({ element, animation }) => { animation.cancel(); element.remove(); });
    flights = [];
  }
  function animateMatchingPhotos(expanded) {
    // Place decorative copies inside the modal's top layer. They cannot steal
    // clicks or focus, and original images/credits remain in their owning cards.
    const list = recommendations.querySelector('.site-recommendations__combined') || recommendations.querySelector('ul');
    const images = [...(list?.children || [])].slice(0, 3)
      .map(item => item.querySelector('img.site-recommendations__image'));
    images.forEach((image, index) => {
      const origin = stackOrigins[index];
      if (!image || !origin || !origin.width || !image.getClientRects().length) return;
      const destination = image.getBoundingClientRect();
      if (!destination.width || !destination.height) return;
      const copy = document.createElement('img');
      copy.src = image.src;
      copy.alt = '';
      copy.setAttribute('aria-hidden', 'true');
      copy.className = 'cinematic-pilot__flying-photo';
      copy.style.width = `${destination.width}px`;
      copy.style.height = `${destination.height}px`;
      panel.append(copy);
      const small = `translate(${origin.left}px, ${origin.top}px) rotate(${(index - 1) * 12}deg) scale(${origin.width / destination.width}, ${origin.height / destination.height})`;
      const large = `translate(${destination.left}px, ${destination.top}px) rotate(0deg) scale(1)`;
      const animation = copy.animate([
        { transform:expanded ? small : large, borderRadius:expanded ? '20px' : '8px', opacity:1 },
        { transform:expanded ? large : small, borderRadius:expanded ? '8px' : '20px', opacity:1 }
      ], { duration:480, delay:index * 45, fill:'both', easing:'cubic-bezier(.22,.78,.18,1)' });
      animation.onfinish = () => copy.remove();
      flights.push({ element:copy, animation });
    });
  }
  function setExpanded(expanded) {
    if (expanded === expandedState) return;
    const previousOpacity = panel.open ? Number(getComputedStyle(panel).opacity) : 0;
    revealAnimation?.cancel();
    cardAnimations.forEach(animation => animation.cancel());
    cardAnimations = [];
    clearFlights();
    expandedState = expanded;
    trigger.setAttribute('aria-expanded', String(expanded));
    if (expanded) {
      stackOrigins = [...thumbnails.children].map(image => image.getBoundingClientRect());
      pinnedItems = previewItems.map(item => item.cloneNode(true));
      recommendations.querySelector('[data-recommendation-tab="all"]')?.click();
      refreshPreview();
      panel.inert = false;
      panel.showModal();
      surface.scrollTop = 0;
      document.body.classList.add('cinematic-pilot--exploring');
      window.dispatchEvent(new Event('resize'));
    } else {
      panel.inert = true;
    }
    const finish = () => {
      if (!expanded) {
        panel.close();
        clearFlights();
        cardAnimations.forEach(animation => animation.cancel());
        panel.inert = false;
        document.body.classList.remove('cinematic-pilot--exploring');
        // Restoring the vertical scrollbar narrows the viewport again. Refresh
        // full-bleed widths measured while the modal had scrolling locked.
        window.dispatchEvent(new Event('resize'));
        trigger.focus({ preventScroll:true });
        pinnedItems = [];
        refreshPreview();
      }
    };
    if (reducedMotion.matches) { finish(); return; }
    animateMatchingPhotos(expanded);
    // A transformed modal would change the coordinate system of its fixed
    // flying images. Fade the surface while the photographs move independently.
    const animation = panel.animate(expanded ? [
      { opacity:previousOpacity }, { opacity:1 }
    ] : [
      { opacity:previousOpacity, offset:0 }, { opacity:previousOpacity, offset:.7 }, { opacity:0, offset:1 }
    ], { duration:expanded ? 240 : 600, easing:'cubic-bezier(.2,.8,.2,1)' });
    revealAnimation = animation;
    animation.onfinish = () => {
      if (revealAnimation !== animation) return;
      revealAnimation = undefined;
      finish();
    };
    if (expanded) {
      const cards = [...recommendations.querySelectorAll('.site-recommendations__card')]
        .filter(card => card.getClientRects().length).slice(0, 6);
      cardAnimations = cards.map((card, index) => index < 3 ? card.animate([
        { opacity:0 }, { opacity:1 }
      ], { duration:180, delay:400 + index * 45, fill:'backwards', easing:'ease-out' }) : card.animate([
        { opacity:0, transform:'translateY(18px)' },
        { opacity:1, transform:'translateY(0)' }
      ], { duration:260, delay:60 + index * 35, fill:'backwards', easing:'cubic-bezier(.2,.8,.2,1)' }));
    } else {
      cardAnimations = [...recommendations.querySelectorAll('.site-recommendations__card')]
        .filter(card => card.getClientRects().length).slice(0, 3)
        .map(card => card.animate([{ opacity:1 }, { opacity:0 }], { duration:120, fill:'forwards' }));
    }
  }
  reducedMotion.addEventListener('change', () => {
    if (!reducedMotion.matches) return;
    revealAnimation?.finish();
    cardAnimations.forEach(animation => animation.finish());
    clearFlights();
  });
  trigger.addEventListener('click', () => setExpanded(true));
  let departing = false;
  panel.addEventListener('click', async event => {
    const card = event.target.closest('a.site-recommendations__card');
    if (!card || event.defaultPrevented || event.button !== 0 || event.metaKey ||
        event.ctrlKey || event.shiftKey || event.altKey || card.hasAttribute('download') ||
        (card.target && card.target !== '_self') || reducedMotion.matches) return;
    const destination = new URL(card.href, location.href);
    const image = card.querySelector('img');
    if (destination.origin !== location.origin || !image?.complete || !image.naturalWidth) return;
    event.preventDefault();
    if (departing) return;
    departing = true;
    clearFlights();
    cardAnimations.forEach(animation => animation.cancel());
    const start = card.getBoundingClientRect();
    const target = hero.querySelector('.site-photo-gallery-main')?.getBoundingClientRect();
    // The current site may have no photo and therefore a collapsed gallery.
    // Match the destination's responsive preview reservation in that case.
    const targetWidth = target?.width || document.documentElement.clientWidth;
    const targetHeight = target?.height || (innerWidth <= 720 ? 440 : Math.min(500, Math.max(380, innerWidth * .42)));
    const flight = document.createElement('div');
    flight.className = 'cinematic-pilot__page-flight';
    flight.setAttribute('aria-hidden', 'true');
    const photo = image.cloneNode();
    photo.className = '';
    photo.loading = 'eager';
    const cardShade = document.createElement('div');
    cardShade.className = 'cinematic-pilot__flight-shade';
    cardShade.style.background = getComputedStyle(card, '::after').backgroundImage;
    const heroShade = cardShade.cloneNode();
    heroShade.style.background = getComputedStyle(hero.querySelector('.site-photo-gallery-main'), '::after').backgroundImage;
    const cardTitle = card.querySelector('.site-recommendations__name');
    const titleRect = cardTitle.getBoundingClientRect();
    const titleStyle = getComputedStyle(cardTitle);
    const heading = hero.querySelector('h1');
    const headingStyle = getComputedStyle(heading);
    const heroRect = hero.getBoundingClientRect();
    const targetTop = target?.height ? target.top + window.scrollY : 0;
    const headingRect = heading.getBoundingClientRect();
    const name = document.createElement('span');
    name.textContent = cardTitle.textContent || '';
    Object.assign(name.style, { fontFamily:titleStyle.fontFamily, fontSize:titleStyle.fontSize,
      fontWeight:titleStyle.fontWeight, lineHeight:titleStyle.lineHeight,
      textShadow:titleStyle.textShadow, letterSpacing:titleStyle.letterSpacing,
      color:titleStyle.color, left:`${titleRect.left - start.left}px`,
      bottom:`${start.bottom - titleRect.bottom}px`, width:`${titleRect.width}px` });
    // Preserve the real card's initial layout (including the rating and image
    // credit) instead of reconstructing metadata with different containing blocks.
    const snapshot = document.createElement('li');
    snapshot.className = 'cinematic-pilot__flight-card';
    const cardCopy = card.cloneNode(true);
    cardCopy.removeAttribute('href');
    cardCopy.removeAttribute('id');
    cardCopy.tabIndex = -1;
    snapshot.append(cardCopy);
    flight.append(photo, cardShade, heroShade, name, snapshot);
    // A child of the modal stays above its top-layer backdrop.
    panel.append(flight);
    const scrim = document.createElement('div');
    scrim.className = 'cinematic-pilot__departure-scrim';
    panel.insertBefore(scrim, flight);
    const timing = { duration:560, easing:'cubic-bezier(.22,1,.36,1)', fill:'forwards' };
    scrim.animate([{ opacity:0 }, { opacity:1 }], timing);
    cardShade.animate([{ opacity:1 }, { opacity:0 }], timing);
    heroShade.animate([{ opacity:0 }, { opacity:1 }], timing);
    snapshot.animate([{ opacity:1 }, { opacity:0 }], { duration:160, fill:'forwards' });
    name.animate([{}, { fontSize:headingStyle.fontSize, lineHeight:headingStyle.lineHeight,
      color:headingStyle.color, left:`${headingRect.left - heroRect.left}px`,
      bottom:`${heroRect.bottom - headingRect.bottom}px`,
      width:`${innerWidth <= 720 ? targetWidth - 100 : targetWidth - 80}px`, textShadow:headingStyle.textShadow }], timing);
    Object.assign(flight.style, { left:`${start.left}px`, top:`${start.top}px`,
      width:`${start.width}px`, height:`${start.height}px` });
    try {
      await flight.animate([
        { borderRadius:getComputedStyle(card).borderRadius },
        { left:`${target?.width ? target.left : 0}px`, top:`${targetTop}px`, width:`${targetWidth}px`,
          height:`${targetHeight}px`, borderRadius:'0px', boxShadow:'0 0 0 transparent' }
      ], timing).finished;
    } catch (_) { /* A canceled animation still follows the activated link. */ }
    try {
      sessionStorage.setItem(arrivalKey, JSON.stringify({ url:destination.href,
        image:image.currentSrc || image.src, time:Date.now() }));
    } catch (_) {}
    location.assign(destination.href);
  });
  // BFCache restores the outgoing DOM, including its completed animation.
  window.addEventListener('pageshow', () => {
    departing = false;
    panel.querySelectorAll('.cinematic-pilot__page-flight, .cinematic-pilot__departure-scrim').forEach(node => node.remove());
  });
  // A modal locks page scrolling, while the destination restores it. Chromium's
  // cross-document snapshot can reject that viewport change on mobile. Keep
  // navigation native; the explorer uses its own card expansion above.
  window.addEventListener('pageswap', event => {
    if (panel.open) event.viewTransition?.skipTransition();
  });
  close.addEventListener('click', () => setExpanded(false));
  // Only the empty outer gutters dismiss; interactions within the content
  // surface (including space between cards) remain inside the explorer.
  panel.addEventListener('click', event => {
    if (event.target === panel) setExpanded(false);
  });
  panel.addEventListener('cancel', event => {
    event.preventDefault();
    setExpanded(false);
  });
})();
