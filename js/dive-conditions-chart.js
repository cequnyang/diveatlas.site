(() => {
  const page = document.querySelector('main.detail-page');
  const details = page?.querySelector('.facts-section');
  if (!page || !details) return;

  const localizedMonths = () => Array.from({ length:12 }, (_, index) =>
    new Intl.DateTimeFormat(document.documentElement.lang || 'en', { month:'short', timeZone:'UTC' })
      .format(new Date(Date.UTC(2020, index, 1))));
  let MONTHS = localizedMonths();
  const translate = value => window.DiveAtlasSiteDetailI18n?.translate(value) || value;
  const SERIES = Object.freeze([
    { key:'clarity', label:'Water clarity', tooltipLabel:'Clarity', unit:'m', kind:'line', color:'rgb(230, 126, 34)' },
    { key:'temperature', label:'Water temperature · 5 m', tooltipLabel:'Temp', unit:'°C', kind:'line', color:'rgb(180, 55, 65)' },
    { key:'current', label:'Current speed · 10 m', tooltipLabel:'Current', unit:'m/s', kind:'line', color:'rgb(53, 88, 166)' },
    { key:'waves', label:'Wave height', tooltipLabel:'Waves', unit:'m', kind:'line', color:'rgb(0, 158, 115)' }
  ]);
  const OVERALL_SCORE = Object.freeze({ key:'overallScore', label:'Overall condition score', tooltipLabel:'Score', unit:'0–100', kind:'bar', color:'rgb(126, 87, 194)' });
  const AXES = Object.freeze([
    { key:'clarity-temperature', series:[SERIES[0], SERIES[1]], side:'left', column:0 },
    { key:'current-waves', series:[SERIES[2], SERIES[3]], side:'right', column:0 },
    { key:OVERALL_SCORE.key, series:[OVERALL_SCORE], side:'left', column:1 }
  ]);
  const chart = document.createElement('section');
  chart.className = 'detail-section monthly-conditions-section';
  chart.setAttribute('aria-labelledby', 'monthly-conditions-heading');
  chart.innerHTML = `
    <h2 id="monthly-conditions-heading">When to dive</h2>
    <p class="monthly-conditions-status" role="status" aria-live="polite">Loading monthly estimates…</p>
    <div class="monthly-best-window" hidden>
      <p><span class="monthly-best-window-dot" aria-hidden="true"></span><strong class="monthly-best-window-label"></strong> <span class="monthly-best-window-months"></span></p>
    </div>
    <div class="monthly-conditions-chart" hidden></div>
    <div class="monthly-conditions-legend" aria-label="Chart legend"></div>`;
  details.after(chart);

  const status = chart.querySelector('.monthly-conditions-status');
  const plot = chart.querySelector('.monthly-conditions-chart');
  let started = false;
  let latestResults = null;
  // Page-local only: resizing and language changes preserve choices; reload resets them.
  const hiddenSeries = new Set();
  chart.querySelector('.monthly-conditions-legend').addEventListener('click', event => {
    const button = event.target.closest('button[data-series]');
    if (!button) return;
    const key = button.dataset.series;
    hiddenSeries.has(key) ? hiddenSeries.delete(key) : hiddenSeries.add(key);
    if (latestResults) render(latestResults);
    chart.querySelector(`button[data-series="${key}"]`)?.focus({ preventScroll:true });
  });

  function readCoordinates() {
    const schema = document.querySelector('script[type="application/ld+json"]');
    try {
      const data = JSON.parse(schema?.textContent || 'null');
      const geo = Array.isArray(data) ? data.find(item => item?.geo)?.geo : data?.geo;
      const lat = Number(geo?.latitude), lng = Number(geo?.longitude);
      return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    } catch (_) { return null; }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.append(script);
    });
  }

  async function loadModules() {
    const modules = [
      ['/js/current-math.js', 'DiveAtlasCurrentMath'],
      ['/js/current-tile-cache.js', 'DiveAtlasCurrentTileCache'],
      ['/js/regional-currents.js', 'DiveAtlasRegionalCurrents'],
      ['/js/waves-view.js', 'DiveAtlasWavesView'],
      ['/js/temperature-query.js', 'DiveAtlasTemperatureQuery'],
      ['/js/water-clarity-query.js', 'DiveAtlasWaterClarityQuery'],
      ['/js/dive-conditions-model.js?v=3', 'DiveAtlasConditionsModel'],
      ['/js/dive-conditions-service.js', 'DiveAtlasConditionsService']
    ];
    for (const [src, globalName] of modules) {
      if (!window[globalName]) await loadScript(src);
      if (!window[globalName]) throw new Error(`${globalName} did not initialize`);
    }
  }

  function formatValue(value, unit, digits = 1) {
    if (value == null || !Number.isFinite(Number(value))) return 'No data';
    const number = Number(value);
    const formatted = Number.isInteger(number) ? String(number) : number.toFixed(digits).replace(/\.0$/, '');
    return `${formatted} ${unit}`;
  }

  function appendSvg(parent, name, attributes = {}) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    parent.append(element);
    return element;
  }

  function niceCeiling(value) {
    if (!(value > 0)) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const fraction = value / magnitude;
    const nice = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(candidate => candidate >= fraction);
    return (nice || 10) * magnitude;
  }

  function axisFor(axis, results) {
    const values = results.flatMap(result => axis.series
      .filter(series => series !== OVERALL_SCORE)
      .map(series => Number(result.metrics[series.key].value)))
      .filter(value => Number.isFinite(value) && value >= 0);
    const maxValue = values.length ? Math.max(...values) : 1;
    return { max:niceCeiling(maxValue * 1.08) };
  }

  function axisMaxFor(axis, results) {
    return axis.series.includes(OVERALL_SCORE) ? 100 : axisFor(axis, results).max;
  }

  function axisLabel(value, max) {
    if (max < 1) return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    if (max < 10 && !Number.isInteger(value)) return value.toFixed(1).replace(/\.0$/, '');
    return String(Math.round(value * 100) / 100);
  }

  function monthReadings(result) {
    const readings = SERIES.map(series => `${translate(series.label)}: ${formatValue(result.metrics[series.key].value, series.unit)}`);
    readings.push(`${translate(OVERALL_SCORE.tooltipLabel)}: ${result.overallScore == null ? translate('No data') : `${result.overallScore}/100`}`);
    return readings.join('; ');
  }

  function render(results) {
    latestResults = results;
    MONTHS = localizedMonths();
    const summary = chart.querySelector('.monthly-best-window');
    const best = window.DiveAtlasConditionsModel?.bestOverallWindows(results);
    summary.hidden = !best;
    if (best) {
      summary.querySelector('.monthly-best-window-label').textContent = `${translate('Best overall window')}:`;
      summary.querySelector('.monthly-best-window-months').textContent = best.allYear ? translate('All year') :
        best.windows.map(({ start, end }) => start === end ? MONTHS[start - 1] : `${MONTHS[start - 1]}–${MONTHS[end - 1]}`).join(' · ');
    }
    const available = results.reduce((count, result) => count + SERIES.filter(series =>
      result.metrics[series.key].value != null && Number.isFinite(Number(result.metrics[series.key].value))).length, 0);
    if (!available) {
      status.textContent = 'Monthly estimates are not available for this location.';
      chart.classList.add('is-unavailable');
      return;
    }
    status.textContent = '';

    chart.querySelector('.monthly-conditions-legend').innerHTML = [...SERIES, OVERALL_SCORE].map(series =>
      `<button type="button" class="monthly-conditions-legend-item" data-series="${series.key}" aria-pressed="${!hiddenSeries.has(series.key)}" data-kind="${series.kind}"><i style="--series-color:${series.color}" aria-hidden="true"></i>${translate(series.label)} (${series.unit})</button>`).join('');

    // Keep the outside tick columns close to the canvas edge so the plot can use more width.
    const mobile = window.matchMedia('(max-width: 720px)').matches;
    // Match mobile SVG units to screen pixels so text does not shrink with the desktop canvas.
    const width = mobile ? Math.max(280, plot.getBoundingClientRect().width || 320) : 840;
    const height = mobile ? 221 : 237.5;
    const left = mobile ? 58 : 82, right = mobile ? 36 : 40, top = 11, bottom = mobile ? 18 : 29;
    const innerWidth = width - left - right, innerHeight = height - top - bottom;
    const axisLabelGap = mobile ? 8 : 12;
    const barWidth = Math.min(42, innerWidth / 14);
    // Keep the first and last bars inside the plot instead of letting them cover the outer tick labels.
    const dataLeft = left + barWidth / 2, dataRight = width - right - barWidth / 2;
    const dataWidth = dataRight - dataLeft;
    const xAt = month => dataLeft + ((month - 1) / 11) * dataWidth;
    const axisBySeries = new Map(AXES.flatMap(axis => axis.series.map(series => [series.key, axis])));
    const axes = new Map(AXES.map(axis => [axis.key, { max:axisMaxFor(axis, results) }]));
    const yAt = (series, value) => {
      const axis = axisBySeries.get(series.key);
      return top + innerHeight - (Number(value) / axes.get(axis.key).max) * innerHeight;
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', 'Monthly water clarity and water temperature share a vertical scale; current speed and wave height share another. Overall dive-condition score is shown as bars on its own scale. Hover or focus a mark for all values in that month.');
    const defs = appendSvg(svg, 'defs');
    for (const axis of AXES.filter(item => item.series.length === 2)) {
      const gradient = appendSvg(defs, 'linearGradient', {
        id:`${axis.key}-axis-gradient`, x1:'0%', y1:'0%', x2:'100%', y2:'100%'
      });
      appendSvg(gradient, 'stop', { offset:'0%', 'stop-color':axis.series[0].color });
      appendSvg(gradient, 'stop', { offset:'49%', 'stop-color':axis.series[0].color });
      appendSvg(gradient, 'stop', { offset:'51%', 'stop-color':axis.series[1].color });
      appendSvg(gradient, 'stop', { offset:'100%', 'stop-color':axis.series[1].color });
    }

    // Pair the measures with similar numeric ranges to reduce axis clutter; tooltips retain each
    // measurement's original unit so the shared scale does not erase the underlying readings.
    for (let tick = 0; tick <= 4; tick += 1) {
      const ratio = tick / 4;
      const y = top + innerHeight - ratio * innerHeight;
      appendSvg(svg, 'line', { x1:left, x2:width - right, y1:y, y2:y, class:'monthly-conditions-gridline' });
      AXES.forEach(({ key, series, side, column }) => {
        const max = axes.get(key).max;
        const value = max * ratio;
        const onLeft = side === 'left';
        if (series.length === 2) {
          const label = appendSvg(svg, 'text', {
            x:onLeft ? left - axisLabelGap : width - right + axisLabelGap, y:y + 4,
            'text-anchor':onLeft ? 'end' : 'start',
            class:'monthly-conditions-axis-label', style:`fill:url(#${key}-axis-gradient)`
          });
          label.textContent = axisLabel(value, max);
          label.setAttribute('aria-hidden', 'true');
          return;
        }
        series.forEach((item, seriesIndex) => {
          const seriesOffset = seriesIndex * 28;
          const axisColumnGap = mobile ? 28 : 38;
          const x = onLeft
            ? left - axisLabelGap - column * axisColumnGap - seriesOffset
            : width - right + axisLabelGap + column * axisColumnGap + seriesOffset;
          const label = appendSvg(svg, 'text', {
            x, y:y + 4, 'text-anchor':onLeft ? 'end' : 'start',
            class:'monthly-conditions-axis-label', style:`color:${item.color}`
          });
          label.textContent = axisLabel(value, max);
          label.setAttribute('aria-hidden', 'true');
        });
      });
    }

    const markTargets = [];
    for (const result of results) {
      const score = result.overallScore;
      if (hiddenSeries.has(OVERALL_SCORE.key)) continue;
      if (score == null || !Number.isFinite(Number(score))) continue;
      const x = xAt(result.month), y = yAt(OVERALL_SCORE, score);
      const rect = appendSvg(svg, 'rect', { x:x - barWidth / 2, y, width:barWidth, height:top + innerHeight - y,
        rx:4, fill:OVERALL_SCORE.color, class:`monthly-conditions-bar${best && score >= best.threshold ? ' is-best-window' : ''}` });
      if (best && score >= best.threshold) {
        // SVG strokes straddle the edge; clip the outer half to preserve bar geometry.
        const clipId = `monthly-best-bar-${result.month}`;
        const clip = appendSvg(defs, 'clipPath', { id:clipId, clipPathUnits:'userSpaceOnUse' });
        appendSvg(clip, 'rect', { x:x - barWidth / 2, y, width:barWidth,
          height:top + innerHeight - y, rx:4 });
        rect.setAttribute('clip-path', `url(#${clipId})`);
      }
      rect.dataset.month = String(result.month);
      rect.setAttribute('aria-label', `${MONTHS[result.month - 1]}. ${monthReadings(result)}`);
      rect.setAttribute('tabindex', '0');
      markTargets.push({ element:rect, result, x, y });
    }

    for (const series of SERIES) {
      if (hiddenSeries.has(series.key)) continue;
      let segment = [];
      const segments = [];
      for (const result of results) {
        const metric = result.metrics[series.key];
        if (metric.value == null || !Number.isFinite(Number(metric.value))) {
          if (segment.length) segments.push(segment);
          segment = [];
        } else segment.push({ result, metric, x:xAt(result.month), y:yAt(series, metric.value) });
      }
      if (segment.length) segments.push(segment);
      for (const points of segments) {
        if (points.length > 1) {
          const path = points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
          appendSvg(svg, 'path', { d:path, fill:'none', stroke:series.color, 'stroke-width':3.5,
            'stroke-linecap':'round', 'stroke-linejoin':'round', class:'monthly-conditions-line' });
        }
        for (const point of points) {
          const circle = appendSvg(svg, 'circle', { cx:point.x, cy:point.y, r:5.5, fill:series.color,
            stroke:'var(--panel-solid)', 'stroke-width':2, class:'monthly-conditions-point' });
          circle.dataset.month = String(point.result.month);
          circle.setAttribute('aria-label', `${MONTHS[point.result.month - 1]}. ${monthReadings(point.result)}`);
          circle.setAttribute('tabindex', '0');
          markTargets.push({ element:circle, result:point.result, x:point.x, y:point.y });
        }
      }
    }

    for (let month = 1; month <= 12; month += 1) {
      const label = appendSvg(svg, 'text', { x:xAt(month), y:height - 9, 'text-anchor':'middle', class:'monthly-conditions-month' });
      label.textContent = MONTHS[month - 1];
      if (mobile && dataWidth / 11 < 24) {
        label.textContent = new Intl.DateTimeFormat(document.documentElement.lang || 'en', {
          month:'narrow', timeZone:'UTC'
        }).format(new Date(Date.UTC(2020, month - 1, 1)));
        label.setAttribute('aria-label', MONTHS[month - 1]);
      }
    }

    const tooltip = appendSvg(svg, 'g', { class:'monthly-conditions-tooltip', 'aria-hidden':'true', 'pointer-events':'none' });
    const visibleSeries = [...SERIES, OVERALL_SCORE].filter(series => !hiddenSeries.has(series.key));
    const tooltipWidth = Math.min(286, width - 16), tooltipHeight = 42 + visibleSeries.length * 20;
    appendSvg(tooltip, 'rect', { x:0, y:0, width:tooltipWidth, height:tooltipHeight, rx:9,
      fill:'#20252d', 'fill-opacity':'.94' });
    const tooltipTitle = appendSvg(tooltip, 'text', { x:14, y:23, class:'monthly-conditions-tooltip-title' });
    const tooltipRows = visibleSeries.map((series, index) => {
      appendSvg(tooltip, 'rect', { x:14, y:35 + index * 20, width:13, height:13, rx:2, fill:series.color });
      return appendSvg(tooltip, 'text', { x:36, y:47 + index * 20, class:'monthly-conditions-tooltip-row' });
    });

    function hideTooltip() {
      tooltip.classList.remove('is-visible');
      tooltip.setAttribute('aria-hidden', 'true');
    }
    function showTooltip(result, targetX, targetY, pointerEvent) {
      tooltipTitle.textContent = MONTHS[result.month - 1];
      if (!visibleSeries.length) return;
      visibleSeries.forEach((series, index) => {
        const value = series === OVERALL_SCORE
          ? (result.overallScore == null ? translate('No data') : `${result.overallScore}/100`)
          : formatValue(result.metrics[series.key].value, series.unit);
        tooltipRows[index].textContent = `${translate(series.tooltipLabel)}: ${value}`;
      });
      let x = mobile
        ? Math.max(8, Math.min(targetX + 14, width - tooltipWidth - 8))
        : Math.min(Math.max(left, targetX + 14), width - right - tooltipWidth);
      let y = Math.max(top, Math.min(targetY - 14, height - bottom - tooltipHeight));
      if (mobile && pointerEvent?.pointerType === 'touch') {
        const matrix = svg.getScreenCTM();
        if (matrix) {
          // Position in screen pixels so the finger clearance stays constant at any SVG scale.
          const gap = 32;
          const headerBottom = document.querySelector('.site-header')?.getBoundingClientRect().bottom || 0;
          const safeTop = Math.max(8, headerBottom + 8);
          const screenHeight = tooltipHeight * matrix.d;
          const screenWidth = tooltipWidth * matrix.a;
          let screenY = pointerEvent.clientY - gap - screenHeight;
          if (screenY < safeTop) screenY = pointerEvent.clientY + gap;
          screenY = Math.max(safeTop, Math.min(screenY, window.innerHeight - screenHeight - 8));
          const screenX = Math.max(8, Math.min(pointerEvent.clientX - screenWidth / 2, window.innerWidth - screenWidth - 8));
          const position = svg.createSVGPoint();
          position.x = screenX;
          position.y = screenY;
          const local = position.matrixTransform(matrix.inverse());
          x = local.x;
          y = local.y;
          tooltip.style.transition = 'opacity 140ms ease-out, visibility 140ms ease-out';
        }
      }
      tooltip.setAttribute('transform', `translate(${x} ${y})`);
      tooltip.classList.add('is-visible');
      tooltip.setAttribute('aria-hidden', 'false');
    }
    let activeMonth = null;
    function setActiveMonth(month) {
      if (activeMonth === month) return;
      activeMonth = month;
      for (const target of markTargets) {
        target.element.classList.toggle('is-active', month != null && target.result.month === month);
      }
    }
    const resultByMonth = new Map(results.map(result => [result.month, result]));
    function trackPointer(event) {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const chartPoint = point.matrixTransform(svg.getScreenCTM().inverse());
      if (chartPoint.x < left || chartPoint.x > width - right || chartPoint.y < top || chartPoint.y > top + innerHeight) {
        hideTooltip();
        return;
      }
      const month = Math.max(1, Math.min(12, Math.round(1 + ((chartPoint.x - dataLeft) / dataWidth) * 11)));
      const result = resultByMonth.get(month);
      if (result) {
        setActiveMonth(month);
        showTooltip(result, chartPoint.x, chartPoint.y, event);
      }
    }
    svg.addEventListener('pointerdown', trackPointer);
    svg.addEventListener('pointermove', trackPointer);
    svg.addEventListener('pointercancel', () => { hideTooltip(); setActiveMonth(null); });
    svg.addEventListener('pointerleave', () => {
      hideTooltip();
      setActiveMonth(null);
    });
    for (const target of markTargets) {
      target.element.addEventListener('pointerenter', event => {
        if (event.pointerType === 'touch') return;
        setActiveMonth(target.result.month);
        showTooltip(target.result, target.x, target.y);
      });
      target.element.addEventListener('focus', () => {
        setActiveMonth(target.result.month);
        showTooltip(target.result, target.x, target.y);
      });
      target.element.addEventListener('blur', () => {
        hideTooltip();
        setActiveMonth(null);
      });
    }

    plot.replaceChildren(svg);
    plot.hidden = false;
  }

  async function load() {
    if (started) return;
    started = true;
    const location = readCoordinates();
    if (!location) {
      status.textContent = 'Monthly estimates are not available for this location.';
      return;
    }
    try {
      await loadModules();
      // Query modules use root-relative dataset paths; detail pages are nested under /dive-sites/.
      const rootFetch = (input, options) => fetch(new URL(input, `${window.location.origin}/`), options);
      const temperature = window.DiveAtlasTemperatureQuery.createTemperatureQuery({ fetchImpl:rootFetch });
      const clarity = window.DiveAtlasWaterClarityQuery.createWaterClarityQuery({ fetchImpl:rootFetch });
      const current = window.DiveAtlasRegionalCurrents.createCurrentView({ L:null, map:null, fetchImpl:rootFetch });
      const waves = window.DiveAtlasWavesView.createWavesView({ L:null, map:null, fetchImpl:rootFetch });
      const service = window.DiveAtlasConditionsService.createDiveConditionsService({
        temperature, clarity, current, waves, model:window.DiveAtlasConditionsModel
      });
      const results = [];
      // Bound concurrent monthly work: each query can fetch and decode four source datasets.
      for (let start = 1; start <= 12; start += 3) {
        const batch = await Promise.all(Array.from({ length:Math.min(3, 13 - start) }, (_, offset) =>
          service.query(location, start + offset)));
        results.push(...batch);
      }
      render(results.map(result => ({
        month:result.month,
        overallScore:result.suitability.score,
        metrics:Object.fromEntries(SERIES.map(series => {
          const metric = result.metrics[series.key];
          return [series.key, { value:metric.value }];
        }))
      })));
    } catch (error) {
      console.warn('Monthly dive conditions could not be loaded:', error);
      status.textContent = 'Monthly estimates could not be loaded. Please try again later.';
    }
  }

  window.addEventListener('diveatlas:language-change', () => {
    MONTHS = localizedMonths();
    if (latestResults) render(latestResults);
  });

  let chartWidth = 0;
  let resizeFrame = 0;
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => {
      const nextWidth = plot.getBoundingClientRect().width;
      if (!nextWidth || Math.abs(nextWidth - chartWidth) < 1) return;
      chartWidth = nextWidth;
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => { if (latestResults) render(latestResults); });
    }).observe(plot);
  }

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void load();
    }, { rootMargin:'240px' });
    observer.observe(chart);
  } else void load();
})();
