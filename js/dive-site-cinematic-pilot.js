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

  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/assets/dive-site-cinematic-pilot.css?v=93';
  if (!document.querySelector('link[href*="/assets/dive-site-cinematic-pilot.css"]')) document.head.append(stylesheet);
  document.body.classList.add('cinematic-pilot');
  if (!hero.querySelector('.site-photo-preview-trigger img')) hero.classList.add('cinematic-pilot--no-photo');

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
  header.append(title, close);
  const surface = document.createElement('div');
  surface.className = 'cinematic-pilot__recommendations-surface';
  surface.append(header, recommendations);
  panel.append(surface);
  document.body.append(panel);
  trigger.setAttribute('aria-haspopup', 'dialog');

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
      panel.scrollTop = 0;
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
  // A modal locks page scrolling, while the destination restores it. Chromium's
  // cross-document snapshot can reject that viewport change on mobile. Keep
  // navigation native and reserve the photo transition for opening the explorer.
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
