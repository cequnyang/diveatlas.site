(() => {
  'use strict';

  const cards = [...document.querySelectorAll('.site-directory-recommendations .site-recommendations__card[data-rating-lat][data-rating-lng]')];
  if (!cards.length) return;

  for (const image of document.querySelectorAll('.site-directory-recommendations .site-recommendations__image[src]')) {
    image.addEventListener('error', () => {
      const placeholder = document.createElement('span');
      placeholder.className = 'site-recommendations__image site-recommendations__image--placeholder';
      placeholder.setAttribute('aria-hidden', 'true');
      image.replaceWith(placeholder);
    }, { once:true });
  }

  async function loadRatingStore() {
    await import('./dive-experience-outlook-map.js?v=7');
    const outlook = window.DiveAtlasDiveExperienceMap;
    if (!outlook) throw new Error('Dive Experience Outlook module did not initialize.');
    const assets = window.DiveAtlasDataAssets;
    const manifestUrl = assets?.external && typeof assets.url === 'function'
      ? assets.url('data/dive-experience-outlook/v3/manifest.json')
      : new URL('/data/dive-experience-outlook/v3/manifest.json', location.origin).href;
    return outlook.createDataStore({
      baseUrl:new URL('./', manifestUrl).href,
      landMaskUrl:new URL('/datasets/dive-experience-land-mask-v1.bin.gz', location.origin).href,
    });
  }

  async function renderRatings() {
    const month = new Date().getMonth() + 1;
    try {
      const store = await loadRatingStore();
      for (let start = 0; start < cards.length; start += 8) {
        const batch = cards.slice(start, start + 8);
        await Promise.all(batch.map(async card => {
          const rating = card.querySelector('.site-recommendations__rating');
          const lat = Number(card.dataset.ratingLat);
          const lng = Number(card.dataset.ratingLng);
          if (!rating || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
          try {
            const result = await store.sample({ lat, lng }, month);
            rating.textContent = result?.score == null ? 'Rating unavailable' : `${Math.round(result.score)}/100`;
          } catch (_) {
            rating.textContent = 'Rating unavailable';
          }
        }));
        if (start + batch.length < cards.length) await new Promise(resolve => window.setTimeout(resolve, 0));
      }
    } catch (_) {
      for (const card of cards) {
        const rating = card.querySelector('.site-recommendations__rating');
        if (rating) rating.textContent = 'Rating unavailable';
      }
    }
  }

  void renderRatings();
})();
