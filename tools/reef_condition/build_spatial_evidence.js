#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const schema = require('../../js/reef-survey-schema.js');
const temporal = require('../../js/reef-survey-temporal-resolver.js');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_OUTPUT = path.join(ROOT, 'data/.build/reef_condition/spatial');
const METRIC = 'liveCoralCover';
const RESOLUTIONS_KM = [2, 5, 10];

function parseArgs(argv) {
  const options = { input: null, outputDirectory: DEFAULT_OUTPUT, referenceDate: new Date().toISOString().slice(0, 10), resolutionsKm: RESOLUTIONS_KM };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i + 1];
    if (argv[i] === '--input') options.input = value, i += 1;
    else if (argv[i] === '--output-directory') options.outputDirectory = path.resolve(value), i += 1;
    else if (argv[i] === '--reference-date') options.referenceDate = value, i += 1;
    else if (argv[i] === '--resolutions-km') options.resolutionsKm = value.split(',').map(Number), i += 1;
    else if (argv[i] === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!options.help && !options.input) throw new Error('--input is required.');
  if (!schema.isValidIsoDate(options.referenceDate)) throw new Error('--reference-date must be a valid ISO date.');
  if (!options.resolutionsKm.length || options.resolutionsKm.some(km => !Number.isFinite(km) || km <= 0)) throw new Error('--resolutions-km must contain positive numbers.');
  const resolvedOutput = path.resolve(options.outputDirectory);
  const buildRoot = path.join(ROOT, 'data/.build/reef_condition');
  if (resolvedOutput !== buildRoot && !resolvedOutput.startsWith(`${buildRoot}${path.sep}`)) throw new Error('Output must remain under data/.build/reef_condition/.');
  return options;
}

function readRecords(inputPath) {
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const records = Array.isArray(input) ? input : input && input.records;
  if (!Array.isArray(records)) throw new TypeError('Input must be a record array or an object with a records array.');
  records.forEach((record, index) => {
    const validation = schema.validateRecord(record);
    if (!validation.valid) throw new TypeError(`Invalid canonical record at index ${index}: ${validation.errors.join('; ')}`);
  });
  return records;
}

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function longitudeDeltaRadians(lon, centerLon) {
  let delta = (lon - centerLon) * Math.PI / 180;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}

function project(lon, lat, centerLon) {
  const radius = 6371008.8;
  return { x: radius * longitudeDeltaRadians(lon, centerLon), y: radius * Math.sin(lat * Math.PI / 180) };
}

function cellForPoint(point, size) {
  const fractionalR = (2 / 3 * point.y) / size;
  const fractionalQ = (point.x / Math.sqrt(3) - point.y / 3) / size;
  const x = fractionalQ;
  const z = fractionalR;
  const y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: rz };
}

function inverseProject(point, centerLon) {
  const radius = 6371008.8;
  const longitude = ((centerLon + point.x / radius * 180 / Math.PI + 540) % 360) - 180;
  const latitude = Math.asin(Math.max(-1, Math.min(1, point.y / radius))) * 180 / Math.PI;
  return [longitude, latitude];
}

function hexGeometry(q, r, size, centerLon) {
  const center = { x: size * Math.sqrt(3) * (q + r / 2), y: size * 1.5 * r };
  const ring = [];
  for (let i = 0; i <= 6; i += 1) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    ring.push(inverseProject({ x: center.x + size * Math.cos(angle), y: center.y + size * Math.sin(angle) }, centerLon));
  }
  ring[ring.length - 1] = [...ring[0]];
  return { type: 'Polygon', coordinates: [ring] };
}

function summarizeSites(records, referenceDate) {
  const groups = temporal.groupEventsBySourceSite(records);
  const resolved = [];
  const states = { unique: 0, missing: 0, ambiguous: 0 };
  for (const group of groups) {
    if (group.identityType !== 'SOURCE_ID' || !group.sourceSiteId) throw new TypeError('Spatial evidence aggregation requires sourceSiteId for every record; names and coordinates are not used to merge sites.');
    const result = temporal.resolveLatestAvailableMetric(group.events, METRIC, referenceDate);
    states[result.status] += 1;
    if (result.status !== 'unique') continue;
    const event = group.events.find(item => (item.provenance.sourceRecordId || item.id) === result.sourceEventId);
    if (!event) throw new Error(`Resolved source event ${result.sourceEventId} was not found in its site group.`);
    resolved.push({
      provider: group.provider,
      sourceSiteId: group.sourceSiteId,
      sourceRecordId: event.provenance.sourceRecordId || event.id,
      siteName: event.location.siteName,
      lat: event.location.lat,
      lon: event.location.lon,
      value: result.value,
      observationDate: result.observationDate,
      ageDays: result.ageDays
    });
  }
  return { resolved, states, groupedSiteCount: groups.length };
}

