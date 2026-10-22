(() => {
  'use strict';

  const slot = document.getElementById('seoSiteSearchSlot');
  const section = document.getElementById('seoSiteSearchSection');
  const input = document.getElementById('seoSiteSearchInput');
  const searchBox = section?.querySelector('.dive-search-box');
  const searchToggle = document.getElementById('seoSiteSearchToggle');
  const clearButton = document.getElementById('seoSiteSearchClear');
  const filterToggle = document.getElementById('seoSiteSearchFilterToggle');
  const results = document.getElementById('seoSiteSearchResults');
  const resultsScroll = document.getElementById('seoSiteSearchResultsScroll');
  const filterControls = document.getElementById('seoSiteSearchFilterControls');
  const countrySelect = document.getElementById('seoSiteSearchCountry');
  const difficultySelect = document.getElementById('seoSiteSearchDifficulty');
  const featureSelect = document.getElementById('seoSiteSearchFeature');
  const filterClear = document.getElementById('seoSiteSearchFilterClear');
  const mobileLayoutQuery = window.matchMedia('(max-width: 720px)');
  if (!slot || !section || !searchBox || !input || !results || !resultsScroll || !filterControls) return;

  // The header uses backdrop-filter, which would otherwise make fixed results
  // position relative to the header instead of the viewport.
  document.body.append(results);

  const normalize = value => String(value || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
  const valuesFor = (site, key) => Array.isArray(site[key]) ? site[key].filter(Boolean) : [];
  let searchSites = [];
  const initialResultCount = 30;
  let visibleResultCount = initialResultCount;
  let matches = [];
  let activeIndex = -1;
  let isOpen = false;
  let filtersOpen = false;
  const suggestion = document.createElement('div');
  suggestion.className = 'dive-search-suggestion';
  const suggestionButton = document.createElement('button');
  suggestionButton.className = 'dive-search-suggestion-button';
  suggestionButton.type = 'button';
  suggestion.append(suggestionButton);

  function updateSuggestionLabel(query = input.value.trim()) {
    const prompt = window.DiveAtlasSiteDetailI18n?.translate('Suggest a missing Dive site') || 'Suggest a missing Dive site';
    suggestionButton.textContent = prompt;
    suggestionButton.setAttribute('aria-label', query ? `${prompt}: ${query}` : prompt);
  }

  function appendSuggestion(query) {
    updateSuggestionLabel(query);
    resultsScroll.append(suggestion);
  }

  window.addEventListener('diveatlas:language-change', () => {
    if (suggestion.isConnected) updateSuggestionLabel();
  });

  // Keep submission and Turnstile verification on the map page's canonical form.
  suggestionButton.addEventListener('click', () => {
    const url = new URL('/', window.location.href);
    url.searchParams.set('suggestSite', '1');
    const query = input.value.trim().slice(0, 120);
    if (query) url.searchParams.set('siteName', query);
    window.location.assign(`${url.pathname}${url.search}`);
  });

  function optionValues(key, excludedFilter, getValues = site => [site[key]]) {
    const filters = activeFilters();
    const select = {
      country:countrySelect,
      difficulty:difficultySelect,
      feature:featureSelect
    }[excludedFilter];
    const selectedValue = String(select?.value || '').trim();
    const unique = new Map();
    // A facet only offers values that match the other active filters. Retaining its
    // selection keeps the control usable when a combination has no matching sites.
    for (const site of searchSites) {
      if (!siteMatchesFiltersExcept(site, filters, excludedFilter)) continue;
      for (const rawValue of getValues(site)) {
        const value = String(rawValue || '').trim();
        const keyValue = normalize(value);
        if (keyValue && !unique.has(keyValue)) unique.set(keyValue, value);
      }
    }
    const selectedKey = normalize(selectedValue);
    if (selectedKey) unique.set(selectedKey, selectedValue);
    return [...unique.values()].sort((a, b) => a.localeCompare(b));
  }

  function fillSelect(select, anyLabel, values) {
    if (!select) return;
    const selected = select.value;
    select.replaceChildren(new Option(anyLabel, ''), ...values.map(value => new Option(value, value)));
    if (values.includes(selected)) select.value = selected;
  }

  // Hidden selects remain the selected-value model; picker text only narrows candidates.
  let filterPickers = [];
  function createFilterPicker(select) {
    const label = select.closest('.dive-search-filter-field')?.querySelector('span');
    const source = 'search';
    const picker = document.createElement('input');
    picker.type = 'text';
    picker.id = `${select.id}Picker`;
    picker.className = 'dive-filter-picker';
    picker.autocomplete = 'off';
    picker.spellcheck = false;
    picker.setAttribute('role', 'combobox');
    picker.setAttribute('aria-haspopup', 'listbox');
    picker.setAttribute('aria-autocomplete', 'list');
    picker.setAttribute('aria-expanded', 'false');
    picker.setAttribute('aria-labelledby', label?.id || '');
    picker.setAttribute('placeholder', select.options[0]?.textContent || '');

    const list = document.createElement('div');
    list.id = `${picker.id}Options`;
    list.className = 'dive-filter-options';
    list.dataset.filterSource = source;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-labelledby', label?.id || '');
    list.hidden = true;
    picker.setAttribute('aria-controls', list.id);
    const scroll = document.createElement('div');
    scroll.className = 'dive-filter-options-scroll';
    list.append(scroll);

    const wrapper = document.createElement('div');
    wrapper.className = 'dive-filter-picker-wrap';
    select.hidden = true;
    select.after(wrapper);

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'dive-filter-picker-clear';
    clearButton.setAttribute('aria-label', 'Clear selection');
    clearButton.title = 'Clear selection';
    clearButton.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m4 4 8 8M12 4l-8 8"/></svg>';
    clearButton.hidden = true;
    wrapper.append(picker, clearButton);
    document.body.append(list);

    let activeIndex = 0;
    let visibleIndexes = [];
    function syncClearButton() {
      const hasContent = Boolean(picker.value.trim() || select.value);
      clearButton.hidden = !hasContent;
      wrapper.classList.toggle('has-clear', hasContent);
    }
    function close() {
      list.hidden = true;
      picker.setAttribute('aria-expanded', 'false');
      picker.removeAttribute('aria-activedescendant');
    }
    function highlight(visibleIndex) {
      activeIndex = Math.max(0, Math.min(visibleIndexes.length - 1, visibleIndex));
      Array.from(scroll.children).forEach(option => {
        option.classList.toggle('is-active', Number(option.dataset.optionIndex) === visibleIndexes[activeIndex]);
      });
      const option = scroll.querySelector(`[data-option-index="${visibleIndexes[activeIndex]}"]`);
      if (!option) return;
      picker.setAttribute('aria-activedescendant', option.id);
      const top = option.offsetTop;
      if (top < scroll.scrollTop) scroll.scrollTop = top;
      else if (top + option.offsetHeight > scroll.scrollTop + scroll.clientHeight) {
        scroll.scrollTop = top + option.offsetHeight - scroll.clientHeight;
      }
    }
    function choose(index) {
      if (!Number.isInteger(index) || index < 0) return;
      select.selectedIndex = index;
      const selectedLabel = select.selectedOptions[0]?.textContent || '';
      picker.value = select.value ? selectedLabel : '';
      picker.placeholder = selectedLabel;
      close();
      syncClearButton();
      select.dispatchEvent(new CustomEvent('change', { bubbles:true, detail:{ source } }));
      picker.focus({ preventScroll:true });
    }
    function renderOptions(query = '') {
      const normalizedQuery = query.trim().toLocaleLowerCase();
      const matches = Array.from(select.options, (option, index) => ({
        option,
        index,
        label:option.textContent.toLocaleLowerCase()
      })).filter(({label:optionLabel}) => !normalizedQuery || optionLabel.includes(normalizedQuery));
      if (normalizedQuery) {
        matches.sort((a, b) => {
          const aStartsWithQuery = a.label.startsWith(normalizedQuery);
          const bStartsWithQuery = b.label.startsWith(normalizedQuery);
          return Number(bStartsWithQuery) - Number(aStartsWithQuery) ||
            a.option.textContent.localeCompare(b.option.textContent) || a.index - b.index;
        });
      }
      visibleIndexes = matches.map(({index}) => index);
      scroll.replaceChildren(...visibleIndexes.map(index => {
        const option = select.options[index];
        const item = document.createElement('div');
        item.id = `${list.id}-${index}`;
        item.className = 'dive-filter-option';
        item.dataset.optionIndex = String(index);
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(option.selected));
        const optionLabel = option.textContent;
        if (normalizedQuery) {
          const lowerLabel = optionLabel.toLocaleLowerCase();
          let offset = 0;
          let matchAt = lowerLabel.indexOf(normalizedQuery, offset);
          while (matchAt !== -1) {
            item.append(document.createTextNode(optionLabel.slice(offset, matchAt)));
            const match = document.createElement('strong');
            match.textContent = optionLabel.slice(matchAt, matchAt + normalizedQuery.length);
            item.append(match);
            offset = matchAt + normalizedQuery.length;
            matchAt = lowerLabel.indexOf(normalizedQuery, offset);
          }
          item.append(document.createTextNode(optionLabel.slice(offset)));
        } else item.textContent = optionLabel;
        item.addEventListener('click', () => choose(index));
        return item;
      }));
      if (!visibleIndexes.length) {
        const empty = document.createElement('div');
        empty.className = 'dive-filter-option';
        empty.setAttribute('aria-disabled', 'true');
        empty.textContent = 'No matching options';
        scroll.append(empty);
      }
    }
    function positionList() {
      const rect = picker.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const upwards = below < 160 && above > below;
      const height = Math.min(280, Math.max(40, upwards ? above : below));
      const width = Math.min(Math.max(rect.width, 180), Math.max(0, window.innerWidth - 16));
      list.style.width = `${width}px`;
      list.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
      list.style.maxHeight = `${height}px`;
      scroll.style.maxHeight = `${height - 14}px`;
      list.style.top = upwards ? 'auto' : `${rect.bottom + 4}px`;
      list.style.bottom = upwards ? `${window.innerHeight - rect.top + 4}px` : 'auto';
    }
    function open() {
      filterPickers.forEach(other => other.close());
      renderOptions(picker.value);
      positionList();
      list.hidden = false;
      picker.setAttribute('aria-expanded', 'true');
      const selectedVisibleIndex = visibleIndexes.indexOf(Math.max(0, select.selectedIndex));
      highlight(selectedVisibleIndex >= 0 ? selectedVisibleIndex : 0);
    }

    picker.addEventListener('click', open);
    picker.addEventListener('focus', () => picker.select());
    picker.addEventListener('input', () => {
      syncClearButton();
      if (list.hidden) open();
      else { renderOptions(picker.value); positionList(); highlight(0); }
    });
    picker.addEventListener('keydown', event => {
      if (event.key === 'Tab') { close(); return; }
      if (event.key === 'Escape') {
        if (!list.hidden) {
          event.preventDefault();
          event.stopPropagation();
          picker.value = select.value ? (select.selectedOptions[0]?.textContent || '') : '';
          syncClearButton();
          close();
        }
        return;
      }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        if (list.hidden) { open(); return; }
        if (event.key === 'Enter' && visibleIndexes.length) choose(visibleIndexes[activeIndex]);
        else highlight(event.key === 'Home' ? 0 : event.key === 'End' ? visibleIndexes.length - 1 : activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
      }
    });
    picker.addEventListener('blur', close);
    clearButton.addEventListener('mousedown', event => event.preventDefault());
    clearButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      select.value = '';
      picker.value = '';
      close();
      syncClearButton();
      select.dispatchEvent(new CustomEvent('change', { bubbles:true, detail:{ source } }));
      picker.focus({ preventScroll:true });
    });
    list.addEventListener('mousedown', event => {
      if (event.target.closest('.dive-filter-option')) event.preventDefault();
    });
    document.addEventListener('pointerdown', event => {
      if (!picker.contains(event.target) && !list.contains(event.target)) close();
    });
    window.addEventListener('resize', close);
    document.addEventListener('scroll', event => {
      if (!list.contains(event.target)) close();
    }, true);
    return {
      close,
      sync() {
        const selected = select.selectedOptions[0]?.textContent || '';
        if (document.activeElement !== picker) picker.value = select.value ? selected : '';
        picker.placeholder = selected;
        syncClearButton();
      }
    };
  }

  filterPickers = [countrySelect, difficultySelect, featureSelect].filter(Boolean).map(createFilterPicker);

  function setCatalog(rawSites) {
    searchSites = Array.isArray(rawSites) ? rawSites.map(site => {
      const features = valuesFor(site, 'feature_values').length
        ? valuesFor(site, 'feature_values') : valuesFor(site, 'features');
      const name = String(site.name || '');
      const location = [site.region, site.country].filter(Boolean).join(' ');
      return {
        ...site,
        features,
        normalizedName:normalize(name),
        normalizedSearch:normalize([name, location, site.difficulty, ...features].join(' '))
      };
    }) : [];
    updateFilterOptions();
    if (isOpen) renderResults();
  }

  if (Array.isArray(window.DIVE_ATLAS_SEO_SEARCH_CATALOG)) {
    setCatalog(window.DIVE_ATLAS_SEO_SEARCH_CATALOG);
  }
  window.addEventListener('diveatlas:seo-search-catalog-ready', event => setCatalog(event.detail?.sites));

  function activeFilters() {
    return {
      country:normalize(countrySelect?.value),
      difficulty:normalize(difficultySelect?.value),
      feature:normalize(featureSelect?.value)
    };
  }

  function hasActiveFilters() {
    return Object.values(activeFilters()).some(Boolean);
  }

  function siteMatchesFilters(site, filters) {
    return siteMatchesFiltersExcept(site, filters, null);
  }

  function siteMatchesFiltersExcept(site, filters, excludedFilter) {
    if (excludedFilter !== 'country' && filters.country && normalize(site.country) !== filters.country) return false;
    if (excludedFilter !== 'difficulty' && filters.difficulty && normalize(site.difficulty) !== filters.difficulty) return false;
    if (excludedFilter !== 'feature' && filters.feature && !site.features.some(feature => normalize(feature) === filters.feature)) return false;
    return true;
  }

  function updateFilterOptions() {
    fillSelect(countrySelect, 'Any country', optionValues('country', 'country'));
    fillSelect(difficultySelect, 'Any difficulty', optionValues('difficulty', 'difficulty'));
    fillSelect(featureSelect, 'Any feature', optionValues('features', 'feature', site => site.features));
    filterPickers.forEach(picker => picker.sync());
  }

  function siteMeta(site) {
    return [
      [site.region, site.country].filter(Boolean).join(', '),
      site.difficulty,
      site.features.slice(0, 2).join(' · ')
    ].filter(Boolean).join(' · ');
  }

  function updateFilterState() {
    filterPickers.forEach(picker => picker.sync());
    if (!filtersOpen) filterPickers.forEach(picker => picker.close());
    const hasFilters = hasActiveFilters();
    filterToggle?.classList.toggle('has-active-filters', hasFilters);
    filterClear.hidden = !hasFilters;
    results.classList.toggle('has-filters', filtersOpen);
    slot.classList.toggle('has-search-filters', filtersOpen);
    filterToggle?.setAttribute('aria-expanded', String(filtersOpen));
    filterControls.hidden = !filtersOpen;
  }

  function repositionResults() {
    if (!isOpen || !results.classList.contains('visible')) return;
    const rect = searchBox.getBoundingClientRect();
    const boxStyle = getComputedStyle(searchBox);
    const dividerStyle = getComputedStyle(searchBox, '::after');
    const mobileLayout = mobileLayoutQuery.matches;
    const dividerOffset = Math.max(0,
      rect.width - parseFloat(boxStyle.borderRightWidth) - parseFloat(dividerStyle.right) - parseFloat(dividerStyle.width)
    );
    const availableFilterWidth = Math.max(0, window.innerWidth - rect.left - dividerOffset - 12);
    const filterWidth = mobileLayout
      ? availableFilterWidth
      : Math.min(360, availableFilterWidth) * 0.6;
    const stacked = filtersOpen && filterWidth < 200 && !mobileLayout;
    const candidateBaseWidth = filtersOpen ? dividerOffset : rect.width;
    const searchUiFocused = slot.contains(document.activeElement) || results.contains(document.activeElement) ||
      slot.classList.contains('is-search-focus-retained');
    const candidateExpansion = mobileLayout && searchUiFocused && (!filtersOpen || !stacked)
      ? Math.min(Math.max(0, 250 - candidateBaseWidth), Math.max(0, rect.left - 12))
      : 0;
    const candidatePaneWidth = candidateBaseWidth + candidateExpansion;
    const top = Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 180));

    results.classList.toggle('is-stacked', stacked);
    results.classList.toggle('is-filter-compact', filtersOpen && !stacked && filterWidth < 300);
    if (filtersOpen && !stacked) {
      results.style.setProperty('--search-results-candidate-width', `${Math.max(0, candidatePaneWidth - 1)}px`);
      results.style.setProperty('--search-results-filter-width', `${filterWidth}px`);
      results.style.width = `${candidatePaneWidth + filterWidth + 1}px`;
    } else {
      results.style.removeProperty('--search-results-candidate-width');
      results.style.removeProperty('--search-results-filter-width');
      results.style.width = `${mobileLayout ? candidatePaneWidth : rect.width}px`;
    }
    results.style.left = `${rect.left - candidateExpansion}px`;
    results.style.top = `${top}px`;
    results.style.maxHeight = `${Math.max(0, Math.min(440, window.innerHeight - top - 12))}px`;
    results.style.removeProperty('height');
  }

  function setOpen(next) {
    isOpen = Boolean(next);
    if (!isOpen) filtersOpen = false;
    input.setAttribute('aria-expanded', String(isOpen));
    searchToggle?.setAttribute('aria-expanded', String(isOpen));
    results.classList.toggle('visible', isOpen);
    updateSearchFocusLayout();
    updateFilterState();
    if (isOpen) renderResults();
  }

  function updateSearchFocusLayout() {
    const activeElement = document.activeElement;
    const hasSearchUiFocus = slot.contains(activeElement) || results.contains(activeElement);
    slot.classList.toggle('is-mobile-expanded', isOpen && mobileLayoutQuery.matches && hasSearchUiFocus);
    slot.classList.toggle('is-search-focus-retained', isOpen && results.contains(activeElement));
  }

  document.addEventListener('focusin', updateSearchFocusLayout);
  document.addEventListener('focusout', () => requestAnimationFrame(updateSearchFocusLayout));

  function findMatches(query) {
    const filters = activeFilters();
    const queryWords = normalize(query).split(/\s+/).filter(Boolean);
    const ranked = [];
    for (const site of searchSites) {
      if (!siteMatchesFilters(site, filters)) continue;
      if (!queryWords.every(word => site.normalizedSearch.includes(word))) continue;
      const rank = !queryWords.length ? 0
        : site.normalizedName === queryWords.join(' ') ? 0
          : site.normalizedName.startsWith(queryWords.join(' ')) ? 1
            : site.normalizedName.includes(queryWords.join(' ')) ? 2 : 3;
      ranked.push({ site, rank });
    }
    ranked.sort((a, b) => a.rank - b.rank || a.site.name.localeCompare(b.site.name));
    return ranked.map(result => result.site);
  }

  function renderResults() {
    if (!searchSites.length) {
      matches = [];
      resultsScroll.innerHTML = '<div class="dive-search-empty" role="status">Dive-site search is unavailable right now.</div>';
      repositionResults();
      return;
    }

    const query = input.value.trim();
    const filtersApplied = hasActiveFilters();
    matches = findMatches(query);
    activeIndex = -1;
    visibleResultCount = initialResultCount;

    if (!query && !filtersApplied) {
      resultsScroll.innerHTML = '<div class="dive-search-empty" role="status">Search by dive-site name or location, or choose a filter.</div>';
      repositionResults();
      return;
    }
    if (!matches.length) {
      resultsScroll.innerHTML = '<div class="dive-search-empty" role="status">No dive sites match your search.</div>';
      if (query) appendSuggestion(query);
      repositionResults();
      return;
    }
    drawVisibleResults();
  }

  function drawVisibleResults() {
    const visible = matches.slice(0, visibleResultCount);
    const resultsMarkup = visible.map((site, index) =>
      `<button class="dive-search-result" type="button" id="seo-site-search-result-${index}" role="option" aria-selected="false" aria-posinset="${index + 1}" aria-setsize="${matches.length}" data-match-index="${index}"><div class="dive-search-result-name">${escapeHtml(site.name)}</div>${siteMeta(site) ? `<div class="dive-search-result-meta">${escapeHtml(siteMeta(site))}</div>` : ''}</button>`
    ).join('');
    const more = matches.length > visibleResultCount
      ? '<button class="seo-search-load-more" type="button" data-search-load-more>Load more</button>' : '';
    resultsScroll.innerHTML = resultsMarkup + more;
    appendSuggestion(input.value.trim());
    repositionResults();
  }

  function navigateTo(site) {
    if (!site) return;
    const params = new URLSearchParams({
      site:site.site_id,
      lat:String(site.lat),
      lng:String(site.lon),
      z:'14'
    });
    window.location.href = `/?${params}`;
  }

  function setActive(nextIndex) {
    const visibleCount = Math.min(visibleResultCount, matches.length);
    if (!visibleCount) return;
    activeIndex = Math.max(0, Math.min(nextIndex, visibleCount - 1));
    resultsScroll.querySelectorAll('[data-match-index]').forEach(button => {
      const active = Number(button.dataset.matchIndex) === activeIndex;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    const activeResult = document.getElementById(`seo-site-search-result-${activeIndex}`);
    if (activeResult) {
      input.setAttribute('aria-activedescendant', activeResult.id);
      activeResult.scrollIntoView({ block:'nearest' });
    }
  }

  searchToggle?.addEventListener('click', () => {
    setOpen(true);
    input.focus({ preventScroll:true });
  });
  input.addEventListener('focus', () => setOpen(true));
  input.addEventListener('input', () => {
    clearButton?.classList.toggle('visible', Boolean(input.value));
    searchBox?.classList.toggle('has-query', Boolean(input.value.trim()));
    input.removeAttribute('aria-activedescendant');
    setOpen(true);
  });
  clearButton?.addEventListener('click', () => {
    input.value = '';
    clearButton.classList.remove('visible');
    searchBox?.classList.remove('has-query');
    input.removeAttribute('aria-activedescendant');
    renderResults();
    input.focus({ preventScroll:true });
  });
  // Keep pointer focus in the search UI when toggling filters; opening filters from elsewhere should not steal focus.
  let searchInputFocusedBeforeFilterPointer = false;
  filterToggle?.addEventListener('mousedown', event => {
    if (event.button === 0) {
      searchInputFocusedBeforeFilterPointer = document.activeElement === input || results.contains(document.activeElement);
      event.preventDefault();
    }
  });
  filterToggle?.addEventListener('click', event => {
    const preserveSearchFocus = event.detail > 0 && searchInputFocusedBeforeFilterPointer;
    searchInputFocusedBeforeFilterPointer = false;
    event.stopPropagation();
    filtersOpen = !filtersOpen;
    setOpen(true);
    if (preserveSearchFocus) input.focus({ preventScroll:true });
  });
  [countrySelect, difficultySelect, featureSelect].forEach(select => select?.addEventListener('change', () => {
    updateFilterOptions();
    updateFilterState();
    renderResults();
  }));
  filterClear?.addEventListener('click', () => {
    [countrySelect, difficultySelect, featureSelect].forEach(select => { if (select) select.value = ''; });
    updateFilterOptions();
    updateFilterState();
    renderResults();
  });

  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) setOpen(true);
      setActive(activeIndex < 0 ? 0 : activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(activeIndex < 0 ? 0 : activeIndex - 1);
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      navigateTo(matches[activeIndex]);
    } else if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      setOpen(false);
      input.removeAttribute('aria-activedescendant');
      input.blur();
    }
  });

  resultsScroll.addEventListener('click', event => {
    const more = event.target.closest('[data-search-load-more]');
    if (more) {
      visibleResultCount = Math.min(visibleResultCount + initialResultCount, matches.length);
      drawVisibleResults();
      return;
    }
    const result = event.target.closest('[data-match-index]');
    if (result) navigateTo(matches[Number(result.dataset.matchIndex)]);
  });

  document.addEventListener('pointerdown', event => {
    if (!slot.contains(event.target) && !results.contains(event.target) &&
        !event.target.closest('.dive-filter-options[data-filter-source="search"]')) setOpen(false);
  });
  window.addEventListener('resize', repositionResults);
  window.addEventListener('scroll', repositionResults, true);
  setOpen(false);
})();
