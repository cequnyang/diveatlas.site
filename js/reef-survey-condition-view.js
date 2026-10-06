(function attachReefSurveyConditionView(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasReefSurveyConditionView = api;
})(typeof window === 'undefined' ? globalThis : window, function buildReefSurveyConditionView(root) {
  const METRICS = Object.freeze({
    liveCoralCoverPct: Object.freeze({ label: 'Live coral cover', shortLabel: 'LIVE CORAL', schemaMetric: 'liveCoralCover', colors: ['#e4f1e5', '#b9d5bc', '#86b38c', '#54845d', '#285438'] }),
    macroalgaeCoverPct: Object.freeze({ label: 'Macroalgae cover', shortLabel: 'MACROALGAE', schemaMetric: 'macroalgaeCover', colors: ['#f0f1d6', '#d9dda8', '#b9c06f', '#929b4b', '#667238'] }),
    diseasePct: Object.freeze({ label: 'Disease', shortLabel: 'DISEASE', colors: ['#f8e2e5', '#e9b9c2', '#d38c9b', '#ae5e72', '#79384f'] }),
    mortalityPct: Object.freeze({ label: 'Mortality', shortLabel: 'MORTALITY', colors: ['#f4e1e7', '#e4b8c7', '#c987a0', '#a45a79', '#713751'] }),
    oceanHeatHistory: Object.freeze({ label: 'Ocean heat history', shortLabel: 'OCEAN HEAT', colors: [] }),
    thermalStressHistory: Object.freeze({ label: 'Reef thermal stress history', shortLabel: 'REEF THERMAL PRESSURE', colors: ['#c6debc', '#91c283', '#e1c565', '#e59143', '#c04f46'] })
  });
  const DEFAULT_METRIC = 'oceanHeatHistory';
  const METRIC_STORAGE_KEY = 'diveatlas-reef-condition-metric-v1';
  const THERMAL_HISTORY_METRIC = 'thermalStressHistory';
  const OCEAN_HEAT_HISTORY_METRIC = 'oceanHeatHistory';
  const RASTER_PROVIDER_IDS = Object.freeze({
    oceanHeatHistory: 'noaa-crw-ocean-heat-history',
    thermalStressHistory: 'noaa-crw-thermal-history'
  });
  const DISPLAY_MODES = Object.freeze({ EVENT: 'event', SITE_LATEST_AVAILABLE: 'site-latest-available' });
  const SCHEMA_METRIC_KEYS = Object.freeze({
    liveCoralCoverPct: 'liveCoralCover',
    macroalgaeCoverPct: 'macroalgaeCover',
    bleaching: 'bleaching',
  });
  const NULL_METRICS = new Set(['diseasePct', 'mortalityPct']);
  const DEFAULT_REEF_COPY = Object.freeze({
    reefThermalTitle:'Thermal stress history', reefOceanTitle:'Ocean heat history', reefNoaaValue:'No NOAA value is available at this location.', reefNoSourceValue:'No valid source value is available at this location.',
    reefUnavailable:'Unavailable', reefYearCount:'{count} of {total} years', reefDhwThreshold:'DHW ≥{threshold} {unit}', reefPressureNote:'Environmental pressure evidence: accumulated heat-stress exposure. DHW thresholds do not confirm observed bleaching or mortality.',
    reefWorstRecent:'Worst recent heat stress', reefAdditionalDetails:'Additional heat-stress details', reefAdditionalHistory:'Additional heat-stress history details', reefRecentPeriod:'recent period', reefSevereYears:'Severe years', reefLastSevereRecent:'Last severe year · recent period', reefLastSevereFull:'Last severe year · full history', reefFullMaximum:'Full-history maximum', reefFullYearsThresholds:'Full-history years reaching DHW ≥{four} / ≥{eight} {unit}', reefSourcePeriod:'Source period', reefWorstYear:'worst year',
    reefChartAnnualAria:'Annual maximum DHW by year; vertical scale 0 to {max} {unit}', reefChartGroupAria:'Annual maximum DHW, in {unit}', reefNoData:'No data', reefRecentDecadePeriod:'Recent decade · {start}–{end}', reefApproxOceanGrid:'Approx. {distance} ocean grid', reefAdaptiveGrid:'Map detail adapts as you zoom · approx. {distance} grid', reefOceanNote:'Historical ocean heat conditions; not a direct observation of reef bleaching or coral mortality.', reefThermalNote:'Historical reef-focused accumulated heat stress; it does not confirm observed bleaching or mortality.', reefLoadingCoverage:'Loading metric coverage…', reefLoadingSource:'Loading source information…', reefLoadingResolution:'Loading grid resolution…', reefLoadingMap:'Loading map data…',
    reefPeriod:'Period', reefPeakSeverity:'Peak severity', reefPeakMonth:'Peak month', reefHeatwaveDays:'Heatwave days', reefStrongDays:'Strong+ days', reefSevereDays:'Severe+ days', reefLongestEvent:'Longest event', reefNonePeriod:'None during this period', reefDayCount:'{count} days',
    reefSeveritylower:'Lower accumulated heat stress', reefSeveritybleaching:'Bleaching-level heat stress', reefSeveritysevere:'Severe heat stress', reefSeverityverySevere:'Very severe heat stress', reefSeverityextreme:'Extreme heat stress', reefSeverityexceptional:'Exceptional heat stress',
    reefLegendSeveritylower:'Lower', reefLegendSeveritybleaching:'Bleaching', reefLegendSeveritysevere:'Severe', reefLegendSeverityverySevere:'V. severe', reefLegendSeverityextreme:'Extreme', reefLegendSeverityexceptional:'Exceptional',
    reefHeatCategory0:'No heatwave', reefHeatCategory1:'Moderate', reefHeatCategory2:'Strong', reefHeatCategory3:'Severe', reefHeatCategory4:'Extreme', reefHeatCategory5:'Beyond extreme'
  });
  const defaultReefTranslation = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), DEFAULT_REEF_COPY[key] || key);
  const reefCopyResolver = translate => (key, values = {}) => {
    const localized = translate(key, values);
    return localized && localized !== key ? localized : defaultReefTranslation(key, values);
  };

  function metricBand(value, definition = null) {
    if (value == null || value === '' || !Number.isFinite(Number(value))) return null;
    const bounds = definition && Array.isArray(definition.bandUpperBounds)
      ? definition.bandUpperBounds
      : [20, 40, 60, 80, 100];
    const numericValue = Number(value);
    const index = bounds.findIndex(upper => numericValue <= upper);
    return Math.max(0, Math.min(4, index < 0 ? bounds.length - 1 : index));
  }

  function metricColor(metric, value, metricDefinitions = METRICS) {
    const definition = metricDefinitions[metric];
    if (!definition) return '#87939a';
    const band = metricBand(value, definition);
    return band == null ? '#87939a' : definition.colors[band];
  }

  function surveyAgeOpacity(surveyDate, referenceDate) {
    const normalizedDate = surveyDate && /^\d{4}$/.test(surveyDate)
      ? `${surveyDate}-07-01`
      : surveyDate && /^\d{4}-\d{2}$/.test(surveyDate) ? `${surveyDate}-15` : surveyDate;
    const date = normalizedDate ? new Date(`${normalizedDate}T00:00:00Z`) : null;
    const reference = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
    if (!date || Number.isNaN(date.getTime()) || Number.isNaN(reference.getTime())) return 0.4;
    const age = Math.max(0, (reference.getTime() - date.getTime()) / (365.2425 * 24 * 60 * 60 * 1000));
    if (age <= 2) return 1;
    if (age <= 5) return 0.8;
    if (age <= 10) return 0.6;
    return 0.4;
  }

  function formatPercentage(value) {
    return value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : `${Number(value)}%`;
  }

  function datasetStatusText(metadata) {
    return metadata && typeof metadata.provider === 'string' && metadata.provider.trim()
      ? metadata.provider
      : 'Field observations';
  }

  function datasetStatusExplanation(metadata) {
    const provider = datasetStatusText(metadata);
    return `Survey observations supplied by ${provider}. Values retain their reported dates and source context.`;
  }

  function metricCandidates(record, metric) {
    const schema = typeof module === 'object' && module.exports
      ? require('./reef-survey-schema.js')
      : root.DiveAtlasReefSurveySchema;
    const schemaMetric = SCHEMA_METRIC_KEYS[metric] || metric;
    return schemaMetric && schema ? schema.getMetricCandidates(record, schemaMetric) : [];
  }

  function recordMetric(record, metric, metricDefinitions = METRICS) {
    if (NULL_METRICS.has(metric)) return null;
    const schemaMetric = metricDefinitions[metric]?.schemaMetric || SCHEMA_METRIC_KEYS[metric];
    const candidates = metricCandidates(record, schemaMetric);
    // Until a protocol preference rule exists, only a single candidate is displayable.
    return candidates.length === 1 ? candidates[0].valuePct : null;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  const THERMAL_SEVERITY = Object.freeze([
    Object.freeze({ upper: 4, key: 'lower', label: 'Lower accumulated heat stress', color: '#789289' }),
    Object.freeze({ upper: 8, key: 'bleaching', label: 'Bleaching-level heat stress', color: '#dab950' }),
    Object.freeze({ upper: 12, key: 'severe', label: 'Severe heat stress', color: '#ed902b' }),
    Object.freeze({ upper: 16, key: 'verySevere', label: 'Very severe heat stress', color: '#df532b' }),
    Object.freeze({ upper: 20, key: 'extreme', label: 'Extreme heat stress', color: '#b72b34' }),
    Object.freeze({ upper: Infinity, key: 'exceptional', label: 'Exceptional heat stress', color: '#702469' })
  ]);

  function thermalSeverity(value) {
    if (!Number.isFinite(Number(value)) || value == null) return null;
    return THERMAL_SEVERITY.find(band => Number(value) < band.upper) || THERMAL_SEVERITY.at(-1);
  }

  function thermalHistoryTimeline(values, years, {
    formatDhwNumber = value => Number(value).toFixed(1),
    dhwUnit = '°C-weeks',
    formatDhwThreshold = value => String(value),
    translate = defaultReefTranslation
  } = {}) {
    const text = reefCopyResolver(translate);
    const finiteValues = values.filter(Number.isFinite);
    const maxValue = Math.max(0, ...finiteValues);
    // Calculate the chart scale against source °C-weeks before converting its labels.
    // The source severity bands advance in 4 °C-weeks increments.
    const scaleMax = Math.max(4, Math.ceil(maxValue / 4) * 4);
    const midpoint = scaleMax / 2;
    const timeline = `<div class="reef-condition-history-timeline" role="list" aria-label="${escapeHtml(text('reefChartAnnualAria', { unit:dhwUnit, max:formatDhwNumber(scaleMax) }))}">${years.map((year, index) => {
      const value = values[index];
      const band = thermalSeverity(value);
      const height = Number.isFinite(value) ? Math.max(3, Math.round((value / scaleMax) * 32)) : 2;
      const accessibleValue = Number.isFinite(value) ? `${formatDhwNumber(value)} ${dhwUnit}, ${text(`reefSeverity${band?.key || 'lower'}`)}` : text('reefNoData');
      return `<div class="reef-condition-history-year" role="listitem" aria-label="${year}: ${escapeHtml(accessibleValue)}"><span class="reef-condition-history-bar" style="height:${height}px;background:${band?.color || '#aab2b4'}" aria-hidden="true"></span><span class="reef-condition-history-year-label">${String(year).slice(-2)}</span></div>`;
    }).join('')}</div>`;
    const displayMaximum = formatDhwNumber(scaleMax);
    const displayMidpoint = formatDhwNumber(midpoint);
    const shortUnit = dhwUnit.replace(/-weeks$/u, '-wk');
    return `<div class="reef-condition-history-chart" role="group" aria-label="${escapeHtml(text('reefChartGroupAria', { unit:dhwUnit }))}"><div class="reef-condition-history-axis" aria-hidden="true"><div class="reef-condition-history-ticks"><span>${escapeHtml(displayMaximum)}</span><span>${escapeHtml(displayMidpoint)}</span><span>0</span></div><span class="reef-condition-history-axis-unit">${escapeHtml(shortUnit)}</span></div>${timeline}</div>`;
  }

  function thermalHistoryPopupMarkup(value, metadata, {
    formatDhwNumber = number => Number(number).toFixed(1),
    formatDhwThreshold = number => String(number),
    dhwUnit = '°C-weeks',
    translate = defaultReefTranslation
  } = {}) {
    const text = reefCopyResolver(translate);
    const periods = metadata.periods;
    if (!value) return `<div class="bio-popup reef-condition-raster-popup"><div class="bio-popup-title">${escapeHtml(text('reefThermalTitle'))}</div><div class="bio-popup-fields">${escapeHtml(text('reefNoaaValue'))}</div></div>`;
    const availableCount = (count, denominator) => denominator == null || denominator === 255 ? text('reefUnavailable') : text('reefYearCount', { count, total:denominator });
    const worst = Number.isFinite(value.recentMaxDhw) ? formatDhwNumber(value.recentMaxDhw) : null;
    const severity = thermalSeverity(value.recentMaxDhw);
    const year = number => number === 65535 ? text('reefUnavailable') : String(number);
    const timelineYears = Array.from({ length: periods.recentEnd - periods.recentStart + 1 }, (_, index) => periods.recentStart + index);
    const annualValues = timelineYears.map((_, index) => value.recentAnnualValues[index]);
    const threshold = number => formatDhwThreshold(number);
    const dhwThresholdLabel = number => text('reefDhwThreshold', { threshold:threshold(number), unit:dhwUnit });
    return `<div class="bio-popup reef-condition-raster-popup">
      <div class="bio-popup-title">${escapeHtml(text('reefThermalTitle'))}</div>
      <div class="reef-condition-pressure-note">${escapeHtml(text('reefPressureNote'))}</div>
      <div class="reef-condition-worst">
        <div class="reef-condition-worst-copy">
          <span>${escapeHtml(text('reefWorstRecent'))} · ${periods.recentStart}–${periods.recentEnd}</span>
          <div class="reef-condition-worst-value">
            <strong>${worst == null ? escapeHtml(text('reefUnavailable')) : `${escapeHtml(worst)} ${escapeHtml(dhwUnit)}`}</strong>
            <details class="temperature-info reef-condition-history-info">
              <summary aria-label="${escapeHtml(text('reefAdditionalDetails'))}" title="${escapeHtml(text('reefAdditionalDetails'))}" aria-controls="reefConditionHistoryInfoPopover"><span aria-hidden="true">i</span></summary>
              <div class="temperature-info-popover reef-condition-history-extra" id="reefConditionHistoryInfoPopover" role="note">
                <p>${escapeHtml(text('reefAdditionalHistory'))}</p>
                <dl>
                  <div><dt>${escapeHtml(dhwThresholdLabel(4))}</dt><dd>${availableCount(value.recentYearsGte4, value.recentValidYears)} · ${escapeHtml(text('reefRecentPeriod'))}</dd></div>
                  <div><dt>${escapeHtml(text('reefSevereYears'))} · ${escapeHtml(dhwThresholdLabel(8))}</dt><dd>${availableCount(value.recentYearsGte8, value.recentValidYears)} · ${escapeHtml(text('reefRecentPeriod'))}</dd></div>
                  <div><dt>${escapeHtml(text('reefLastSevereRecent'))}</dt><dd>${year(value.lastRecentSevereYear)}</dd></div>
                  <div><dt>${escapeHtml(text('reefLastSevereFull'))}</dt><dd>${year(value.lastSevereYear)}</dd></div>
                  <div><dt>${escapeHtml(text('reefFullMaximum'))}</dt><dd>${Number.isFinite(value.fullHistoryMaxDhw) ? `${escapeHtml(formatDhwNumber(value.fullHistoryMaxDhw))} ${escapeHtml(dhwUnit)} · ${year(value.fullHistoryMaxDhwYear)}` : escapeHtml(text('reefUnavailable'))}</dd></div>
                  <div><dt>${escapeHtml(text('reefFullYearsThresholds', { four:threshold(4), eight:threshold(8), unit:dhwUnit }))}</dt><dd>${availableCount(value.fullHistoryYearsGte4, value.fullValidYears)} / ${availableCount(value.fullHistoryYearsGte8, value.fullValidYears)}</dd></div>
                  <div><dt>${escapeHtml(text('reefSourcePeriod'))}</dt><dd>${periods.fullStart}–${periods.fullEnd}</dd></div>
                </dl>
              </div>
            </details>
          </div>
          <span>${escapeHtml(text(`reefSeverity${severity?.key || 'lower'}`))} · ${escapeHtml(text('reefWorstYear'))} ${year(value.recentMaxYear)}</span>
        </div>
      </div>
      ${thermalHistoryTimeline(annualValues, timelineYears, { formatDhwNumber, dhwUnit, formatDhwThreshold, translate:text })}
      <div class="reef-condition-history-source"><a class="bio-popup-source-link" href="${escapeHtml(metadata.sourcePageUrl || metadata.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(metadata.provider)} · Thermal History v${escapeHtml(metadata.productVersion)}</a></div>
    </div>`;
  }

  function oceanHeatHistoryPopupMarkup(value, metadata, { translate = defaultReefTranslation, locale = 'en' } = {}) {
    const text = reefCopyResolver(translate);
    const period = metadata.sourcePeriod;
    if (!value) {
      return `<div class="bio-popup reef-condition-raster-popup"><div class="bio-popup-title">${escapeHtml(text('reefOceanTitle'))}</div><div class="bio-popup-fields">${escapeHtml(text('reefNoSourceValue'))}</div></div>`;
    }
    const category = metadata.categories.find(item => item.code === value.category);
    const worstDate = value.category === 0 ? text('reefNonePeriod') : formatObservationDate(value.date, locale);
    const integer = number => Number.isInteger(number) ? new Intl.NumberFormat(locale).format(number) : text('reefUnavailable');
    const fields = [
      [text('reefPeriod'), `${period.startYear}–${period.endYear}`],
      [text('reefPeakSeverity'), text(`reefHeatCategory${value.category}`) || category?.label || text('reefUnavailable')],
      [text('reefPeakMonth'), worstDate],
      [text('reefHeatwaveDays'), integer(value.marineHeatwaveDays)],
      [text('reefStrongDays'), integer(value.strongOrWorseDays)],
      [text('reefSevereDays'), integer(value.severeOrWorseDays)],
      [text('reefLongestEvent'), Number.isInteger(value.longestEpisodeDays) ? text('reefDayCount', { count:integer(value.longestEpisodeDays) }) : text('reefUnavailable')]
    ];
    const sourceLabel = [metadata.provider, metadata.product, metadata.productVersion ? `v${metadata.productVersion}` : '']
      .filter(Boolean)
      .join(' · ');
    return `<div class="bio-popup reef-condition-raster-popup reef-condition-ocean-heat-popup"><div class="bio-popup-title">${escapeHtml(text('reefOceanTitle'))}</div><div class="bio-popup-fields">${fields.map(([label, content]) => `<div class="bio-popup-field"><span class="bio-popup-field__label">${escapeHtml(label)}</span><span class="bio-popup-field__value">${escapeHtml(content)}</span></div>`).join('')}</div><div class="reef-condition-history-source"><a class="bio-popup-source-link" href="${escapeHtml(metadata.sourcePageUrl || metadata.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceLabel || metadata.attribution)}</a></div></div>`;
  }

  function decodeOceanHeatQueryRecord(buffer, { tileColumn, tileRow, cellIndex, tileSize }) {
    const view = new DataView(buffer);
    const header = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
    const bytesPerCell = 15;
    if (buffer.byteLength !== 8 + tileSize * tileSize * bytesPerCell || header !== 'MHW1' ||
        view.getUint16(4, true) !== tileColumn || view.getUint16(6, true) !== tileRow ||
        cellIndex < 0 || cellIndex >= tileSize * tileSize) {
      throw new TypeError('NOAA ocean-heat query chunk is invalid');
    }
    const offset = 8 + cellIndex * bytesPerCell;
    const read = fieldOffset => view.getUint16(offset + fieldOffset, true);
    const category = view.getUint8(offset);
    const validDays = read(13);
    if (category === 255 || validDays === 0) return null;
    return Object.freeze({
      category,
      worstDayIndex: read(1),
      marineHeatwaveDays: read(3),
      strongOrWorseDays: read(5),
      severeOrWorseDays: read(7),
      extremeOrWorseDays: read(9),
      longestEpisodeDays: read(11),
      validDays
    });
  }

  function popupMarkup(record, metric, metricDefinitions = METRICS) {
    const selected = metricDefinitions[metric] || metricDefinitions[DEFAULT_METRIC];
    const fields = [
      ['Live coral cover', recordMetric(record, 'liveCoralCoverPct', metricDefinitions)], ['Macroalgae', recordMetric(record, 'macroalgaeCoverPct', metricDefinitions)],
      ['Bleaching', recordMetric(record, 'bleaching', metricDefinitions)],
      ['Disease', null], ['Mortality', null]
    ];
    const sampleUnitCount = record.protocols.length === 1 ? record.protocols[0].sampleUnitCount : null;
    const surveyDate = formatObservationDate(record.survey.date);
    return `<div class="bio-popup reef-survey-popup"><div class="bio-popup-title">Reef condition</div><div class="bio-popup-site">${escapeHtml(record.location.siteName || 'Survey site')}</div><div class="reef-survey-popup-primary"><span>${escapeHtml(selected.shortLabel)}</span><strong>${formatPercentage(recordMetric(record, metric))}</strong></div><div class="bio-popup-fields">${fields.map(([label, value]) => `<div class="bio-popup-field"><span class="bio-popup-field__label">${label}</span><span class="bio-popup-field__value">${formatPercentage(value)}</span></div>`).join('')}</div><div class="bio-popup-fields reef-survey-popup-meta"><div class="bio-popup-field"><span class="bio-popup-field__label">Surveyed</span><span class="bio-popup-field__value">${surveyDate}</span></div><div class="bio-popup-field"><span class="bio-popup-field__label">Sample units</span><span class="bio-popup-field__value">${sampleUnitCount == null ? '—' : escapeHtml(sampleUnitCount)}</span></div><div class="bio-popup-field"><span class="bio-popup-field__label">Data confidence</span><span class="bio-popup-field__value">${escapeHtml(record.quality.confidenceLevel || '—')}</span></div><div class="bio-popup-field"><span class="bio-popup-field__label">Source</span><span class="bio-popup-field__value">${escapeHtml(record.provenance.provider || '—')}</span></div></div></div>`;
  }

  function formatObservationDate(value, locale = 'en') {
    if (!value) return '—';
    if (/^\d{4}$/.test(value)) return value;
    const normalizedDate = /^\d{4}-\d{2}$/.test(value) ? `${value}-15` : value;
    const date = new Date(`${normalizedDate}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
  }

  function formatEvidenceAge(ageDays, approximate = false) {
    if (!Number.isInteger(ageDays)) return '—';
    const prefix = approximate ? 'about ' : '~';
    const suffix = approximate ? ' (year/month precision)' : '';
    if (ageDays < 30) return `${prefix}${ageDays} days${suffix}`;
    if (ageDays < 365) return `${prefix}${Math.max(1, Math.round(ageDays / 30.4375))} months${suffix}`;
    return `${prefix}${Math.max(1, Math.round(ageDays / 365.2425))} years${suffix}`;
  }

  function siteResolutionResult(status, metric, sourceSiteId) {
    return { status, value: null, metric, observationDate: null, sourceEventId: null, sourceSiteId, protocol: null };
  }

  function buildSiteObservations(events, resolver, referenceDate = new Date(), metricDefinitions = METRICS) {
    if (!resolver || typeof resolver.groupEventsBySourceSite !== 'function' || typeof resolver.resolveLatestAvailableMetric !== 'function') {
      throw new TypeError('The Reef Condition temporal resolver is required for site-level display.');
    }
    return resolver.groupEventsBySourceSite(events).map(group => {
      const representative = group.events[0];
      const resolutions = {};
      const resolvedRecords = {};
      for (const [viewMetric, definition] of Object.entries(metricDefinitions)) {
        const schemaMetric = definition.schemaMetric;
        if (!schemaMetric || !resolver.SUPPORTED_METRICS.includes(schemaMetric)) continue;
        resolutions[viewMetric] = group.sourceSiteId
          ? resolver.resolveLatestAvailableMetric(group.events, schemaMetric, referenceDate)
          : siteResolutionResult('missing', schemaMetric, null);
        const selectedId = resolutions[viewMetric].sourceEventId;
        resolvedRecords[viewMetric] = selectedId == null ? null : group.events.find(event =>
          event.id === selectedId || event.provenance?.sourceRecordId === selectedId) || null;
      }
      return {
        key: `site:${JSON.stringify([group.provider, group.sourceSiteId || representative.id])}`,
        record: representative,
        events: group.events,
        resolutions,
        resolvedRecords,
        metricValues: Object.fromEntries(Object.entries(resolutions).map(([key, value]) => [key, value.status === 'unique' ? value.value : null]))
      };
    });
  }

  function siteResolutionText(result) {
    if (result.status === 'unique') return `${formatPercentage(result.value)}<span class="reef-survey-observed">Observed: ${escapeHtml(formatObservationDate(result.observationDate))}</span><span class="reef-survey-data-age">Data age: ${escapeHtml(formatEvidenceAge(result.ageDays, result.ageApproximate))}</span>`;
    if (result.status === 'ambiguous') return 'Unavailable<span class="reef-survey-resolution-reason">Multiple compatible observations share the newest survey date.</span>';
    return 'Unavailable<span class="reef-survey-resolution-reason">No compatible metric observation is available.</span>';
  }

  function sitePopupMarkup(site, selectedMetric, metricDefinitions = METRICS) {
    const primary = metricDefinitions[selectedMetric] || metricDefinitions[DEFAULT_METRIC];
    const primaryResult = site.resolutions[selectedMetric];
    const primaryValue = primaryResult && primaryResult.status === 'unique' ? formatPercentage(primaryResult.value) : 'Unavailable';
    const field = (metric, label) => `<div class="bio-popup-field reef-survey-site-metric${metric === selectedMetric ? ' is-selected' : ''}"><span class="bio-popup-field__label">${label}</span><span class="bio-popup-field__value">${siteResolutionText(site.resolutions[metric])}</span></div>`;
    return `<div class="bio-popup reef-survey-popup"><div class="bio-popup-title">Reef condition</div><div class="bio-popup-site">${escapeHtml(site.record.location.siteName || 'Survey site')}</div><div class="reef-survey-popup-primary"><span>${escapeHtml(primary.shortLabel)}</span><strong>${primaryValue}</strong></div><div class="bio-popup-fields reef-survey-site-resolutions">${field('liveCoralCoverPct', 'Live coral cover')}${field('macroalgaeCoverPct', 'Macroalgae')}</div><div class="bio-popup-fields reef-survey-popup-meta"><div class="bio-popup-field"><span class="bio-popup-field__label">Data confidence</span><span class="bio-popup-field__value">${escapeHtml(site.record.quality.confidenceLevel || '—')}</span></div><div class="bio-popup-field"><span class="bio-popup-field__label">Source</span><span class="bio-popup-field__value">${escapeHtml(site.record.provenance.provider || '—')}</span></div></div></div>`;
  }

  function keepPopupWithinViewport(map, popup) {
    const requestFrame = root.requestAnimationFrame
      ? callback => root.requestAnimationFrame(callback)
      : callback => setTimeout(callback, 0);
    requestFrame(() => requestFrame(() => {
      const element = popup && popup.getElement?.();
      if (!element || !map || typeof map.panBy !== 'function') return;
      const bounds = element.getBoundingClientRect();
      const mapBounds = map.getContainer().getBoundingClientRect();
      const visualViewport = root.visualViewport;
      const viewportTop = visualViewport?.offsetTop || 0;
      const viewportLeft = visualViewport?.offsetLeft || 0;
      const viewportBottom = visualViewport ? viewportTop + visualViewport.height : root.innerHeight;
      const viewportRight = visualViewport ? viewportLeft + visualViewport.width : root.innerWidth;
      const header = root.document?.getElementById('topMenuBar')?.getBoundingClientRect();
      const safeTop = Math.max(mapBounds.top + 12, viewportTop + 12, header && header.bottom > viewportTop ? header.bottom + 12 : 0);
      const safeBottom = Math.min(mapBounds.bottom - 12, viewportBottom - 12);
      const safeLeft = Math.max(mapBounds.left + 8, viewportLeft + 8);
      const safeRight = Math.min(mapBounds.right - 8, viewportRight - 8);
      const panX = bounds.left < safeLeft ? bounds.left - safeLeft : bounds.right > safeRight ? bounds.right - safeRight : 0;
      const panY = bounds.top < safeTop ? bounds.top - safeTop : bounds.bottom > safeBottom ? bounds.bottom - safeBottom : 0;
      if (panX || panY) map.panBy([panX, panY], { animate: false });
    }));
  }

  function createReefSurveyConditionView({
    map, L, panel, createPopup = null, bindPopup = null, providerRegistry = null,
    displayMode = DISPLAY_MODES.EVENT, referenceDate = new Date(), localMetricDefinitions = [],
    formatLongDistance = meters => `${(Number(meters) / 1000).toFixed(1)} km`,
    formatDhwNumber = value => Number(value).toFixed(1),
    formatDhwThreshold = value => String(value),
    getDhwUnit = () => '°C-weeks',
    translate = defaultReefTranslation,
    getLocale = () => 'en',
    hasHigherPriorityOverlay = () => false
  }) {
    const providerApi = typeof module === 'object' && module.exports
      ? require('./reef-condition-provider.js')
      : root.DiveAtlasReefConditionProvider;
    if (!providerApi) throw new Error('Reef Condition provider interface is unavailable.');
    const providers = providerRegistry || providerApi.createProviderRegistry([
      providerApi.createFieldObservationsProvider()
    ]);
    const metricDefinitions = Object.freeze({
      ...METRICS,
      ...Object.fromEntries((Array.isArray(localMetricDefinitions) ? localMetricDefinitions : [])
        .filter(definition => definition && typeof definition.value === 'string' && definition.schemaMetric)
        .map(definition => [definition.value, definition]))
    });
    const observationProviderIds = new Set(providers.list()
      .filter(provider => provider.kind === providerApi.PROVIDER_KINDS.FIELD_OBSERVATIONS)
      .map(provider => provider.id));
    const fieldProviderId = providers.list().find(provider => provider.kind === providerApi.PROVIDER_KINDS.FIELD_OBSERVATIONS && !localMetricDefinitions.some(metricDefinition => metricDefinition.providerId === provider.id))?.id || null;
    const rasterStates = new Map();
    for (const [rasterMetric, providerId] of Object.entries(RASTER_PROVIDER_IDS)) {
      if (providers.list().some(provider => provider.id === providerId && provider.kind === providerApi.PROVIDER_KINDS.RASTER_CONDITION)) {
        rasterStates.set(rasterMetric, { metric: rasterMetric, id: providerId, promise: null, metadata: null, layer: null, clickHandler: null, queryChunkCache: new Map() });
      }
    }
    const observationStates = new Map();
    let activeProviderId = null;
    let records = [];
    let sourceMetadata = null;
    let siteObservations = [];
    let displayModeValue = displayMode === DISPLAY_MODES.SITE_LATEST_AVAILABLE ? displayMode : DISPLAY_MODES.EVENT;
    let temporalResolverPromise = null;
    let active = false;
    let metric = DEFAULT_METRIC;
    let lastRasterPopup = null;
    const renderer = L.canvas({ padding: 0.4 });
    const layer = L.layerGroup();
    const markers = [];
    const markerKeys = [];
    const metricSelect = panel.querySelector('[data-reef-survey-metric]');
    const legend = panel.querySelector('[data-reef-survey-legend]');
    const period = panel.querySelector('[data-reef-survey-period]');
    const countSummary = panel.querySelector('[data-reef-survey-count]');
    const loadError = panel.querySelector('[data-reef-survey-error]');
    const datasetStatus = panel.querySelector('[data-reef-survey-dataset-status]');
    const datasetInfo = panel.querySelector('[data-reef-survey-dataset-info]');
    const fieldControls = panel.querySelector('[data-reef-survey-field-controls]');
    const rasterControls = panel.querySelector('[data-reef-condition-raster-controls]');
    const rasterLegend = panel.querySelector('[data-reef-condition-raster-legend]');
    const rasterSource = panel.querySelector('[data-reef-condition-raster-source]');
    const rasterResolution = panel.querySelector('[data-reef-condition-raster-resolution]');
    const rasterStatus = panel.querySelector('[data-reef-condition-raster-status]');
    const rasterNote = panel.querySelector('[data-reef-condition-raster-note]');
    const infoPeriod = panel.querySelector('[data-reef-condition-info-period]');
    const infoSource = panel.querySelector('[data-reef-condition-info-source]');
    const infoResolution = panel.querySelector('[data-reef-condition-info-resolution]');

    let savedMetric = null;
    try {
      savedMetric = root.localStorage?.getItem(METRIC_STORAGE_KEY) || null;
    } catch (_) {}
    const selectedMetric = savedMetric && Object.prototype.hasOwnProperty.call(metricDefinitions, savedMetric)
      ? savedMetric
      : metricSelect && Object.prototype.hasOwnProperty.call(metricDefinitions, metricSelect.value)
        ? metricSelect.value
        : Object.prototype.hasOwnProperty.call(metricDefinitions, DEFAULT_METRIC)
          ? DEFAULT_METRIC
          : Object.keys(metricDefinitions)[0];
    metric = selectedMetric;
    if (metricSelect) metricSelect.value = selectedMetric;
    activeProviderId = metricDefinitions[selectedMetric]?.providerId || fieldProviderId;
    if (activeProviderId) providers.select(activeProviderId);

    function rasterStateForProvider(id) {
      return [...rasterStates.values()].find(state => state.id === id) || null;
    }

    function rasterStateForMetric(value) {
      return rasterStates.get(value) || null;
    }

    function selectedRasterState() {
      return rasterStateForProvider(activeProviderId);
    }

    function formatRasterDistance(kilometers) {
      return formatLongDistance(Number(kilometers) * 1000);
    }

    function rasterPopupMarkup(state, sample) {
      if (state.metric === OCEAN_HEAT_HISTORY_METRIC) return oceanHeatHistoryPopupMarkup(sample, state.metadata, { translate, locale:getLocale() });
      return thermalHistoryPopupMarkup(sample, state.metadata, {
        formatDhwNumber,
        formatDhwThreshold,
        dhwUnit: getDhwUnit(),
        translate
      });
    }

    function setRasterSourceLabel(metric) {
      if (!rasterSource) return;
      const isOceanHeat = metric === OCEAN_HEAT_HISTORY_METRIC;
      const sourceName = isOceanHeat ? 'NOAA Marine Heatwave Watch' : 'NOAA Coral Reef Watch Thermal History';
      rasterSource.textContent = 'NOAA';
      rasterSource.setAttribute('aria-label', sourceName);
      rasterSource.setAttribute('title', sourceName);
    }

    function createRasterLayer(state) {
      if (state.layer || !state.metadata) return state.layer;
      const metadata = state.metadata;
      const url = `${metadata.assetBase}/${metadata.tileTemplate}?v=${encodeURIComponent(metadata.version || '')}`;
      const oceanHeat = state.metric === OCEAN_HEAT_HISTORY_METRIC;
      state.layer = L.tileLayer(url, {
        pane: 'coralHeatStressPane', minZoom: metadata.tileMinZoom ?? metadata.minZoom ?? 2, maxZoom: 19,
        minNativeZoom: metadata.tileMinZoom ?? metadata.minZoom, maxNativeZoom: metadata.tileMaxNativeZoom ?? metadata.maxNativeZoom,
        // NOAA tiles already encode category severity in pixel alpha; a restrained Leaflet opacity keeps that emphasis while preserving map labels and bathymetry.
        tileSize: 256, opacity: oceanHeat ? 0.8 : 0.88, updateWhenZooming: false, keepBuffer: 1, attribution: metadata.attribution,
        className: `${oceanHeat ? 'reef-condition-ocean-heat-tiles' : 'coral-heat-stress-history-tiles'} reef-condition-noaa-tiles`, crossOrigin: true, interactive: true
      });
      state.layer.on('tileload', () => {
        if (activeProviderId !== state.id) return;
        if (loadError) loadError.hidden = true;
        if (datasetStatus) datasetStatus.textContent = metadata.attribution;
        if (rasterStatus?.textContent === 'Loading NOAA history tiles…') rasterStatus.textContent = '';
      });
      state.layer.on('tileerror', () => {
        if (activeProviderId === state.id && rasterStatus) rasterStatus.textContent = oceanHeat
          ? 'NOAA ocean heat-history tiles are unavailable.'
          : 'NOAA thermal-history tiles are unavailable.';
      });
      return state.layer;
    }

    async function onRasterMapClick(state, event) {
      if (!active || activeProviderId !== state.id) return;
      if (hasHigherPriorityOverlay(event.latlng)) return;
      const statusVersion = state.id;
      if (rasterStatus) rasterStatus.textContent = 'Loading NOAA history…';
      try {
        const sample = await sampleRaster(event.latlng, state);
        if (!active || activeProviderId !== statusVersion) return;
        if (!sample) {
          if (rasterStatus) rasterStatus.textContent = 'No NOAA value is available at this location.';
          return;
        }
        if (rasterStatus) rasterStatus.textContent = '';
        const isOceanHeat = state.metric === OCEAN_HEAT_HISTORY_METRIC;
        const popupOptions = {
          className: isOceanHeat ? 'reef-condition-ocean-heat-popup' : 'coral-heat-stress-popup',
          maxWidth: isOceanHeat ? 300 : 242,
          minWidth: 0,
          closeOnClick: false
        };
        const popup = (createPopup ? createPopup(popupOptions) : L.popup(popupOptions))
          .setLatLng(event.latlng)
          .setContent(rasterPopupMarkup(state, sample));
        popup._diveAtlasLayerKey = 'reef-survey-condition';
        lastRasterPopup = { popup, state, sample };
        popup.openOn(map);
      } catch (_) {
        if (active && activeProviderId === statusVersion && rasterStatus) rasterStatus.textContent = 'NOAA location details are unavailable.';
      }
    }

    async function loadQueryChunk(state, tileColumn, tileRow) {
      const metadata = state.metadata;
      const cacheKey = `${tileColumn}_${tileRow}`;
      if (!state.queryChunkCache.has(cacheKey)) {
        const path = metadata.queryTileTemplate.replace('{column}', String(tileColumn)).replace('{row}', String(tileRow));
        const request = fetch(`${metadata.assetBase}/${path}?v=${encodeURIComponent(metadata.version || '')}`, { cache: 'force-cache' })
          .then(async response => {
            if (!response.ok || typeof DecompressionStream !== 'function') throw new Error('NOAA query tile unavailable');
            const compressed = await response.arrayBuffer();
            return new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
          })
          .catch(error => { state.queryChunkCache.delete(cacheKey); throw error; });
        state.queryChunkCache.set(cacheKey, request);
      }
      return state.queryChunkCache.get(cacheKey);
    }

    async function sampleRaster(latlng, state) {
      const metadata = state.metadata;
      if (state.metric === OCEAN_HEAT_HISTORY_METRIC) {
        const grid = metadata.displayGrid;
        const longitude = ((latlng.lng + 180) % 360 + 360) % 360 - 180;
        const column = ((Math.round((longitude - grid.longitudeMin) / grid.stepDegrees) % grid.width) + grid.width) % grid.width;
        const row = Math.round((latlng.lat - grid.latitudeMin) / grid.stepDegrees);
        if (row < 0 || row >= grid.height) return null;
        const size = metadata.query.tileSizeCells;
        const tileColumn = Math.floor(column / size);
        const tileRow = Math.floor(row / size);
        const buffer = await loadQueryChunk(state, tileColumn, tileRow);
        const record = decodeOceanHeatQueryRecord(buffer, {
          tileColumn, tileRow, tileSize: size, cellIndex: (row % size) * size + (column % size)
        });
        if (!record) return null;
        const date = new Date(`${metadata.sourcePeriod.start}T00:00:00Z`);
        date.setUTCDate(date.getUTCDate() + record.worstDayIndex);
        return { ...record, date: Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10) };
      }

      const grid = metadata.grid;
      const longitude = ((latlng.lng + 180) % 360 + 360) % 360 - 180;
      const column = ((Math.round((longitude - grid.longitude_min) / grid.longitude_step) % grid.width) + grid.width) % grid.width;
      const row = Math.round((latlng.lat - grid.latitude_min) / grid.latitude_step);
      if (row < 0 || row >= grid.height) return null;
      const size = metadata.queryTileSizeCells;
      const tileColumn = Math.floor(column / size);
      const tileRow = Math.floor(row / size);
      const bytes = await loadQueryChunk(state, tileColumn, tileRow);
      const view = new DataView(bytes);
      const bytesPerCell = metadata.queryBytesPerCell;
      if (bytes.byteLength !== 12 + size * size * bytesPerCell || String.fromCharCode(...new Uint8Array(bytes, 0, 4)) !== 'DCHR' ||
          view.getUint8(4) !== 2 || view.getUint8(5) !== bytesPerCell || view.getUint16(6, true) !== size ||
          view.getUint16(8, true) !== tileColumn || view.getUint16(10, true) !== tileRow) throw new TypeError('NOAA query tile is invalid');
      const offset = 12 + ((row % size) * size + (column % size)) * bytesPerCell;
      const fullValidYears = view.getUint8(offset);
      const recentValidYears = view.getUint8(offset + 1);
      if (fullValidYears === 255 || recentValidYears === 255) return null;
      const recentAnnualValues = Array.from({ length: 10 }, (_, index) => {
        const encoded = view.getUint16(offset + 18 + index * 2, true);
        return encoded === 65535 ? null : encoded / 100;
      });
      return {
        fullValidYears,
        recentValidYears,
        fullHistoryYearsGte4: view.getUint8(offset + 2),
        fullHistoryYearsGte8: view.getUint8(offset + 3),
        recentYearsGte4: view.getUint8(offset + 4),
        recentYearsGte8: view.getUint8(offset + 5),
        lastSevereYear: view.getUint16(offset + 6, true),
        lastRecentSevereYear: view.getUint16(offset + 8, true),
        recentMaxDhw: view.getUint16(offset + 10, true) === 65535 ? null : view.getUint16(offset + 10, true) / 100,
        recentMaxYear: view.getUint16(offset + 12, true),
        fullHistoryMaxDhw: view.getUint16(offset + 14, true) === 65535 ? null : view.getUint16(offset + 14, true) / 100,
        fullHistoryMaxDhwYear: view.getUint16(offset + 16, true),
        recentAnnualValues,
      };
    }

    function updateRasterLegend(state) {
      if (!rasterLegend || !state?.metadata) return;
      if (state.metric === OCEAN_HEAT_HISTORY_METRIC) {
        const metadata = state.metadata;
        if (infoPeriod) infoPeriod.textContent = translate('reefRecentDecadePeriod', { start:metadata.sourcePeriod.startYear, end:metadata.sourcePeriod.endYear });
        if (infoSource) infoSource.textContent = `NOAA Marine Heatwave Watch v${metadata.productVersion}`;
        if (infoResolution) infoResolution.textContent = translate('reefApproxOceanGrid', { distance:formatRasterDistance(25) });
        setRasterSourceLabel(state.metric);
        if (rasterResolution) rasterResolution.textContent = formatRasterDistance(25);
        rasterLegend.innerHTML = `<div class="reef-survey-legend-title">${escapeHtml(translate('reefOceanLegend').toLocaleUpperCase(getLocale()))}</div><div class="coral-heat-stress-history-legend reef-condition-ocean-heat-legend">${metadata.categories.map(category => {
          const compactLabel = translate(`reefHeatCategory${category.code}`) || category.label.replace('No marine heatwave', 'No heatwave');
          return `<div class="coral-heat-stress-history-item"><span class="coral-heat-stress-history-swatch" data-bin="${category.code}" style="background-color:${category.color};${category.code === 0 ? 'opacity:.35;' : ''}"></span><span>${escapeHtml(category.code)} · ${escapeHtml(compactLabel)}</span></div>`;
        }).join('')}</div>`;
        return;
      }
      const metadata = state.metadata;
      const categories = metadata.categories;
      if (infoPeriod) infoPeriod.textContent = translate('reefRecentDecadePeriod', { start:metadata.periods.recentStart, end:metadata.periods.recentEnd });
      if (infoSource) infoSource.textContent = 'NOAA Coral Reef Watch Thermal History';
      if (infoResolution) infoResolution.textContent = translate('reefAdaptiveGrid', { distance:formatRasterDistance(5) });
      setRasterSourceLabel(state.metric);
      if (rasterResolution) rasterResolution.textContent = formatRasterDistance(5);
      const unit = getDhwUnit();
      rasterLegend.innerHTML = `<div class="reef-condition-history-heading"><div class="reef-survey-legend-title">${escapeHtml(translate('reefThermalLegend').toLocaleUpperCase(getLocale()))}</div><div class="reef-condition-history-units">DHW (${escapeHtml(unit)})</div></div><div class="coral-heat-stress-history-legend">${categories.map((label, index) => {
        const [range, ...descriptionParts] = String(label).split(' · ');
        const displayRange = range.replace(/\d+(?:\.\d+)?/gu, value => formatDhwThreshold(Number(value)));
        const compactDescription = descriptionParts.join(' · ');
        const compactLabel = reefCopyResolver(translate)(`reefLegendSeverity${['lower','bleaching','severe','verySevere','extreme','exceptional'][index]}`) || compactDescription
          .replace('Bleaching-level', 'Bleaching')
          .replace('Very severe', 'V. severe')
          .replace(' accumulated heat stress', '')
          .replace(' heat stress', '');
        const labelText = compactLabel ? `${displayRange} · ${compactLabel}` : displayRange;
        return `<div class="coral-heat-stress-history-item"><span class="coral-heat-stress-history-swatch" data-bin="${index}"></span><span>${escapeHtml(labelText)}</span></div>`;
      }).join('')}</div>`;
    }

    function showProviderControls(id) {
      const state = rasterStateForProvider(id);
      const isObservationProvider = observationProviderIds.has(id);
      if (fieldControls) fieldControls.hidden = !isObservationProvider;
      if (rasterControls) rasterControls.hidden = !state;
      if (rasterNote && state) rasterNote.textContent = translate(state.metric === OCEAN_HEAT_HISTORY_METRIC ? 'reefOceanNote' : 'reefThermalNote');
      if (state) {
        setRasterSourceLabel(state.metric);
        if (rasterResolution) rasterResolution.textContent = formatRasterDistance(state.metric === OCEAN_HEAT_HISTORY_METRIC ? 25 : 5);
        if (state.metadata) updateRasterLegend(state);
        else {
          if (infoPeriod) infoPeriod.textContent = translate('reefLoadingCoverage');
          if (infoSource) infoSource.textContent = translate('reefLoadingSource');
          if (infoResolution) infoResolution.textContent = translate('reefLoadingResolution');
          if (rasterSource) rasterSource.textContent = translate('reefLoadingSource');
          if (rasterResolution) rasterResolution.textContent = formatRasterDistance(state.metric === OCEAN_HEAT_HISTORY_METRIC ? 25 : 5);
          if (rasterLegend) rasterLegend.innerHTML = `<div class="reef-survey-legend-title">${escapeHtml(translate(state.metric === OCEAN_HEAT_HISTORY_METRIC ? 'reefOceanLegend' : 'reefThermalLegend').toLocaleUpperCase(getLocale()))}</div><div class="coral-heat-stress-history-item">${escapeHtml(translate('reefLoadingMap'))}</div>`;
        }
      } else if (isObservationProvider) {
        if (rasterNote) rasterNote.textContent = 'Field observations describe surveyed locations and dates; coverage varies by metric and survey.';
        if (infoPeriod) infoPeriod.textContent = 'Latest available survey dates';
        if (infoSource) infoSource.textContent = 'Selected field-survey dataset';
        if (infoResolution) infoResolution.textContent = 'Site observations; no uniform grid';
      } else {
        if (rasterNote) rasterNote.textContent = 'Select a metric to view its data source, coverage period, and limitations.';
        if (infoPeriod) infoPeriod.textContent = 'Metric dependent';
        if (infoSource) infoSource.textContent = 'Metric dependent';
        if (infoResolution) infoResolution.textContent = 'Metric dependent';
      }
      if (datasetStatus) datasetStatus.closest('.reef-survey-mock-explanation')?.toggleAttribute('hidden', !isObservationProvider);
    }

    async function loadRaster(state) {
      if (!state.promise) {
        state.promise = providers.select(state.id)
          ? providers.load().then(result => {
            if (!result || result.kind !== providerApi.PROVIDER_KINDS.RASTER_CONDITION || !result.raster) throw new TypeError('NOAA raster provider returned unsupported data.');
            state.metadata = result.raster;
            return state.metadata;
          }).catch(error => { state.promise = null; throw error; })
          : Promise.reject(new Error('NOAA raster provider is not registered.'));
      }
      await state.promise;
      // A previously selected provider can finish loading after a newer metric;
      // only the current provider is allowed to replace the shared legend.
      if (activeProviderId === state.id) updateRasterLegend(state);
      if (active && activeProviderId === state.id) createRasterLayer(state)?.addTo(map);
    }

    function loadTemporalResolver() {
      if (!temporalResolverPromise) {
        temporalResolverPromise = (typeof module === 'object' && module.exports
          ? Promise.resolve(require('./reef-survey-temporal-resolver.js'))
          : import('./reef-survey-temporal-resolver.js').then(() => root.DiveAtlasReefSurveyTemporalResolver));
      }
      return temporalResolverPromise;
    }

    function displayRows() {
      const definition = metricDefinitions[metric];
      const providerMetric = definition?.siteLevelDisplay === true && definition.providerId === activeProviderId;
      return (providerMetric || (displayModeValue === DISPLAY_MODES.SITE_LATEST_AVAILABLE && definition?.schemaMetric))
        ? siteObservations.map(site => ({ ...site, record: site.resolvedRecords[metric] || site.record }))
        : records.map(record => ({ key: `event:${record.id}`, record, resolutions: null, metricValues: null }));
    }

    function popupForRow(row) {
      const definition = metricDefinitions[metric];
      if (row.resolutions && typeof definition?.popupMarkup === 'function' && sourceMetadata) return definition.popupMarkup(row, definition, sourceMetadata);
      return row.resolutions ? sitePopupMarkup(row, metric, metricDefinitions) : popupMarkup(row.record, metric, metricDefinitions);
    }

    function ageDateForRow(row) {
      if (!row.resolutions) return row.record.survey.date;
      const result = row.resolutions[metric];
      return result && result.status === 'unique' ? result.observationDate : null;
    }

    function updateLegend() {
      const definition = metricDefinitions[metric];
      if (typeof definition.legendMarkup === 'function') {
        legend.innerHTML = definition.legendMarkup(definition);
        return;
      }
      const stops = definition.colors.map((color, index) => `${color} ${index * 25}%`).join(', ');
      legend.innerHTML = `<div class="reef-survey-legend-title">${definition.label} (%) <span>Survey marker colors</span></div><div class="reef-survey-gradient" style="background:linear-gradient(90deg,${stops})" role="img" aria-label="${definition.label} marker color scale from 0 to 100 percent"></div><div class="reef-survey-legend-scale"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>`;
    }

    function refreshMarker(marker, row) {
      const value = row.metricValues && Object.prototype.hasOwnProperty.call(row.metricValues, metric)
        ? row.metricValues[metric]
        : recordMetric(row.record, metric, metricDefinitions);
      marker.setStyle({ fillColor: metricColor(metric, value, metricDefinitions), fillOpacity: surveyAgeOpacity(ageDateForRow(row), new Date()) });
      marker.setPopupContent(popupForRow(row));
    }

    function renderMarkers() {
      const rows = displayRows();
      const existing = new Map(markerKeys.map((key, index) => [key, markers[index]]));
      const nextMarkers = [];
      const nextKeys = [];
      const referenceDate = new Date();
      for (const row of rows) {
        let marker = existing.get(row.key);
        if (!marker) {
          const value = row.metricValues && Object.prototype.hasOwnProperty.call(row.metricValues, metric)
            ? row.metricValues[metric]
            : recordMetric(row.record, metric, metricDefinitions);
          marker = L.circleMarker([row.record.location.lat, row.record.location.lon], {
            renderer, radius: 5, color: '#fff', weight: 1, fillColor: metricColor(metric, value, metricDefinitions),
            fillOpacity: surveyAgeOpacity(ageDateForRow(row), referenceDate), bubblingMouseEvents: false
          });
          const popupContent = popupForRow(row);
          const popupOptions = { className: 'reef-survey-condition-popup' };
          if (bindPopup) bindPopup(marker, popupContent, popupOptions);
          else marker.bindPopup(popupContent, { ...popupOptions, maxWidth: 330, minWidth: 330 });
          marker.on('mouseover', () => marker.setStyle({ radius: 7, weight: 1.5 }));
          marker.on('mouseout', () => marker.setStyle({ radius: 5, weight: 1 }));
          marker.on('popupopen', event => {
            event.popup._diveAtlasLayerKey = 'reef-survey-condition';
            keepPopupWithinViewport(map, event.popup);
          });
        } else {
          refreshMarker(marker, row);
        }
        nextKeys.push(row.key);
        nextMarkers.push(marker);
      }
      for (const [key, marker] of existing) if (!nextKeys.includes(key)) layer.removeLayer(marker);
      markers.splice(0, markers.length, ...nextMarkers);
      markerKeys.splice(0, markerKeys.length, ...nextKeys);
      for (const marker of markers) layer.addLayer(marker);
      if (active && rows.length) layer.addTo(map);
      else map.removeLayer(layer);
    }

    function setMetric(value) {
      const definition = metricDefinitions[value];
      if (!definition) return false;
      if (metric !== value) map.closePopup?.();
      const rasterState = rasterStateForMetric(value);
      if ((value === OCEAN_HEAT_HISTORY_METRIC || value === THERMAL_HISTORY_METRIC) && !rasterState) return false;
      metric = value;
      metricSelect.value = value;
      try { root.localStorage?.setItem(METRIC_STORAGE_KEY, value); } catch (_) {}
      if (rasterState) {
        void selectProvider(rasterState.id);
        return true;
      }
      if (definition.providerId && definition.providerId !== activeProviderId) {
        void selectProvider(definition.providerId);
        updateLegend();
        return true;
      }
      if (!observationProviderIds.has(activeProviderId) && fieldProviderId) void selectProvider(fieldProviderId);
      else if (observationProviderIds.has(activeProviderId) && activeProviderId !== (definition.providerId || fieldProviderId) && fieldProviderId) void selectProvider(fieldProviderId);
      updateLegend();
      renderMarkers();
      return true;
    }

    async function prepareSiteDisplay() {
      const resolver = await loadTemporalResolver();
      siteObservations = buildSiteObservations(records, resolver, referenceDate, metricDefinitions);
    }

    async function loadRecords(providerId = activeProviderId) {
      let state = observationStates.get(providerId);
      if (!state) {
        state = { promise: null, dataset: null, sourceMetadata: null, siteObservations: [] };
        observationStates.set(providerId, state);
      }
      if (!state.promise) {
        const provider = providers.list().find(candidate => candidate.id === providerId && candidate.kind === providerApi.PROVIDER_KINDS.FIELD_OBSERVATIONS);
        if (!provider) throw new Error('The selected Reef Condition field-observation provider is not registered.');
        state.promise = provider.load().then(async result => {
          if (!result || result.kind !== providerApi.PROVIDER_KINDS.FIELD_OBSERVATIONS || !result.dataset) {
            throw new TypeError(`The selected Reef Condition provider (${result && result.kind || 'unknown'}) is not supported by the survey marker view.`);
          }
          state.dataset = result.dataset;
          state.sourceMetadata = result.sourceMetadata || result.dataset.metadata;
          const isLocalMetricProvider = localMetricDefinitions.some(definition => definition.providerId === providerId);
          if (displayModeValue === DISPLAY_MODES.SITE_LATEST_AVAILABLE || isLocalMetricProvider) {
            const resolver = await loadTemporalResolver();
            state.siteObservations = buildSiteObservations(result.dataset.records, resolver, referenceDate, metricDefinitions);
          }
          return state;
        }).catch(error => {
          state.promise = null;
          observationStates.delete(providerId);
          if (activeProviderId === providerId) {
            records = [];
            siteObservations = [];
            sourceMetadata = null;
            markers.splice(0, markers.length);
            markerKeys.splice(0, markerKeys.length);
            layer.clearLayers?.();
            map.removeLayer(layer);
            if (datasetStatus) datasetStatus.textContent = 'Unavailable';
            if (countSummary) countSummary.textContent = '';
            if (loadError) {
              loadError.textContent = 'Survey observations are currently unavailable.';
              loadError.hidden = false;
            }
          }
          throw error;
        });
      }
      const loaded = await state.promise;
      if (activeProviderId === providerId) {
        records = loaded.dataset.records;
        siteObservations = loaded.siteObservations;
        sourceMetadata = loaded.sourceMetadata;
        if (loaded.sourceMetadata?.displayStatus) {
          if (datasetStatus) datasetStatus.textContent = loaded.sourceMetadata.displayStatus;
          if (datasetInfo) datasetInfo.textContent = loaded.sourceMetadata.displayExplanation || datasetStatusExplanation(loaded.sourceMetadata);
          const surveyCount = loaded.sourceMetadata.eventCount ?? records.length;
          const siteCount = loaded.sourceMetadata.siteCount;
          if (countSummary) countSummary.textContent = Number.isInteger(siteCount)
            ? `${surveyCount.toLocaleString('en')} surveys · ${siteCount.toLocaleString('en')} sites`
            : `${surveyCount.toLocaleString('en')} surveys`;
        } else {
          if (datasetStatus) datasetStatus.textContent = datasetStatusText(loaded.dataset.metadata);
          if (datasetInfo) datasetInfo.textContent = datasetStatusExplanation(loaded.dataset.metadata);
          if (countSummary) countSummary.textContent = `${records.length} surveys`;
        }
        updateLegend();
        renderMarkers();
      }
      return loaded.dataset.records;
    }

    async function selectProvider(id) {
      if (!providers.select(id)) return false;
      const providerChanged = activeProviderId !== id;
      if (providerChanged) {
        map.closePopup?.();
        layer.clearLayers?.();
        markers.splice(0, markers.length);
        markerKeys.splice(0, markerKeys.length);
      }
      activeProviderId = id;
      showProviderControls(id);
      map.removeLayer(layer);
      for (const state of rasterStates.values()) {
        if (state.layer) map.removeLayer(state.layer);
        if (state.clickHandler) {
          map.off?.('click', state.clickHandler);
          state.clickHandler = null;
        }
      }
      if (loadError) loadError.hidden = true;
      const rasterState = rasterStateForProvider(id);
      if (rasterState) {
        map.closePopup?.();
        if (datasetStatus) datasetStatus.textContent = 'NOAA Coral Reef Watch';
        if (countSummary) countSummary.textContent = '';
        if (rasterStatus) rasterStatus.textContent = rasterState.metric === OCEAN_HEAT_HISTORY_METRIC
          ? 'Loading NOAA ocean heat-history metadata…'
          : 'Loading NOAA thermal-history metadata…';
        try {
          await loadRaster(rasterState);
          if (activeProviderId !== rasterState.id || !active) return true;
          if (rasterStatus) rasterStatus.textContent = 'Loading NOAA history tiles…';
          rasterState.clickHandler = event => { void onRasterMapClick(rasterState, event); };
          map.on?.('click', rasterState.clickHandler);
        } catch (error) {
          if (activeProviderId !== rasterState.id) return true;
          if (datasetStatus) datasetStatus.textContent = 'Unavailable';
          if (infoSource) infoSource.textContent = rasterState.metric === OCEAN_HEAT_HISTORY_METRIC
            ? 'NOAA Marine Heatwave Watch'
            : 'NOAA Coral Reef Watch Thermal History';
          if (infoResolution) infoResolution.textContent = rasterState.metric === OCEAN_HEAT_HISTORY_METRIC
            ? `Approx. ${formatRasterDistance(25)} grid` : `Approx. ${formatRasterDistance(5)} grid`;
          if (rasterSource) rasterSource.textContent = 'NOAA';
          if (rasterLegend) rasterLegend.innerHTML = `<div class="reef-survey-legend-title">${rasterState.metric === OCEAN_HEAT_HISTORY_METRIC ? 'OCEAN HEAT HISTORY' : 'THERMAL STRESS HISTORY'}</div><div class="coral-heat-stress-history-item">Map data is temporarily unavailable.</div>`;
          if (loadError) {
            loadError.textContent = rasterState.metric === OCEAN_HEAT_HISTORY_METRIC
              ? 'NOAA ocean heat-history evidence is unavailable.'
              : 'NOAA thermal-history evidence is unavailable.';
            loadError.hidden = false;
          }
          if (rasterStatus) rasterStatus.textContent = 'Unavailable';
        }
        return true;
      }
      map.closePopup?.();
      for (const marker of markers) layer.removeLayer(marker);
      if (active) {
        try { await loadRecords(); renderMarkers(); layer.addTo(map); }
        catch (_) { /* loadRecords exposes the unavailable state in the panel. */ }
      }
      return true;
    }

    metricSelect.addEventListener('change', () => setMetric(metricSelect.value));
    updateLegend();
    period.textContent = 'Latest available';

    return Object.freeze({
      activate: async () => {
        active = true;
        const selectedMetric = metricSelect && Object.prototype.hasOwnProperty.call(metricDefinitions, metricSelect.value)
          ? metricSelect.value
          : DEFAULT_METRIC;
        metric = selectedMetric;
        const selectedProviderId = rasterStateForMetric(selectedMetric)?.id ||
          metricDefinitions[selectedMetric]?.providerId || fieldProviderId;
        if (selectedProviderId && selectedProviderId !== activeProviderId) {
          await selectProvider(selectedProviderId);
          return;
        }
        showProviderControls(activeProviderId);
        if (selectedRasterState()) await selectProvider(activeProviderId);
        else {
          await loadRecords();
          if (loadError) loadError.hidden = true;
          if (active) layer.addTo(map);
        }
      },
      deactivate: () => { active = false; for (const state of rasterStates.values()) { if (state.clickHandler) map.off?.('click', state.clickHandler); state.clickHandler = null; if (state.layer) map.removeLayer(state.layer); } map.removeLayer(layer); },
      setMetric,
      refreshDisplayUnits: () => {
        updateRasterLegend(selectedRasterState());
        const state = selectedRasterState();
        if (state && !state.metadata && rasterResolution) {
          rasterResolution.textContent = formatRasterDistance(state.metric === OCEAN_HEAT_HISTORY_METRIC ? 25 : 5);
        }
        if (lastRasterPopup?.popup.isOpen?.()) {
          lastRasterPopup.popup.setContent(rasterPopupMarkup(lastRasterPopup.state, lastRasterPopup.sample));
          lastRasterPopup.popup.update?.();
        }
      },
      refreshLanguage: () => {
        if (metricSelect) {
          metricSelect.setAttribute('aria-label', translate('reefMetric'));
          const options = metricSelect.options || [];
          if (options[0]) options[0].textContent = translate('reefOceanTitle');
          if (options[1]) options[1].textContent = translate('reefThermalTitle');
        }
        const state = selectedRasterState();
        if (state?.metadata) updateRasterLegend(state);
        else if (state) showProviderControls(state.id);
        if (rasterNote && state) rasterNote.textContent = translate(state.metric === OCEAN_HEAT_HISTORY_METRIC ? 'reefOceanNote' : 'reefThermalNote');
        if (lastRasterPopup?.popup.isOpen?.()) {
          lastRasterPopup.popup.setContent(rasterPopupMarkup(lastRasterPopup.state, lastRasterPopup.sample));
          lastRasterPopup.popup.update?.();
        }
      },
      selectProvider,
      setDisplayMode: async value => {
        if (!Object.values(DISPLAY_MODES).includes(value)) return false;
        if (value === DISPLAY_MODES.SITE_LATEST_AVAILABLE) await prepareSiteDisplay();
        displayModeValue = value;
        renderMarkers();
        return true;
      },
      get records() { return records.slice(); },
      get markers() { return markers.slice(); },
      get markerKeys() { return markerKeys.slice(); },
      get siteObservations() { return siteObservations.slice(); },
      get sourceMetadata() { return sourceMetadata; },
      openSourceSitePopup: (sourceSiteId, sourceProvider = null) => {
        const provider = sourceProvider || records.find(record => record.location.sourceSiteId === sourceSiteId)?.provenance?.provider;
        const key = `site:${JSON.stringify([provider, sourceSiteId])}`;
        const marker = markers[markerKeys.indexOf(key)];
        if (!marker || !map.hasLayer(layer)) return false;
        marker.openPopup();
        return true;
      },
      get metric() { return metric; },
      get visible() { const state = selectedRasterState(); return state ? Boolean(state.layer && map.hasLayer(state.layer)) : map.hasLayer(layer); },
      get selectedProviderId() { return activeProviderId; },
      get rasterMetadata() { return selectedRasterState()?.metadata || null; },
      get surveyLayerVisible() { return map.hasLayer(layer); }
    });
  }

  return Object.freeze({ METRICS, DEFAULT_METRIC, DISPLAY_MODES, metricBand, metricColor, surveyAgeOpacity, formatPercentage, recordMetric, popupMarkup, thermalSeverity, thermalHistoryTimeline, thermalHistoryPopupMarkup, oceanHeatHistoryPopupMarkup, decodeOceanHeatQueryRecord, formatObservationDate, formatEvidenceAge, buildSiteObservations, sitePopupMarkup, datasetStatusText, datasetStatusExplanation, createReefSurveyConditionView });
});
