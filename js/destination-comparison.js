(async () => {
  'use strict';
  const api = window.DiveAtlasDestinationComparison;
  const select = document.getElementById('comparisonMonth');
  if (!select || !api) return;
  const copy = await window.DiveAtlasComparisonCopyReady;
  const service = api.createBrowserService(window);
  const results = new Map();
  const photos = JSON.parse(document.getElementById('comparisonPhotos').textContent);
  const pickers = [document.getElementById('comparisonLeft'), document.getElementById('comparisonRight')];
  const searchPickers = [];
  const selectionStatus = document.getElementById('comparisonSelectionStatus');
  let catalog = [], destinations = [], initialized = false;
  const failures = new Set();
  const status = document.getElementById('comparisonStatus');
  const retry = document.getElementById('comparisonRetry');
  const metricsNode = document.getElementById('comparisonMetrics');
  const destinationsNode = document.getElementById('comparisonDestinations');
  let generation = 0;
  const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const preference = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; } };
  const locale = () => document.documentElement.lang || 'en';
  const t = (key, values = {}) => copy.text(locale(), key, values);
  let statusCopy = ['loadingIndex', {}], selectionCopy = null;
  const localizedValues = values => Object.fromEntries(Object.entries(values).map(([key,value]) => [key, typeof value === 'number' ? number(value,0) : value]));
  function setStatus(key, values = {}) { statusCopy = [key, values]; status.classList.toggle('sr-only', key === 'statusReady'); status.textContent = t(key, localizedValues(values)); }
  function setSelectionStatus(key, values = {}) { selectionCopy = key ? [key, values] : null; selectionStatus.textContent = key ? t(key, localizedValues(values)) : ''; }
  const number = (value, digits) => new Intl.NumberFormat(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  const monthName = month => new Intl.DateTimeFormat(locale(), { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2020, month - 1, 1)));
  const percent = (valid, total) => number(Math.round(100 * valid / total), 0) + '%';
  function units(key) {
    const feet = preference('diveatlas-length-unit', 'm') === 'ft';
    if (key === 'temperature' && preference('diveatlas-temperature-unit', 'C') === 'F') return { unit: '°F', convert: value => value * 9 / 5 + 32 };
    if (feet && ['clarity', 'waves'].includes(key)) return { unit: 'ft', convert: value => value * 3.28084 };
    return { unit: api.METRICS[key].unit, convert: value => value };
  }
  function valueRange(key, min, max) {
    if (min === null) return t('noData');
    const { unit, convert } = units(key), digits = api.METRICS[key].digits;
    const a = number(convert(min), digits), b = number(convert(max), digits);
    return `${a === b ? a : a + '–' + b} ${unit}`;
  }
  function renderDestinations() {
    if (destinations.length !== 2 || destinations.some(d => !d)) { destinationsNode.innerHTML = ''; document.getElementById('comparisonPhotoCredits').innerHTML = ''; return; }
    // Keep the complete image license attribution available in the shared notes.
    document.getElementById('comparisonPhotoCredits').innerHTML = destinations.map(destination => {
      const credit = (photos[destination.areaKey] || '').match(/<figcaption>([\s\S]*?)<\/figcaption>/)?.[1];
      return credit ? `<p><strong>${escape(destination.name)}</strong> · ${credit}</p>` : '';
    }).join('');
    destinationsNode.innerHTML = destinations.map((destination, index) => {
      const data = results.get(destination.id);
      const description = escape(t(destination.id === 'bali' ? 'baliDescription' : destination.id === 'komodo' ? 'komodoDescription' : 'genericDescription', {country: destination.country || t('unknownCountry')}));
      const title = `<h2 id="comparisonDestination${index}"><a href="${escape(destination.path)}">${escape(destination.name)}</a></h2>`;
      const photo = (photos[destination.areaKey] || '').replace(/<figcaption>[\s\S]*?<\/figcaption>/, '');
      const heading = photo ? photo.replace('</div></figure>', `${title}</div></figure>`) : title;
      return `<li data-destination="${escape(destination.id)}">${heading}<p class="lead">${description}</p><p class="destination-source" data-coverage="${escape(destination.id)}">${data ? `<strong>${t('records', {count:number(data.total, 0)})}</strong>` : failures.has(destination.id) ? t('unavailable') : t('loadingSites')}</p></li>`;
    }).join('');
  }
  function renderMetrics() {
    if (destinations.length !== 2 || destinations.some(d => !d)) { metricsNode.innerHTML = ''; return; }
    metricsNode.innerHTML = Object.entries(api.METRICS).map(([key]) => {
      const preferred = api.preferredRange(key, ...destinations.map(destination => results.get(destination.id)?.metrics[key]));
      return `<section class="detail-section"><h2 id="comparisonMetric-${key}">${t(key)}${['temperature', 'clarity', 'current', 'waves'].includes(key) ? `<span class="comparison-info"><button type="button" class="comparison-info-button" aria-label="${escape(t(key))}" aria-expanded="false" aria-controls="comparisonNote-${key}"><span class="note-icon" aria-hidden="true"></span></button><span class="comparison-metric-note" id="comparisonNote-${key}" hidden>${escape(t(key === 'current' ? 'currentMeasureNote' : key + 'Note'))}</span></span>` : ''}</h2><ul class="site-list">${destinations.map((destination, index) => {
      const data = results.get(destination.id), metric = data?.metrics[key];
      return `<li data-metric="${key}" data-destination="${escape(destination.id)}" aria-labelledby="comparisonDestination${index} comparisonMetric-${key}"><h2 data-value${index === preferred ? ` class="comparison-preferred" aria-label="${escape(t('preferredValue', {value:valueRange(key, metric.min, metric.max)}))}"` : ''}>${metric ? valueRange(key, metric.min, metric.max) : failures.has(destination.id) ? t('unavailable') : t('loading')}</h2><p class="destination-source" data-metric-coverage>${metric ? `${t('metricCoverage', {valid:number(metric.valid,0), total:number(metric.total,0), percent:percent(metric.valid,metric.total)})}` : failures.has(destination.id) ? t('retry') : t('queryAll')}</p></li>`;
    }).join('')}</ul></section>`;
    }).join('');
  }
  function updateMonthLabels() {
    [...select.options].forEach(option => { option.textContent = monthName(Number(option.value)); });
    select.dispatchEvent(new Event('diveatlas:wheel-labels-change'));
    const month = Number(select.value);
    // This editorial guidance was sourced for the Bali/Komodo pair only.
    // Other selections must not inherit its seasons or destination links.
    const hasPairGuidance = destinations.some(d => d?.id === 'bali') && destinations.some(d => d?.id === 'komodo');
    document.getElementById('comparisonPairGuidance').hidden = !hasPairGuidance;
    document.getElementById('comparisonGenericGuidance').hidden = hasPairGuidance;
    document.getElementById('comparisonMonthTitle').textContent = monthName(month);
    document.getElementById('comparisonSeason').textContent = t(hasPairGuidance ? (month >= 4 && month <= 10 ? 'seasonDry' : month === 11 ? 'seasonNov' : 'seasonWet') : 'seasonGeneric');
  }
  async function load(retryRequests = false) {
    if (!initialized) return;
    const selected = [...destinations];
    const token = ++generation, month = Number(select.value);
    if (selected.length !== 2 || selected.some(d => !d)) {
      results.clear(); failures.clear();
      renderDestinations(); renderMetrics(); updateMonthLabels();
      document.querySelector('.comparison-overview').hidden = true;
      metricsNode.setAttribute('aria-busy', 'false'); metricsNode.dataset.state = 'empty';
      retry.parentElement.hidden = true;
      setStatus('statusReady', {month:monthName(month)});
      const url = new URL(location.href);
      for (const [index, key] of ['left','right'].entries()) selected[index] ? url.searchParams.set(key, selected[index].id) : url.searchParams.delete(key);
      history.replaceState(null, '', url);
      return;
    }
    document.querySelector('.comparison-overview').hidden = false;
    results.clear();
    failures.clear();
    renderDestinations(); renderMetrics(); updateMonthLabels();
    metricsNode.setAttribute('aria-busy', 'true');
    metricsNode.dataset.state = 'loading';
    setStatus('queryAll');
    retry.parentElement.hidden = true;
    const response = await Promise.allSettled(selected.map(destination => service.query(destination.id, month, { retry: retryRequests })));
    // A slow earlier month must never repaint the newly selected month.
    if (token !== generation) return;
    response.forEach((result, i) => {
      const id = selected[i].id;
      if (result.status === 'fulfilled') results.set(id, result.value);
      else failures.add(id);
    });
    renderDestinations(); renderMetrics();
    metricsNode.setAttribute('aria-busy', 'false');
    metricsNode.dataset.state = response.every(r => r.status === 'fulfilled') ? 'ready' : 'failed';
    const failedDestinations = response.filter(r => r.status === 'rejected').length;
    const failedRequests = [...results.values()].reduce((total, result) => total + Object.values(result.metrics).reduce((n, metric) => n + metric.failed, 0), 0);
    retry.parentElement.hidden = failedDestinations === 0 && failedRequests === 0;
    setStatus(failedDestinations ? 'statusFailed' : failedRequests ? 'statusRequests' : 'statusReady', {count:failedRequests,month:monthName(month)});
    // Share the month through the normal page URL; no separate share window.
    const url = new URL(location.href); url.searchParams.set('month', String(month));
    url.searchParams.set('left', selected[0].id); url.searchParams.set('right', selected[1].id);
    history.replaceState(null, '', url);
  }
  function updateTitle() {
    const title = destinations.length === 2 && destinations.every(Boolean)
      ? t('title', {left:destinations[0].name, right:destinations[1].name}) : t('menu');
    document.getElementById('comparisonTitle').textContent = title;
    const tabTitle = destinations.length === 2 && destinations.every(Boolean)
      ? t('tabTitle', {left:destinations[0].name, right:destinations[1].name}) : title;
    document.title = `${tabTitle} | DiveAtlas`;
  }
  function refreshPreferences() {
    const byId = new Map(catalog.map(destination => [destination.id, destination]));
    pickers.forEach((picker, index) => {
      const placeholder = picker.querySelector('option[value=""]');
      if (placeholder) placeholder.textContent = t(index ? 'second' : 'first');
      for (const option of picker.options) {
        const destination = byId.get(option.value);
        if (destination) option.textContent = `${destination.name} · ${destination.country || t('unknownCountry')} (${number(destination.sites.length,0)})`;
      }
      for (const group of picker.querySelectorAll('optgroup')) {
        const destination = byId.get(group.querySelector('option')?.value);
        if (destination) group.label = destination.country || t('unknownCountry');
      }
    });
    document.querySelectorAll('[data-comparison-text]').forEach(node => { node.textContent = t(node.dataset.comparisonText); });
    document.querySelectorAll('[data-comparison-aria]').forEach(node => { node.setAttribute('aria-label', t(node.dataset.comparisonAria)); });
    updateMonthLabels(); renderDestinations(); renderMetrics();
    updateTitle();
    status.textContent = t(statusCopy[0], localizedValues({...statusCopy[1],month:monthName(Number(select.value))}));
    status.classList.toggle('sr-only', statusCopy[0] === 'statusReady');
    if (selectionCopy) selectionStatus.textContent = t(selectionCopy[0],localizedValues(selectionCopy[1]));
    searchPickers.forEach((picker, index) => { picker.input.placeholder = t(index ? 'second' : 'first'); picker.sync(); picker.close(); });
  }
  function closeMetricNotes() {
    metricsNode.querySelectorAll('.comparison-info-button[aria-expanded="true"]').forEach(button => {
      button.setAttribute('aria-expanded', 'false');
      document.getElementById(button.getAttribute('aria-controls')).hidden = true;
    });
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('.comparison-info-button');
    if (button) {
      const note = document.getElementById(button.getAttribute('aria-controls'));
      const open = button.getAttribute('aria-expanded') !== 'true';
      const viewportWidth = document.documentElement.clientWidth;
      closeMetricNotes();
      button.setAttribute('aria-expanded', String(open));
      note.hidden = !open;
      if (open) {
        note.classList.remove('comparison-metric-note--above');
        note.style.left = '';
        let bounds = note.getBoundingClientRect();
        if (bounds.bottom > window.innerHeight - 8 && button.getBoundingClientRect().top >= bounds.height + 13) {
          note.classList.add('comparison-metric-note--above');
          bounds = note.getBoundingClientRect();
        }
        const shift = Math.min(0, viewportWidth - 8 - bounds.right) + Math.max(0, 8 - bounds.left);
        if (shift) note.style.left = `${shift}px`;
      }
    } else if (!event.target.closest('.comparison-info')) closeMetricNotes();
    if (event.target.closest('[data-length-unit], [data-temperature-unit]')) refreshPreferences();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && metricsNode.querySelector('.comparison-info-button[aria-expanded="true"]')) {
      const button = metricsNode.querySelector('.comparison-info-button[aria-expanded="true"]');
      closeMetricNotes();
      button.focus();
    }
  });
  window.addEventListener('storage', refreshPreferences);
  new MutationObserver(refreshPreferences).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  retry.addEventListener('click', () => initialized ? load(true) : initialize());
  select.addEventListener('change', () => load());
  const params = new URLSearchParams(location.search);
  const requestedMonth = Number(params.get('month'));
  if (Number.isInteger(requestedMonth) && requestedMonth >= 1 && requestedMonth <= 12) {
    select.value = String(requestedMonth);
    select.dispatchEvent(new Event('change'));
  }
  function syncSelection() {
    destinations = pickers.map(picker => catalog.find(d => d.id === picker.value));
    document.getElementById('comparisonSwap').disabled = destinations.some(d => !d);
    pickers.forEach((picker, slot) => {
      for (const option of picker.options) option.disabled = !option.value || option.value === pickers[1 - slot].value;
    });
    searchPickers.forEach((picker, index) => { picker.input.placeholder = t(index ? 'second' : 'first'); picker.sync(); });
    updateTitle();
  }
  pickers.forEach((picker, slot) => picker.addEventListener('change', () => {
    const previous = destinations[slot]?.id || '';
    if (!catalog.some(d => d.id === picker.value)) { picker.value = previous; return; }
    if (picker.value === pickers[1 - slot].value) {
      pickers[1 - slot].value = previous;
      setSelectionStatus('swapped');
    } else setSelectionStatus(null);
    syncSelection(); load();
  }));
  document.getElementById('comparisonSwap').addEventListener('click', () => {
    if (!initialized || destinations.some(d => !d)) return;
    const left = pickers[0].value;
    pickers[0].value = pickers[1].value;
    pickers[1].value = left;
    syncSelection();
    setSelectionStatus('swapped');
    load();
  });
  async function initialize() {
    try {
      const destinationPaths = JSON.parse(document.getElementById('comparisonDestinationPaths').textContent);
      // Only generated, existing pages override the public area-browser fallback.
      catalog = (await service.loadDestinations()).map(destination => ({...destination, path:destinationPaths[destination.areaKey] || destination.path}));
      if (catalog.length < 2) throw new Error('At least two destinations are required');
      const groups = new Map();
      for (const destination of catalog) {
        const country = destination.country || t('unknownCountry');
        if (!groups.has(country)) groups.set(country, []);
        groups.get(country).push(destination);
      }
      const options = [...groups].map(([country, values]) => `<optgroup label="${escape(country)}">${values.map(d => `<option value="${escape(d.id)}">${escape(d.name)} · ${escape(country)} (${d.sites.length})</option>`).join('')}</optgroup>`).join('');
      pickers.forEach((picker, index) => { picker.innerHTML = `<option value="" disabled>${escape(t(index ? 'second' : 'first'))}</option>` + options; picker.disabled = false; });
      const left = catalog.find(d => d.id === params.get('left'));
      const right = catalog.find(d => d.id === params.get('right') && d.id !== left?.id);
      pickers[0].value = left?.id || ''; pickers[1].value = right?.id || '';
      initialized = true;
      document.getElementById('comparisonSwap').disabled = false;
      syncSelection();
      if (!searchPickers.length) pickers.forEach(picker => {
        const search = window.DiveAtlasSearchResultsMenu.createFilterPicker(picker, {
          id: picker.id + 'Search', labelledBy: picker.id + 'Label', hideSelect: true,
          getPeers: () => searchPickers, getClearLabel: () => t('clear'), getEmptyLabel: () => t('empty'),
          getLanguage: locale, onDraft: () => {}, clearSelection: false
        });
        // A dismissed draft must not disagree with the committed destination
        // whose environmental data is still shown below the control.
        search.input.addEventListener('blur', () => {
          search.input.value = picker.value ? picker.selectedOptions[0]?.textContent || '' : '';
          search.sync();
        });
        searchPickers.push(search);
      });
      searchPickers.forEach(picker => picker.sync());
      setSelectionStatus('selection', {count:catalog.length});
      load();
    } catch (_) {
      setStatus('loadingIndexFailed');
      metricsNode.dataset.state = 'failed';
      metricsNode.setAttribute('aria-busy', 'false');
      retry.parentElement.hidden = false;
    }
  }
  refreshPreferences();
  initialize();
})();