function datasetCoverage(records, referenceDate) {
  const grouped = temporal.groupEventsBySourceSite(records);
  const eventMetrics = {};
  for (const metric of ['liveCoralCover', 'macroalgaeCover', 'bleaching']) {
    const states = { unique: 0, missing: 0, ambiguous: 0 };
    for (const record of records) {
      const count = schema.getMetricCandidates(record, metric).length;
      states[count === 0 ? 'missing' : count === 1 ? 'unique' : 'ambiguous'] += 1;
    }
    eventMetrics[metric] = states;
  }
  const siteMetrics = {};
  for (const metric of ['liveCoralCover', 'macroalgaeCover']) {
    siteMetrics[metric] = { unique: 0, missing: 0, ambiguous: 0 };
    for (const group of grouped) {
      const result = temporal.resolveLatestAvailableMetric(group.events, metric, referenceDate);
      siteMetrics[metric][result.status] += 1;
    }
  }
  const countries = {};
  for (const record of records) {
    const country = record.location.country || 'Unknown';
    countries[country] = (countries[country] || 0) + 1;
  }
  const countrySites = {};
  for (const group of grouped) {
    const country = group.events[0].location.country || 'Unknown';
    countrySites[country] = (countrySites[country] || 0) + 1;
  }
  const lats = records.map(record => record.location.lat);
  const lons = records.map(record => (record.location.lon + 360) % 360).sort((a, b) => a - b);
  let largestGap = -1, gapIndex = 0;
  for (let i = 0; i < lons.length; i += 1) {
    const next = i === lons.length - 1 ? lons[0] + 360 : lons[i + 1];
    if (next - lons[i] > largestGap) largestGap = next - lons[i], gapIndex = i;
  }
  const west = lons.length ? ((lons[(gapIndex + 1) % lons.length] + 540) % 360) - 180 : null;
  const east = lons.length ? ((lons[gapIndex] + 540) % 360) - 180 : null;
  const dates = records.map(record => record.survey.date).filter(Boolean).sort();
  return {
    eventCount: records.length,
    uniqueSites: grouped.length,
    recordsMissingSourceSiteId: records.filter(record => !record.location.sourceSiteId).length,
    countryEventCounts: Object.fromEntries(Object.entries(countries).sort(([a], [b]) => a.localeCompare(b))),
    countrySiteCounts: Object.fromEntries(Object.entries(countrySites).sort(([a], [b]) => a.localeCompare(b))),
    geographicBounds: {
      latitude: { min: Math.min(...lats), max: Math.max(...lats) },
      longitudeMinimalArc: { west, east, spanDegrees: lons.length ? 360 - largestGap : null }
    },
    dateRange: { from: dates[0] || null, to: dates.at(-1) || null },
    eventMetricAvailability: eventMetrics,
    siteMetricResolution: siteMetrics,
    bleachingTemporalResolution: 'unsupported'
  };
}

