(() => {
  const card = document.querySelector('.site-photo-gallery-rating');
  if (!card) return;

  const score = card.querySelector('.site-photo-gallery-rating__score');
  const trendPanel = card.querySelector('.site-photo-gallery-rating__trend');
  const trendChart = card.querySelector('.site-photo-gallery-rating__trend-chart');
  const ratingRecommendations = document.querySelector('[data-recommendation-rating-candidates]');
  const location = { lat:Number(card.dataset.ratingLat), lng:Number(card.dataset.ratingLng) };
  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return;

  const scoreLabels = Object.freeze({ Challenging:'Not ideal', Fair:'Okay', Good:'Good', Excellent:'Great' });
  const currentMonth = new Date().getMonth() + 1;
  const ratingSamples = new Map();
  let trendPromise = null;
  let ratingStore = null;

  function renderRatingTrend(monthlyScores) {
    const width = 300, height = 112, left = 18, right = 8, top = 8, bottom = 22;
    const points = monthlyScores.map((value, index) => value == null ? null : ({
      x:left + index * (width - left - right) / 11,
      y:top + (100 - value) * (height - top - bottom) / 100,
      value
    }));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Monthly DiveAtlas rating scores from January to December');
    const ns = 'http://www.w3.org/2000/svg';
    const line = document.createElementNS(ns, 'path');
    let penDown = false;
    line.setAttribute('d', points.map(point => {
      if (!point) { penDown = false; return ''; }
      const command = `${penDown ? 'L' : 'M'}${point.x},${point.y}`;
      penDown = true;
      return command;
    }).join(' '));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', 'rgb(55, 104, 213)');
    line.setAttribute('stroke-width', '3');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    svg.append(line);
    const labels = ['J','F','M','A','M','J','J','A','S','O','N','D'];
    points.forEach((point, index) => {
      if (point) {
        const marker = document.createElementNS(ns, 'circle');
        marker.setAttribute('cx', point.x);
        marker.setAttribute('cy', point.y);
        marker.setAttribute('r', '3.5');
        marker.setAttribute('fill', 'rgb(55, 104, 213)');
        const title = document.createElementNS(ns, 'title');
        title.textContent = `${labels[index]}: ${Math.round(point.value)}/100`;
        marker.append(title);
        svg.append(marker);
        const value = document.createElementNS(ns, 'text');
        value.setAttribute('x', point.x);
        value.setAttribute('y', Math.max(top + 10, point.y - 7));
        value.setAttribute('text-anchor', 'middle');
        value.setAttribute('fill', 'rgb(55, 104, 213)');
        value.setAttribute('font-size', '13.2');
        value.setAttribute('font-weight', '700');
        value.textContent = String(Math.round(point.value));
        svg.append(value);
      }
      const month = document.createElementNS(ns, 'text');
      month.setAttribute('x', left + index * (width - left - right) / 11);
      month.setAttribute('y', height - 4);
      month.setAttribute('text-anchor', 'middle');
      month.setAttribute('fill', 'currentColor');
      month.setAttribute('font-size', '9');
      month.setAttribute('font-weight', '700');
      month.textContent = labels[index];
      svg.append(month);
    });
    trendChart.replaceChildren(svg);
    trendChart.setAttribute('aria-label', monthlyScores.some(value => value != null)
      ? 'Monthly DiveAtlas rating scores. Focus a point to read its month and score.'
      : 'Monthly DiveAtlas rating scores are unavailable.');
  }

  async function loadRatingTrend(store) {
    if (trendPromise) return trendPromise;
    trendPromise = (async () => {
      const values = [];
      for (let start = 1; start <= 12; start += 3) {
        const batch = await Promise.all(Array.from({ length:Math.min(3, 13 - start) }, (_, offset) =>
          store.sample(location, start + offset).then(result => result?.score == null ? null : Number(result.score)).catch(() => null)));
        values.push(...batch);
      }
      renderRatingTrend(values);
    })().catch(error => {
      trendPromise = null;
      trendChart.textContent = 'Monthly scores are unavailable.';
      console.warn('Monthly DiveAtlas ratings could not be calculated:', error);
    });
    return trendPromise;
  }

  card.addEventListener('pointerenter', () => { void loadRatingTrend(ratingStore); });
  card.addEventListener('focusin', () => { void loadRatingTrend(ratingStore); });
  card.addEventListener('click', event => {
    if (event.pointerType === 'touch' || matchMedia('(hover: none)').matches) {
      card.classList.toggle('show-rating-trend');
      void loadRatingTrend(ratingStore);
    }
  });

  function sampleRating(candidate, store) {
    const lat = Number(candidate.lat);
    const lng = Number(candidate.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return Promise.resolve(null);
    const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    if (!ratingSamples.has(key)) {
      ratingSamples.set(key, store.sample({ lat, lng }, currentMonth)
        .then(result => result?.score == null ? null : Number(result.score))
        .catch(() => null));
    }
    return ratingSamples.get(key);
  }

  async function refreshStaticCardRatings(store) {
    const cards = [...document.querySelectorAll('.site-recommendations__group .site-recommendations__card')];
    for (const [index, card] of cards.entries()) {
      const score = card.querySelector('.site-recommendations__rating');
      const rating = await sampleRating({ lat:card.dataset.ratingLat, lon:card.dataset.ratingLng }, store);
      if (score) score.textContent = rating == null ? 'Rating unavailable' : `${Math.round(rating)}/100`;
      if ((index + 1) % 8 === 0) await new Promise(resolve => window.setTimeout(resolve, 0));
    }
  }

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
          const result = await sampleRating(candidate, store);
          if (result != null && Math.abs(result - currentScore) <= 5) {
            matches.push({ candidate, score:Math.round(result), difference:Math.abs(result - currentScore) });
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
          const cardCandidate = {
            ...candidate,
            photoCredit:candidate.photo_credit,
            features:candidate.features
          };
          fragment.append(window.DiveAtlasRecommendationCards.create(cardCandidate, candidateScore));
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
    ratingStore = store;
    refreshStaticCardRatings(store).catch(error => {
      console.warn('Dive-site recommendation ratings could not be calculated:', error);
    });
    const sample = await store.sample(location, currentMonth);
    if (card.matches(':hover')) void loadRatingTrend(store);

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
