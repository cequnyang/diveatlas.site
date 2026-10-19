(() => {
  window.DiveAtlasRecommendationCards = {
    create(candidate, rating) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'site-recommendations__card';
      link.dataset.recommendationCard = '';
      link.dataset.ratingLat = String(candidate.lat);
      link.dataset.ratingLng = String(candidate.lon);
      link.href = `/dive-sites/${encodeURIComponent(candidate.slug)}/`;

      const image = document.createElement('img');
      image.className = 'site-recommendations__image';
      image.alt = '';
      image.loading = 'lazy';
      if (candidate.photo) image.src = candidate.photo;
      else image.classList.add('site-recommendations__image--placeholder');
      if (candidate.photoCredit) image.title = candidate.photoCredit;
      image.addEventListener('error', () => image.classList.add('site-recommendations__image--placeholder'), { once:true });

      const body = document.createElement('span');
      body.className = 'site-recommendations__card-body';
      const name = document.createElement('span');
      name.className = 'site-recommendations__name';
      name.textContent = candidate.name;
      name.title = candidate.name;

      const meta = document.createElement('span');
      meta.className = 'site-recommendations__meta';
      const region = document.createElement('span');
      region.className = 'site-recommendations__location';
      region.textContent = candidate.region;
      const score = document.createElement('span');
      score.className = 'site-recommendations__rating';
      score.setAttribute('aria-label', 'DiveAtlas rating');
      score.textContent = rating == null ? 'Rating loading' : `${rating}/100`;
      meta.append(region, score);

      const features = document.createElement('span');
      features.className = 'site-recommendations__features';
      features.setAttribute('aria-label', 'Recorded features');
      for (const feature of (candidate.features || []).slice(0, 2)) {
        const badge = document.createElement('span');
        badge.className = 'site-recommendations__feature';
        badge.textContent = feature;
        features.append(badge);
      }
      if (!features.childElementCount) {
        const unavailable = document.createElement('span');
        unavailable.className = 'site-recommendations__feature site-recommendations__feature--empty';
        unavailable.textContent = 'Features unavailable';
        features.append(unavailable);
      }

      body.append(name, meta, features);
      link.append(image, body);
      item.append(link);
      return item;
    }
  };

  const recommendationAreas = document.querySelectorAll('.site-recommendations');

  for (const area of recommendationAreas) {
    const tabsContainer = area.querySelector('.site-recommendations__tabs');
    const tablist = area.querySelector('[role="tablist"]');
    const tabs = [...area.querySelectorAll('[data-recommendation-tab]')];
    const content = area.querySelector('[data-recommendation-content]');
    const groups = [...area.querySelectorAll('[data-recommendation-group]')];
    const scrollButtons = [...area.querySelectorAll('[data-recommendation-scroll]')];
    if (!tabsContainer || !tablist || !content || !tabs.length || !groups.length) continue;


    const combinedList = document.createElement('ul');
    combinedList.className = 'site-recommendations__combined';
    combinedList.setAttribute('aria-label', 'All recommended dive sites');
    combinedList.setAttribute('aria-live', 'polite');
    combinedList.hidden = true;
    content.append(combinedList);

    function refreshCombinedList() {
      const seen = new Set();
      const items = [];
      for (const group of groups) {
        const list = group.querySelector('ul');
        if (!list) continue;
        for (const item of list.children) {
          const link = item.querySelector('a[href]');
          if (!link) continue;
          const href = link.getAttribute('href');
          if (seen.has(href)) continue;
          seen.add(href);
          items.push(item.cloneNode(true));
        }
      }
      if (!items.length) {
        const empty = document.createElement('li');
        empty.className = 'site-recommendations__empty';
        empty.textContent = 'No recommended dive sites are available.';
        items.push(empty);
      }
      combinedList.replaceChildren(...items);
    }

    const listObserver = new MutationObserver(refreshCombinedList);
    for (const group of groups) {
      const list = group.querySelector('ul');
      if (list) listObserver.observe(list, { childList: true, subtree: true });
    }

    content.setAttribute('role', 'tabpanel');
    content.tabIndex = 0;

    function updateScrollButtons() {
      const maxScroll = tablist.scrollWidth - tablist.clientWidth;
      const atStart = tablist.scrollLeft <= 1;
      const atEnd = tablist.scrollLeft >= maxScroll - 1;
      tabsContainer.classList.toggle('site-recommendations__tabs--not-scrollable', maxScroll <= 1);
      area.classList.toggle('site-recommendations--filters-scrollable', maxScroll > 1);
      for (const button of scrollButtons) {
        const isLeft = button.dataset.recommendationScroll === '-1';
        const atEdge = isLeft ? atStart : atEnd;
        button.disabled = maxScroll <= 1 || atEdge;
        button.hidden = maxScroll <= 1;
        button.classList.toggle('site-recommendations__scroll--edge-hidden', maxScroll > 1 && atEdge);
        button.setAttribute('aria-hidden', String(maxScroll > 1 && atEdge));
        button.tabIndex = maxScroll > 1 && !atEdge ? 0 : -1;
      }
    }

    function centerTabWithinStrip(tab) {
      const maxScroll = tablist.scrollWidth - tablist.clientWidth;
      if (maxScroll <= 1) return;
      const strip = tablist.getBoundingClientRect();
      const button = tab.getBoundingClientRect();
      const target = tablist.scrollLeft + (button.left + button.right - strip.left - strip.right) / 2;
      tablist.scrollTo({ left: Math.max(0, Math.min(maxScroll, target)), behavior: 'smooth' });
    }

    function activate(tab, moveFocus = false) {
      const selectedKey = tab.dataset.recommendationTab;
      area.dataset.recommendationView = selectedKey;
      for (const candidate of tabs) {
        const selected = candidate === tab;
        candidate.setAttribute('aria-selected', String(selected));
        candidate.tabIndex = selected ? 0 : -1;
      }
      content.setAttribute('aria-labelledby', tab.id);
      if (selectedKey === 'all') {
        refreshCombinedList();
        combinedList.hidden = false;
        for (const group of groups) group.hidden = true;
      } else {
        combinedList.hidden = true;
        for (const group of groups) group.hidden = group.dataset.recommendationGroup !== selectedKey;
      }
      if (moveFocus) {
        tab.focus({ preventScroll: true });
        centerTabWithinStrip(tab);
      }
    }

    for (const tab of tabs) tab.addEventListener('click', () => {
      activate(tab);
      // Keep the page stationary while centering the active category in the
      // horizontal strip, as in the reference tab interaction.
      centerTabWithinStrip(tab);
    });

    tablist.addEventListener('keydown', event => {
      const currentIndex = Math.max(0, tabs.indexOf(event.target.closest('[data-recommendation-tab]')));
      let nextIndex = currentIndex;
      if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = tabs.length - 1;
      else return;
      event.preventDefault();
      activate(tabs[nextIndex], true);
    });

    for (const button of scrollButtons) {
      button.addEventListener('click', () => {
        tablist.scrollBy({ left:Number(button.dataset.recommendationScroll) * tablist.clientWidth * .75, behavior:'smooth' });
      });
    }
    tablist.addEventListener('scroll', updateScrollButtons, { passive:true });
    window.addEventListener('resize', updateScrollButtons);

    area.classList.add('site-recommendations--tabbed');
    activate(tabs[0]);
    tabsContainer.hidden = false;
    requestAnimationFrame(updateScrollButtons);
  }
})();
