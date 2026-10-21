(() => {
  const card = document.querySelector('.site-photo-gallery-rating');
  if (!card) return;

  const score = card.querySelector('.site-photo-gallery-rating__score');
  const trendPanel = card.querySelector('.site-photo-gallery-rating__trend');
  const trendTitle = card.querySelector('.site-photo-gallery-rating__trend-title');
  const trendChart = card.querySelector('.site-photo-gallery-rating__trend-chart');
  const trendHandle = document.createElement('button');
  trendHandle.className = 'site-photo-gallery-rating__trend-handle';
  trendHandle.type = 'button';
  trendHandle.setAttribute('aria-label', 'Collapse monthly rating chart');
  trendHandle.innerHTML = '<span aria-hidden="true"></span>';
  trendPanel.append(trendHandle);
  const ratingRecommendations = document.querySelector('[data-recommendation-rating-candidates]');
  const ratingTab = document.querySelector('[data-recommendation-tab="rating"]');
  const location = { lat:Number(card.dataset.ratingLat), lng:Number(card.dataset.ratingLng) };
  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return;

  if (trendTitle) trendTitle.textContent = 'Monthly Rating';

  let trendDragStartY = null;
  let trendHandleDragged = false;
  let trendCollapseAnimation = null;
  let trendReturnAnimation = null;
  const trendClip = amount => `inset(0px 0px ${amount}px 0px)`;
  const cancelTrendAnimation = animation => {
    if (animation) animation.cancel();
  };
  const animateTrendClip = (fromClip, toClip, duration, finish) => {
    const animation = trendPanel.animate(
      [{ clipPath: fromClip }, { clipPath: toClip }],
      { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'forwards' }
    );
    animation.onfinish = () => {
      finish();
      animation.cancel();
    };
    return animation;
  };
  const updateTrendDrag = clientY => {
    const distance = clientY - trendDragStartY;
    const collapseDistance = Math.min(trendPanel.getBoundingClientRect().height, Math.max(0, -distance));
    trendPanel.style.clipPath = trendClip(collapseDistance);
    trendHandleDragged = Math.abs(distance) >= 8;
    return distance;
  };
  trendHandle.addEventListener('pointerdown', event => {
    const interruptedCollapse = trendPanel.classList.contains('is-collapsing');
    cancelTrendAnimation(trendCollapseAnimation);
    cancelTrendAnimation(trendReturnAnimation);
    trendCollapseAnimation = null;
    trendReturnAnimation = null;
    if (interruptedCollapse) {
      trendPanel.classList.remove('is-collapsing');
      trendPanel.style.clipPath = '';
    }
    trendDragStartY = event.clientY;
    trendHandleDragged = false;
    trendPanel.classList.add('is-dragging');
    trendHandle.setPointerCapture?.(event.pointerId);
  });
  trendHandle.addEventListener('pointermove', event => {
    if (trendDragStartY == null) return;
    updateTrendDrag(event.clientY);
  });
  trendHandle.addEventListener('pointerup', event => {
    if (trendDragStartY == null) return;
    const distance = updateTrendDrag(event.clientY);
    trendDragStartY = null;
    trendPanel.classList.remove('is-dragging');
    if (distance <= -40) {
      const currentClip = getComputedStyle(trendPanel).clipPath;
      const panelHeight = trendPanel.getBoundingClientRect().height;
      const fullClip = trendClip(panelHeight);
      trendPanel.classList.add('is-collapsing');
      // Keep the open state until the clip animation finishes; otherwise the
      // closed-state styles replace the release frame before the upward motion can continue.
      trendCollapseAnimation = animateTrendClip(currentClip, fullClip, 260, () => {
        card.classList.remove('show-rating-trend');
        trendPanel.classList.remove('is-collapsing');
        trendPanel.style.clipPath = '';
        trendCollapseAnimation = null;
      });
    } else {
      const currentClip = getComputedStyle(trendPanel).clipPath;
      trendReturnAnimation = animateTrendClip(currentClip, trendClip(0), 160, () => {
        trendPanel.style.clipPath = '';
        trendReturnAnimation = null;
      });
    }
  });
  trendHandle.addEventListener('pointercancel', () => {
    const currentClip = getComputedStyle(trendPanel).clipPath;
    trendDragStartY = null;
    trendPanel.classList.remove('is-dragging');
    trendReturnAnimation = animateTrendClip(currentClip, trendClip(0), 160, () => {
      trendPanel.style.clipPath = '';
      trendReturnAnimation = null;
    });
  });
  trendHandle.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if (trendHandleDragged) {
      trendHandleDragged = false;
      return;
    }
    card.classList.remove('show-rating-trend');
  });

  const scoreLabels = Object.freeze({ Challenging:'Not ideal', Fair:'Okay', Good:'Good', Excellent:'Great' });
  const currentMonth = new Date().getMonth() + 1;
  const ratingSamples = new Map();
  const siteSlug = name => String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'dive-site';
  let trendPromise = null;
  let ratingStore = null;
  let currentRecommendationScore = NaN;
  let trendScores = null;

  function renderRatingTrend(monthlyScores) {
    trendScores = monthlyScores;
    const width = 300;
    const chartBounds = trendChart.getBoundingClientRect();
    const scale = chartBounds.width > 0 ? chartBounds.width / width : 1;
    const height = chartBounds.height > 0 ? chartBounds.height / scale : 112;
    const left = 18, right = 8, top = 20 / scale, bottom = 22 / scale;
    const availableScores = monthlyScores.filter(value => value != null);
    const minScore = availableScores.length ? Math.min(...availableScores) : 0;
    const maxScore = availableScores.length ? Math.max(...availableScores) : 100;
    // A local range reveals seasonal movement in every layout. Keep at least
    // 20 points of range so small differences are not exaggerated.
    const scoreRange = availableScores.length ? Math.max(20, maxScore - minScore) : 100;
    const domainMin = availableScores.length
      ? Math.max(0, Math.min((minScore + maxScore - scoreRange) / 2, 100 - scoreRange))
      : 0;
    const domainMax = Math.min(100, domainMin + scoreRange);
    const points = monthlyScores.map((value, index) => value == null ? null : ({
      x:left + index * (width - left - right) / 11,
      y:top + (domainMax - value) * (height - top - bottom) / (domainMax - domainMin),
      value
    }));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
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
    line.setAttribute('stroke-width', String(3 / scale));
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    svg.append(line);
    const labels = ['J','F','M','A','M','J','J','A','S','O','N','D'];
    points.forEach((point, index) => {
      if (point) {
        const marker = document.createElementNS(ns, 'circle');
        marker.setAttribute('cx', point.x);
        marker.setAttribute('cy', point.y);
        marker.setAttribute('r', String(3.5 / scale));
        marker.setAttribute('fill', 'rgb(55, 104, 213)');
        const title = document.createElementNS(ns, 'title');
        title.textContent = `${labels[index]}: ${Math.round(point.value)}/100`;
        marker.append(title);
        svg.append(marker);
        const value = document.createElementNS(ns, 'text');
        value.setAttribute('x', point.x);
        value.setAttribute('y', Math.max(top + 10 / scale, point.y - 7 / scale));
        value.setAttribute('text-anchor', 'middle');
        value.setAttribute('fill', 'rgb(55, 104, 213)');
        value.setAttribute('font-size', String(13.2 / scale));
        value.setAttribute('font-weight', '700');
        value.textContent = String(Math.round(point.value));
        svg.append(value);
      }
      const month = document.createElementNS(ns, 'text');
      month.setAttribute('x', left + index * (width - left - right) / 11);
      month.setAttribute('y', height - 4 / scale);
      month.setAttribute('text-anchor', 'middle');
      month.setAttribute('fill', 'currentColor');
      month.setAttribute('font-size', String(9 / scale));
      month.setAttribute('font-weight', '700');
      month.textContent = labels[index];
      svg.append(month);
    });
    trendChart.replaceChildren(svg);
    trendChart.setAttribute('aria-label', monthlyScores.some(value => value != null)
      ? 'Monthly DiveAtlas rating scores. Focus a point to read its month and score.'
      : 'Monthly DiveAtlas rating scores are unavailable.');
  }

  let trendResizeFrame = 0;
  if ('ResizeObserver' in window) {
    const trendChartResizeObserver = new ResizeObserver(() => {
      if (!trendScores) return;
      cancelAnimationFrame(trendResizeFrame);
      trendResizeFrame = requestAnimationFrame(() => renderRatingTrend(trendScores));
    });
    trendChartResizeObserver.observe(trendChart);
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

  const dismissedTrendClicks = new WeakSet();
  document.addEventListener('click', event => {
    if (trendPanel.contains(event.target) || getComputedStyle(trendPanel).visibility !== 'visible') return;
    dismissedTrendClicks.add(event);
    card.classList.remove('show-rating-trend');
    card.classList.add('is-trend-dismissed');
  }, true);
  card.addEventListener('pointerenter', () => {
    card.classList.remove('is-trend-dismissed');
    void loadRatingTrend(ratingStore);
  });
  card.addEventListener('pointerleave', () => card.classList.remove('is-trend-dismissed'));
  card.addEventListener('focusin', () => { void loadRatingTrend(ratingStore); });
  card.addEventListener('focusout', event => {
    if (!card.contains(event.relatedTarget)) card.classList.remove('is-trend-dismissed');
  });
  card.addEventListener('click', event => {
    if (trendPanel.contains(event.target) || dismissedTrendClicks.has(event)) return;
    if (event.pointerType === 'touch' || matchMedia('(hover: none)').matches) {
      card.classList.remove('is-trend-dismissed');
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

  async function refreshStaticCardRatings(store, targetCards) {
    const cards = targetCards || [...document.querySelectorAll('.site-recommendations__group .site-recommendations__card')];
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
      ratingRecommendations.recommendationTotal = 0;
      ratingRecommendations.recommendationRenderMore = null;
      window.DiveAtlasRecommendationCards?.configureExpansion(ratingRecommendations);
      const item = document.createElement('li');
      item.className = 'site-recommendations__empty';
      item.textContent = 'Current month rating is unavailable.';
      ratingRecommendations.replaceChildren(item);
      return;
    }
    if (ratingRecommendations.dataset.status === 'loading' || ratingRecommendations.dataset.status === 'ready') return;
    ratingRecommendations.dataset.status = 'loading';
    let candidates = [];
    try {
      candidates = ratingRecommendations.recommendationCandidates
        || JSON.parse(ratingRecommendations.dataset.recommendationRatingCandidates || '[]');
    } catch (error) {
      console.warn('Dive-site rating recommendations could not be read:', error);
    }
    const status = document.createElement('li');
    status.className = 'site-recommendations__empty';
    status.textContent = 'Comparing current ratings across all dive sites…';
    ratingRecommendations.replaceChildren(status);

    (async () => {
      const matches = [];
      const batchSize = 128;
      for (let start = 0; start < candidates.length; start += batchSize) {
        const batch = candidates.slice(start, start + batchSize);
        const sampled = await Promise.all(batch.map(async candidate => {
          if (!Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lon)) return null;
          try {
            const result = await sampleRating(candidate, store);
            return result != null && Math.abs(result - currentScore) <= 5
              ? { candidate, score:Math.round(result), difference:Math.abs(result - currentScore) }
              : null;
          } catch (_) {
            // A candidate with unavailable environmental data should not block the other matches.
            return null;
          }
        }));
        matches.push(...sampled.filter(Boolean));
        await new Promise(resolve => window.setTimeout(resolve, 0));
      }

      matches.sort((a, b) => a.difference - b.difference || a.candidate.name.localeCompare(b.candidate.name));
      const fragment = document.createDocumentFragment();
      if (matches.length) {
        const createRatingCard = ({ candidate, score }, expanded = false) => {
          const cardCandidate = {
            ...candidate,
            photoCredit:candidate.photo_credit,
            features:candidate.features,
            detailUrl:`/dive-site.html?id=${encodeURIComponent(`${siteSlug(candidate.name)}-${candidate.site_id}`)}`
          };
          return window.DiveAtlasRecommendationCards.create(cardCandidate, score, expanded);
        };
        for (const match of matches.slice(0, 5)) {
          fragment.append(createRatingCard(match));
        }
        ratingRecommendations.recommendationTotal = matches.length;
        ratingRecommendations.recommendationRenderMore = (start, count) => {
          const nextCards = document.createDocumentFragment();
          for (const match of matches.slice(start, start + count)) nextCards.append(createRatingCard(match, true));
          return nextCards;
        };
      } else {
        ratingRecommendations.recommendationTotal = 0;
        ratingRecommendations.recommendationRenderMore = null;
        const item = document.createElement('li');
        item.className = 'site-recommendations__empty';
        item.textContent = 'No sites within 5 points in the full dive-site catalog.';
        fragment.append(item);
      }
      ratingRecommendations.replaceChildren(fragment);
      window.DiveAtlasRecommendationCards?.configureExpansion(ratingRecommendations);
      ratingRecommendations.dataset.status = 'ready';
    })().catch(error => {
      console.warn('Dive-site rating recommendations could not be calculated:', error);
      const item = document.createElement('li');
      item.className = 'site-recommendations__empty';
      item.textContent = 'Similar ratings are unavailable right now.';
      ratingRecommendations.replaceChildren(item);
      ratingRecommendations.dataset.status = 'error';
    });
  }

  document.querySelector('.site-recommendations')?.addEventListener('diveatlas:recommendations-expanded', event => {
    if (!ratingStore || event.target.closest('[data-recommendation-group="rating"]')) return;
    refreshStaticCardRatings(ratingStore, event.detail.cards);
  });

  ratingTab?.addEventListener('click', () => {
    if (ratingStore && Number.isFinite(currentRecommendationScore)) {
      showRatingRecommendations(currentRecommendationScore, ratingStore);
    }
  });

  async function loadRating() {
    await import('./dive-experience-outlook-map.js?v=7');
    const outlook = window.DiveAtlasDiveExperienceMap;
    if (!outlook) throw new Error('Dive Experience Outlook module did not initialize.');
    // Detail pages have nested URLs; resolve the release explicitly rather than
    // relying on the map page's fetch rewrite, which uses the document directory.
    const manifestUrl = window.DiveAtlasDataAssets?.external
      ? window.DiveAtlasDataAssets.url('data/dive-experience-outlook/v3/manifest.json')
      : new URL('/data/dive-experience-outlook/v3/manifest.json', window.location.origin).href;
    const baseUrl = new URL('./', manifestUrl).href;
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
    currentRecommendationScore = sample.score;
    if (ratingTab?.getAttribute('aria-selected') === 'true') {
      showRatingRecommendations(sample.score, store);
    }
  }

  loadRating().catch(error => {
    console.warn('Dive-site rating card could not be loaded:', error);
    score.textContent = 'Rating unavailable';
    score.dataset.status = 'unavailable';
    if (ratingRecommendations) {
      const item = document.createElement('li');
      item.className = 'site-recommendations__empty';
      item.textContent = 'Similar ratings are unavailable right now.';
      ratingRecommendations.replaceChildren(item);
      ratingRecommendations.dataset.status = 'error';
    }
  });
})();
