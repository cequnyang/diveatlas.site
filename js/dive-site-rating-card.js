(() => {
  const card = document.querySelector('.site-photo-gallery-rating');
  if (!card) return;

  const score = card.querySelector('.site-photo-gallery-rating__score');
  const location = { lat:Number(card.dataset.ratingLat), lng:Number(card.dataset.ratingLng) };
  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return;

  const scoreLabels = Object.freeze({ Challenging:'Not ideal', Fair:'Okay', Good:'Good', Excellent:'Great' });
  const currentMonth = new Date().getMonth() + 1;

  async function loadRating() {
    await import('./dive-experience-outlook-map.js?v=7');
    const outlook = window.DiveAtlasDiveExperienceMap;
    if (!outlook) throw new Error('Dive Experience Outlook module did not initialize.');
    const baseUrl = new URL('/data/dive-experience-outlook/v3/', window.location.origin).href;
    const landMaskUrl = new URL('/datasets/dive-experience-land-mask-v1.bin.gz', window.location.origin).href;
    const store = outlook.createDataStore({ baseUrl, landMaskUrl });
    const sample = await store.sample(location, currentMonth);

    if (sample?.score == null) {
      score.textContent = 'No score available';
      score.dataset.status = 'unavailable';
      return;
    }
    const value = document.createElement('span');
    value.className = 'site-photo-gallery-rating__value';
    value.textContent = `${Math.round(sample.score)}/100`;
    const level = document.createElement('span');
    level.className = 'site-photo-gallery-rating__level';
    level.textContent = scoreLabels[sample.label] || sample.label || 'Rated';
    score.replaceChildren(value, level);
    score.dataset.status = 'ready';
  }

  loadRating().catch(error => {
    console.warn('Dive-site rating card could not be loaded:', error);
    score.textContent = 'Rating unavailable';
    score.dataset.status = 'unavailable';
  });
})();
