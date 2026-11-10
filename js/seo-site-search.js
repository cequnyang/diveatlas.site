(async () => {
  'use strict';
  if (!window.DiveAtlasHeader) await import('/js/site-header.js?v=5');
  window.DiveAtlasHeader.mount();

  const slot = document.getElementById('seoSiteSearchSlot');
  const section = document.getElementById('seoSiteSearchSection');
  const input = document.getElementById('seoSiteSearchInput');
  const searchBox = section?.querySelector('.dive-search-box');
  const searchToggle = document.getElementById('seoSiteSearchToggle');
  const clearButton = document.getElementById('seoSiteSearchClear');
  const filterToggle = document.getElementById('seoSiteSearchFilterToggle');
  const results = document.getElementById('seoSiteSearchResults');
  const resultsHandle = document.getElementById('seoSiteSearchResultsHandle');
  const resultsScroll = document.getElementById('seoSiteSearchResultsScroll');
  const filterControls = document.getElementById('seoSiteSearchFilterControls');
  const countrySelect = document.getElementById('seoSiteSearchCountry');
  const difficultySelect = document.getElementById('seoSiteSearchDifficulty');
  const featureSelect = document.getElementById('seoSiteSearchFeature');
  const filterClear = document.getElementById('seoSiteSearchFilterClear');
  const mobileLayoutQuery = window.matchMedia('(max-width: 720px)');
  if (!slot || !section || !searchBox || !input || !results || !resultsScroll || !filterControls) return;
  if (!window.DiveAtlasAreaSearch) await import('/js/area-search.js?v=1');
  if (!window.DiveAtlasSearchResultsMenu) await import('/js/search-results-menu.js?v=1');
  let areas = [];
  const areaText = () => window.DiveAtlasAreaSearch.text(document.documentElement.lang.split('-')[0]);
  const groupedText = () => window.DiveAtlasAreaSearch.resultsText(document.documentElement.lang.split('-')[0]);
  const menu = window.DiveAtlasSearchResultsMenu.create({
    surface:results, scroll:resultsScroll, getInput:() => input, filterToggle, slot,
    onSelect:index => navigateTo(matches[index]),
    onLoadMore:() => menu.loadMore(() => {
      visibleResultCount = Math.min(visibleResultCount + initialResultCount,matches.length);
      drawVisibleResults();
    })
  });
  menu.bindPullPagination(() => visibleResultCount < matches.length);
  function updateModes() {
    menu.updateModes({grouped:true,labels:areaText().slice(0,2)});
    resultsScroll.setAttribute('aria-label', `${groupedText().destinations} / ${groupedText().sites}`);
  }

  // The header uses backdrop-filter, which would otherwise make fixed results
  // position relative to the header instead of the viewport.
  document.body.append(results);

  const normalize = value => String(value || '').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
  const valuesFor = (site, key) => Array.isArray(site[key]) ? site[key].filter(Boolean) : [];
  let searchSites = [];
  let catalogReady = false;
  const initialResultCount = window.DiveAtlasSearchResultsMenu.pageSize;
  let visibleResultCount = initialResultCount;
  let matches = [];
  let activeIndex = -1;
  let renderedState = '';
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
    updateModes();
    if (isOpen) renderResults();
  });

  // Detail pages host the same contribution flow; other browse pages keep the map fallback.
  suggestionButton.addEventListener('click', () => {
    if (window.DiveAtlasContributions) {
      setOpen(false);
      window.DiveAtlasContributions.openSuggestion(input.value.trim(), input);
      return;
    }
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
    return window.DiveAtlasSearchResultsMenu.createFilterPicker(select, {
      id:`${select.id}Picker`, labelledBy:select.getAttribute('aria-labelledby'), hideSelect:true,
      getPeers:() => filterPickers, getClearLabel:() => filterClear.textContent || 'Clear All',
      getLanguage:() => document.documentElement.lang,
      onDraft:() => renderResults()
    });
  }

  filterPickers = [countrySelect, difficultySelect, featureSelect].filter(Boolean).map(createFilterPicker);

  function setCatalog(rawSites) {
    catalogReady = true;
    searchSites = Array.isArray(rawSites) ? rawSites.map(site => {
      const features = valuesFor(site, 'feature_values').length
        ? valuesFor(site, 'feature_values') : valuesFor(site, 'features');
      const name = String(site.name || '');
      const location = [site.region, site.country].filter(Boolean).join(' ');
      return {
        ...site,
        features,
        normalizedName:normalize(name),
        normalizedSearch:normalize([name, site.aliases, location, site.difficulty, ...features].join(' '))
      };
    }) : [];
    // Adapt the shared catalog to the map's geographic grouping contract.
    // Labels and extents come from mapped sites, rather than inferred borders.
    areas = window.DiveAtlasAreaSearch.build(searchSites.map(site => {
      const row = [];
      row[1] = site.lat; row[2] = site.lon; row[9] = site.country;
      row[10] = site.region; row[12] = site.site_id;
      return row;
    }), {});
    updateFilterOptions();
    if (isOpen) renderResults();
  }

  if (Array.isArray(window.DIVE_ATLAS_SEO_SEARCH_CATALOG)) {
    setCatalog(window.DIVE_ATLAS_SEO_SEARCH_CATALOG);
  }
  window.addEventListener('diveatlas:seo-search-catalog-ready', event => setCatalog(event.detail?.sites));
  window.addEventListener('diveatlas:seo-search-catalog-error', () => { if (isOpen) renderResults(); });

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
    if (excludedFilter !== 'difficulty' && filters.difficulty && !String(site.difficulty || '').split(/\s*(?:\||,|;|\bto\b)\s*/i).some(level => normalize(level) === filters.difficulty)) return false;
    if (excludedFilter !== 'feature' && filters.feature && !site.features.some(feature => normalize(feature) === filters.feature)) return false;
    return true;
  }

  function updateFilterOptions() {
    fillSelect(countrySelect, 'Any country', optionValues('country', 'country'));
    fillSelect(difficultySelect, 'Any difficulty', optionValues('difficulty', 'difficulty', site => String(site.difficulty || '').split(/\s*(?:\||,|;|\bto\b)\s*/i).filter(Boolean)));
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
    menu.syncFilters({open:filtersOpen, active:hasActiveFilters(), pickers:filterPickers});
  }

  function repositionResults() {
    if (!isOpen || !results.classList.contains('visible')) return;
    menu.position({anchor:searchBox,filtersOpen,focused:slot.contains(document.activeElement) || results.contains(document.activeElement) || slot.classList.contains('is-search-focus-retained')});
  }

  function setOpen(next) {
    menuMotion.cancel();
    isOpen = Boolean(next);
    if (!isOpen) filtersOpen = false;
    input.setAttribute('aria-expanded', String(isOpen));
    searchToggle?.setAttribute('aria-expanded', String(isOpen));
    results.classList.toggle('visible', isOpen);
    if (!isOpen) {
      results.classList.remove('mobile-vertical-dragging', 'mobile-search-dismissing', 'mobile-search-restoring');
      results.style.removeProperty('height');
      results.style.removeProperty('--mobile-panel-drag-y');
    }
    updateSearchFocusLayout();
    updateFilterState();
    if (isOpen) renderResults();
  }


  const menuMotion = menu.bindMobileHandle({resultsHandle,onDismiss:() => setOpen(false),returnFocus:searchToggle});

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
    updateModes();
    const state = JSON.stringify([input.value.trim(),activeFilters()]);
    const preserve = state === renderedState;
    const selected = preserve ? matches[activeIndex] : null;
    const identity = item => item && `${item.key || item.site_id || ''}:${item.name}`;
    renderedState = state;
    function commitMatches(next) {
      matches = next;
      activeIndex = selected ? matches.findIndex(item => identity(item) === identity(selected)) : -1;
      if (!preserve) visibleResultCount = initialResultCount;
      // The active record may move past the current page after a catalog refresh.
      // Keep its visible option aligned with the record Enter will select.
      visibleResultCount = Math.max(visibleResultCount, activeIndex + 1);
      if (activeIndex < 0) input.removeAttribute('aria-activedescendant');
    }
    if (!catalogReady) {
      commitMatches([]);
      const failed = window.DIVE_ATLAS_SEO_SEARCH_STATUS === 'error';
      menu.empty(failed ? 'Destination and dive-site search is unavailable right now.' : groupedText().loading, !failed);
      repositionResults();
      return;
    }

    const query = input.value.trim();
    const filtersApplied = hasActiveFilters();
    const filters = activeFilters();
    const destinations = window.DiveAtlasAreaSearch.destinations(areas,query,
      index => siteMatchesFilters(searchSites[index],filters));
    commitMatches([...destinations, ...findMatches(query)]);

    if (!query && !filtersApplied) {
      menu.empty(groupedText().prompt);
      repositionResults();
      return;
    }
    if (!matches.length) {
      menu.empty(groupedText().empty);
      if (query) appendSuggestion(query);
      repositionResults();
      return;
    }
    drawVisibleResults();
  }

  function drawVisibleResults() {
    menu.render({query:input.value.trim(),total:matches.length,activeIndex,moreLabel:'Load more',
      items:matches.slice(0,visibleResultCount).map(site => {
        const text = groupedText();
        return site.siteIndices
          ? {name:text.explore(site.name),group:text.destinations,kind:'destination',meta:window.DiveAtlasAreaSearch.context(site,document.documentElement.lang.split('-')[0]),count:text.count(site.siteIndices.length),attributes:{'area-key':site.key}}
          : {name:site.name,group:text.sites,kind:'site',meta:siteMeta(site),attributes:{'site-id':site.site_id}};
      })});
    appendSuggestion(input.value.trim());
    repositionResults();
  }

  function navigateTo(site) {
    if (!site) return;
    if (site.siteIndices) {
      const bounds = window.DiveAtlasAreaSearch.bounds(site.points);
      if (!bounds) return;
      const [[south, west], [north, east]] = bounds;
      const span = Math.max(east - west, (north - south) * 2, 0.5);
      const params = new URLSearchParams({lat:String((south + north) / 2), lng:String(((west + east) / 2 + 540) % 360 - 180), z:String(Math.max(1, Math.min(9, Math.floor(Math.log2(360 / span)))))});
      window.location.href = `/?${params}`;
      return;
    }
    // Detail-page search continues browsing records; directory/document search
    // retains its existing map destination. The shared menu never navigates.
    if (document.querySelector('main.detail-page')) {
      window.location.href = `/dive-site.html?id=${encodeURIComponent(site.canonical_id || site.site_id)}`;
      return;
    }
    const params = new URLSearchParams({
      site:site.site_id,
      lat:String(site.lat),
      lng:String(site.lon),
      z:'14'
    });
    window.location.href = `/?${params}`;
  }

  function setActive(nextIndex) { activeIndex = menu.setActive(nextIndex); }

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

  input.addEventListener('keydown', event => menu.keydown(event, {
    activeIndex,visibleCount:Math.min(visibleResultCount,matches.length),total:matches.length,setActive,
    open:() => { if (!isOpen) setOpen(true); },
    dismiss:() => { setOpen(false); input.removeAttribute('aria-activedescendant'); input.blur(); }
  }));

  document.addEventListener('pointerdown', event => {
    if (!slot.contains(event.target) && !results.contains(event.target) &&
        !event.target.closest('.dive-filter-options[data-filter-source="search"]')) setOpen(false);
  });
  window.addEventListener('resize', repositionResults);
  window.addEventListener('scroll', repositionResults, true);
  // The input is usable while the shared module imports. Recover any focus or
  // typing that arrived before its listeners were installed.
  clearButton?.classList.toggle('visible', Boolean(input.value));
  searchBox.classList.toggle('has-query', Boolean(input.value.trim()));
  setOpen(document.activeElement === input);
})();