function svgPreview(collection) {
  const width = 1200, height = 620, left = 58, right = 24, top = 24, bottom = 45;
  const mapWidth = width - left - right, mapHeight = height - top - bottom;
  const x = lon => left + (lon + 180) / 360 * mapWidth;
  const y = lat => top + (90 - lat) / 180 * mapHeight;
  const lines = [];
  for (let lon = -150; lon <= 180; lon += 30) {
    lines.push(`<path d="M${x(lon)} ${top}V${top + mapHeight}" stroke="#d6dee4" stroke-width="1"/><text x="${x(lon) + 3}" y="${top + mapHeight + 16}" font-size="10" fill="#536575">${lon}°</text>`);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    lines.push(`<path d="M${left} ${y(lat)}H${left + mapWidth}" stroke="#d6dee4" stroke-width="1"/><text x="6" y="${y(lat) + 4}" font-size="10" fill="#536575">${lat}°</text>`);
  }
  const polygons = [];
  const symbols = [];
  for (const feature of collection.features) {
    const ring = feature.geometry.coordinates[0].slice(0, -1);
    let previous = ring[0][0];
    const unwrapped = ring.map(([lon, lat], index) => {
      if (index > 0) {
        while (lon - previous > 180) lon -= 360;
        while (lon - previous < -180) lon += 360;
      }
      previous = lon;
      return [lon, lat];
    });
    const value = feature.properties.summaryValue;
    const t = Math.max(0, Math.min(1, value / 100));
    const red = Math.round(232 - 190 * t), green = Math.round(244 - 116 * t), blue = Math.round(220 - 169 * t);
    const fill = `rgb(${red},${green},${blue})`;
    for (const shift of [-360, 0, 360]) {
      const points = unwrapped.map(([lon, lat]) => `${x(lon + shift)},${y(lat)}`).join(' ');
      polygons.push(`<polygon points="${points}" fill="${fill}" stroke="#294b3a" stroke-width="1.2"><title>${feature.id}: ${value}% live coral cover; ${feature.properties.evidenceCount} site observations; observed ${feature.properties.oldestObservationDate || 'undated'} to ${feature.properties.lastObservationDate || 'undated'}</title></polygon>`);
    }
    const centerLon = unwrapped.reduce((sum, point) => sum + point[0], 0) / unwrapped.length;
    const centerLat = unwrapped.reduce((sum, point) => sum + point[1], 0) / unwrapped.length;
    for (const shift of [-360, 0, 360]) {
      symbols.push(`<circle cx="${x(centerLon + shift)}" cy="${y(centerLat)}" r="5" fill="${fill}" stroke="#173d2a" stroke-width="1.5"><title>${feature.id}: ${value}% live coral cover; ${feature.properties.evidenceCount} site observations</title></circle>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f5f8fa"/><text x="${left}" y="17" font-family="Arial,sans-serif" font-size="15" font-weight="600" fill="#233645">Live coral survey evidence · ${collection.grid.circumradiusKm} km hex radius</text><defs><linearGradient id="cover" x1="0" x2="1"><stop offset="0%" stop-color="rgb(232,244,220)"/><stop offset="100%" stop-color="rgb(42,128,51)"/></linearGradient><clipPath id="map"><rect x="${left}" y="${top}" width="${mapWidth}" height="${mapHeight}"/></clipPath></defs><g>${lines.join('')}</g><g clip-path="url(#map)">${polygons.join('')}${symbols.join('')}</g><rect x="${left}" y="${top}" width="${mapWidth}" height="${mapHeight}" fill="none" stroke="#8494a0"/><text x="${left}" y="${height - 9}" font-family="Arial,sans-serif" font-size="11" fill="#536575">Survey cells are enlarged for visibility · empty regions mean no resolved observation, not zero coral cover</text><text x="870" y="${height - 25}" font-family="Arial,sans-serif" font-size="11" fill="#394c59">Live coral cover (%)</text><rect x="1008" y="${height - 36}" width="145" height="9" rx="4" fill="url(#cover)"/><text x="1004" y="${height - 8}" font-family="Arial,sans-serif" font-size="10" fill="#536575">0</text><text x="1140" y="${height - 8}" font-family="Arial,sans-serif" font-size="10" fill="#536575">100</text></svg>`;
}

function aggregateAtResolution(observations, resolutionKm, referenceDate) {
  if (!observations.length) return { collection: { type: 'FeatureCollection', schemaVersion: 1, metric: METRIC, referenceDate, features: [] }, stats: { resolutionKm, resolvedObservations: 0, occupiedCells: 0, eligibleGridCells: 0, emptyAreaRatio: null, observationsPerOccupiedCell: { min: null, median: null, max: null } } };
  const centerLon = Math.atan2(
    observations.reduce((sum, item) => sum + Math.sin(item.lon * Math.PI / 180), 0),
    observations.reduce((sum, item) => sum + Math.cos(item.lon * Math.PI / 180), 0)
  ) * 180 / Math.PI;
  const size = resolutionKm * 1000;
  const byCell = new Map();
  const projected = observations.map(item => ({ ...item, projected: project(item.lon, item.lat, centerLon) }));
  for (const item of projected) {
    const { q, r } = cellForPoint(item.projected, size);
    const cellId = `hex-r${resolutionKm}km-q${q}-r${r}`;
    if (!byCell.has(cellId)) byCell.set(cellId, { cellId, q, r, observations: [] });
    byCell.get(cellId).observations.push(item);
  }
  const features = [...byCell.values()].sort((a, b) => a.cellId.localeCompare(b.cellId)).map(cell => {
    const items = cell.observations;
    const dates = items.map(item => item.observationDate).filter(Boolean).sort();
    const lastObservationDate = dates.at(-1) || null;
    const oldestObservationDate = dates[0] || null;
    const ageDays = lastObservationDate
      ? Math.floor((Date.parse(`${referenceDate}T00:00:00Z`) - Date.parse(`${lastObservationDate}T00:00:00Z`)) / 86400000)
      : null;
    return {
      type: 'Feature', id: cell.cellId, geometry: hexGeometry(cell.q, cell.r, size, centerLon),
      properties: {
        schemaVersion: 1, cellId: cell.cellId, metric: METRIC, summaryValue: median(items.map(item => item.value)),
        evidenceCount: items.length, sourceSiteCount: new Set(items.map(item => `${item.provider}\u0000${item.sourceSiteId}`)).size,
        lastObservationDate, oldestObservationDate, ageDays,
        sourceSiteIds: [...new Set(items.map(item => item.sourceSiteId))].sort(),
        sourceRecordIds: [...new Set(items.map(item => item.sourceRecordId))].sort()
      }
    };
  });

  const minX = Math.min(...projected.map(item => item.projected.x));
  const maxX = Math.max(...projected.map(item => item.projected.x));
  const minY = Math.min(...projected.map(item => item.projected.y));
  const maxY = Math.max(...projected.map(item => item.projected.y));
  const envelopeArea = (maxX - minX + 2 * size) * (maxY - minY + 2 * size);
  const hexArea = 3 * Math.sqrt(3) / 2 * size * size;
  const eligibleGridCells = Math.max(features.length, Math.ceil(envelopeArea / hexArea));
  const counts = features.map(feature => feature.properties.evidenceCount).sort((a, b) => a - b);
  return {
    collection: { type: 'FeatureCollection', schemaVersion: 1, metric: METRIC, referenceDate, grid: { type: 'pointy-hex', circumradiusKm: resolutionKm, projection: 'Lambert cylindrical equal-area; longitude centered on input circular mean' }, features },
    stats: {
      resolutionKm, resolvedObservations: observations.length, occupiedCells: features.length, eligibleGridCells,
      emptyAreaRatio: eligibleGridCells ? Math.max(0, 1 - features.length / eligibleGridCells) : null,
      observationsPerOccupiedCell: counts.length ? { min: counts[0], median: median(counts), max: counts[counts.length - 1] } : { min: null, median: null, max: null }
    }
  };
}

function writeOutputs(options, records) {
  const started = process.hrtime.bigint();
  const { resolved, states, groupedSiteCount } = summarizeSites(records, options.referenceDate);
  const resolveMilliseconds = Number(process.hrtime.bigint() - started) / 1e6;
  fs.mkdirSync(options.outputDirectory, { recursive: true });
  const experiments = options.resolutionsKm.map(resolutionKm => aggregateAtResolution(resolved, resolutionKm, options.referenceDate));
  for (const { collection, stats } of experiments) {
    const filename = `reef-survey-evidence-live-coral-r${stats.resolutionKm}km.geojson.gz`;
    const json = `${JSON.stringify(collection)}\n`;
    fs.writeFileSync(path.join(options.outputDirectory, filename), zlib.gzipSync(Buffer.from(json), { level: 9, mtime: 0 }));
    fs.writeFileSync(path.join(options.outputDirectory, `reef-survey-evidence-live-coral-r${stats.resolutionKm}km-preview.svg`), svgPreview(collection));
  }
  const report = {
    schemaVersion: 1, metric: METRIC, referenceDate: options.referenceDate,
    inputRecordCount: records.length, groupedSiteCount, resolverStates: states, resolvedSiteObservations: resolved.length,
    coverage: datasetCoverage(records, options.referenceDate),
    resolutions: experiments.map(item => item.stats),
    timingsMs: { groupingAndTemporalResolution: resolveMilliseconds },
    scopeNote: 'Empty-area ratio estimates possible cells from the projected site bounding-box area expanded by one cell radius; it is not reef-habitat coverage.'
  };
  fs.writeFileSync(path.join(options.outputDirectory, 'reef-survey-evidence-live-coral-resolution-comparison.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write('Usage: node tools/reef_condition/build_spatial_evidence.js --input <canonical-dataset.json> [--reference-date YYYY-MM-DD] [--resolutions-km 2,5,10]\n');
    } else {
      const report = writeOutputs(options, readRecords(options.input));
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { ROOT, METRIC, median, readRecords, project, cellForPoint, hexGeometry, summarizeSites, datasetCoverage, aggregateAtResolution, parseArgs, writeOutputs };
