(() => {
  const card = document.querySelector('.site-photo-gallery-rating');
  if (!card) return;

  const score = card.querySelector('.site-photo-gallery-rating__score');
  const ratingRecommendations = document.querySelector('[data-recommendation-rating-candidates]');
  const location = { lat:Number(card.dataset.ratingLat), lng:Number(card.dataset.ratingLng) };
  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return;

  const scoreLabels = Object.freeze({ Challenging:'Not ideal', Fair:'Okay', Good:'Good', Excellent:'Great' });
  const currentMonth = new Date().getMonth() + 1;

  function showRatingRecommendations(currentScore, store) {
    if (!ratingRecommendations) return;
    if (!Number.isFinite(currentScore)) {
      const item = document.createElement('li');
      item.className = 'site-recommendations__empty';
      item.textContent = 'Current month rating is unavailable.';
      ratingRecommendations.replaceChildren(item);
      return;
    }
    let candidates = [];
    try {
      candidates = JSON.parse(ratingRecommendations.dataset.recommendationRatingCandidates || '[]');
    } catch (error) {
      console.warn('Dive-site rating recommendations could not be read:', error);
    }

    (async () => {
      const matches = [];
      for (const [index, candidate] of candidates.entries()) {
        if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lon)) continue;
        try {
          const result = await store.sample({ lat:candidate.lat, lng:candidate.lon }, currentMonth);
          if (result?.score != null && Math.abs(result.score - currentScore) <= 5) {
            matches.push({ candidate, score:Math.round(result.score), difference:Math.abs(result.score - currentScore) });
          }
        } catch (_) {
          // A candidate with unavailable environmental data should not block the other matches.
        }
        if ((index + 1) % 8 === 0) await new Promise(resolve => window.setTimeout(resolve, 0));
      }

      matches.sort((a, b) => a.difference - b.difference || a.candidate.name.localeCompare(b.candidate.name));
      const fragment = document.createDocumentFragment();
      if (matches.length) {
        for (const { candidate, score: candidateScore } of matches.slice(0, 3)) {
          const item = document.createElement('li');
          const link = document.createElement('a');
          link.href = `/dive-sites/${encodeURIComponent(candidate.slug)}/`;
          const name = document.createElement('span');
          name.className = 'site-recommendations__name';
          name.textContent = candidate.name;
          const detail = document.createElement('span');
          detail.className = 'site-recommendations__rating';
          detail.textContent = `${candidate.region} · ${candidateScore}/100`;
          link.append(name, detail);
          item.append(link);
          fragment.append(item);
        }
      } else {
        const item = document.createElement('li');
        item.className = 'site-recommendations__empty';
        item.textContent = 'No sites within 5 points in this published set.';
        fragment.append(item);
      }
      ratingRecommendations.replaceChildren(fragment);
    })().catch(error => {
      console.warn('Dive-site rating recommendations could not be calculated:', error);
      const item = document.createElement('li');
      item.className = 'site-recommendations__empty';
      item.textContent = 'Similar ratings are unavailable right now.';
      ratingRecommendations.replaceChildren(item);
    });
  }

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
      showRatingRecommendations(NaN, store);
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
    showRatingRecommendations(sample.score, store);
  }

  loadRating().catch(error => {
    console.warn('Dive-site rating card could not be loaded:', error);
    score.textContent = 'Rating unavailable';
    score.dataset.status = 'unavailable';
  });
})();
