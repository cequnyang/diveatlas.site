#!/usr/bin/env node
'use strict';

// Validate the existing NRMN spatial estimator against withheld survey sites.
// This is diagnostic only; it does not write or alter production map values.
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'reports');
const SUPPORT_KM = 2500;
const DECAY_KM = 250;
const MIN_SITES = 3;
const MIN_EFFECTIVE = 2.5;
const BUCKET = 5;
const RADII = [25, 50, 100, 250, 500, 750, 1000, 1500, 2000, 2500];
const DISTANCE_BANDS = [0, 25, 50, 100, 250, 500, 1000, 1500, 2000, 2500, Infinity];

function normLng(lng) { return ((lng + 180) % 360 + 360) % 360 - 180; }
function rad(n) { return n * Math.PI / 180; }
function distance(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function blockKey(p) { return `${Math.floor((p.lat + 90) / 5)}:${Math.floor((normLng(p.lng) + 180) / 5)}`; }
function addIndex(index, point) {
  const y = Math.floor((point.lat + 90) / BUCKET), x = Math.floor((normLng(point.lng) + 180) / BUCKET);
  const key = `${y}:${x}`;
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(point);
}
function near(index, target, radius) {
  const latR = radius / 110.574;
  const lngR = Math.min(180, radius / Math.max(11.1, 111.32 * Math.cos(rad(target.lat))));
  const minY = Math.max(0, Math.floor((Math.max(-90, target.lat - latR) + 90) / BUCKET));
  const maxY = Math.min(35, Math.floor((Math.min(90, target.lat + latR) + 90) / BUCKET));
  const centerX = Math.floor((normLng(target.lng) + 180) / BUCKET);
  const span = 360 / BUCKET;
  const offsets = lngR >= 180 ? Array.from({ length: span }, (_, i) => i - centerX)
    : Array.from({ length: Math.ceil(2 * lngR / BUCKET) + 2 }, (_, i) => i - Math.ceil(lngR / BUCKET));
  const xs = [...new Set(offsets.map(o => ((centerX + o) % span + span) % span))];
  const found = [];
  for (let y = minY; y <= maxY; y++) for (const x of xs) for (const p of index.get(`${y}:${x}`) || []) {
    const d = distance(target, p);
    if (d <= radius) found.push({ point: p, distanceKm: d });
  }
  return found;
}
function effectiveCount(candidates) {
  let sum = 0, sum2 = 0;
  for (const { distanceKm: d } of candidates) {
    const w = 1 / (1 + (d / DECAY_KM) ** 3);
    sum += w; sum2 += w * w;
  }
  return sum2 ? sum * sum / sum2 : 0;
}
function estimate(candidates, radius) {
  const sources = candidates.filter(c => c.distanceKm <= radius);
  const neff = effectiveCount(sources);
  if (sources.length < MIN_SITES || neff < MIN_EFFECTIVE) return null;
  let sw = 0, sy = 0;
  for (const { point, distanceKm: d } of sources) {
    const w = 1 / (1 + (d / DECAY_KM) ** 3);
    sw += w; sy += w * point.value;
  }
  return { value: sy / sw, count: sources.length, effective: neff };
}
function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b), m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}
function average(values) { return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null; }
function ranks(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = Array(values.length); let i = 0;
  while (i < order.length) {
    let j = i + 1;
    while (j < order.length && order[j][0] === order[i][0]) j++;
    const rank = (i + j - 1) / 2 + 1;
    for (let k = i; k < j; k++) out[order[k][1]] = rank;
    i = j;
  }
  return out;
}
function correlation(xs, ys) {
  if (xs.length < 3) return null;
  const rx = ranks(xs), ry = ranks(ys), mx = average(rx), my = average(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < rx.length; i++) { const x = rx[i] - mx, y = ry[i] - my; num += x * y; dx += x * x; dy += y * y; }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}
function scores(rows) {
  const rawErr = rows.map(r => r.predicted - r.actual);
  const abs = rawErr.map(Math.abs);
  const logErr = rows.map(r => Math.log1p(Math.max(0, r.predicted)) - Math.log1p(Math.max(0, r.actual)));
  const nonzero = rows.filter(r => r.actual > 0);
  return { n: rows.length,
    maeFishPer100m2: average(abs), rmseFishPer100m2: rows.length ? Math.sqrt(average(rawErr.map(e => e * e))) : null,
    medianAbsoluteErrorFishPer100m2: median(abs), biasFishPer100m2: average(rawErr),
    maeLog1p: average(logErr.map(Math.abs)), rmseLog1p: rows.length ? Math.sqrt(average(logErr.map(e => e * e))) : null,
    medianAbsolutePercentErrorNonzero: nonzero.length ? median(nonzero.map(r => Math.abs(r.predicted - r.actual) / r.actual)) * 100 : null,
    spearman: correlation(rows.map(r => r.predicted), rows.map(r => r.actual)) };
}

async function main() {
  const snapshot = JSON.parse(zlib.gunzipSync(await fs.readFile(path.join(ROOT, 'data', 'fish_map_units.json.gz'))).toString('utf8'));
  const groups = new Map();
  for (const row of snapshot.rows || []) {
    const lat = Number(row[0]), lng = normLng(Number(row[1])), value = Number(row[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(value) || value < 0) continue;
    const key = `${lat.toFixed(5)}:${lng.toFixed(5)}`;
    const g = groups.get(key) || { lat, lng, total: 0, n: 0 };
    g.total += value; g.n++; groups.set(key, g);
  }
  const sites = [...groups.values()].map(g => ({ lat: g.lat, lng: g.lng, value: g.total / g.n, block: blockKey(g) }));
  const index = new Map(); for (const site of sites) addIndex(index, site);
  const predictions = [];
  const blockPredictions = [];
  const baseline = median(sites.map(s => s.value));
  for (let i = 0; i < sites.length; i++) {
    const target = sites[i], neighbors = near(index, target, SUPPORT_KM).filter(x => x.point !== target);
    const nearest = neighbors.length ? neighbors.reduce((a, b) => a.distanceKm < b.distanceKm ? a : b).distanceKm : null;
    for (const radius of RADII) {
      const pred = estimate(neighbors, radius);
      if (pred) predictions.push({ radius, actual: target.value, predicted: pred.value, nearestKm: nearest,
        sources: pred.count, effective: pred.effective, block: target.block });
    }
    // Spatial holdout removes every source in the target's 5-degree block.
    // Candidate support is still tested out to the production 2,500 km radius.
    const heldOut = neighbors.filter(x => x.point.block !== target.block);
    const nearestBlock = heldOut.length ? heldOut.reduce((a, b) => a.distanceKm < b.distanceKm ? a : b).distanceKm : null;
    for (const radius of RADII) {
      const pred = estimate(heldOut, radius);
      if (pred) blockPredictions.push({ radius, actual: target.value, predicted: pred.value, nearestKm: nearestBlock,
        sources: pred.count, effective: pred.effective, block: target.block });
    }
  }

  const looByRadius = Object.fromEntries(RADII.map(radius => {
    const rows = predictions.filter(p => p.radius === radius);
    return [radius, { coverageSites: rows.length, coveragePercent: 100 * rows.length / sites.length,
      error: scores(rows), baselineMedian: baseline,
      baselineError: scores(rows.map(r => ({ actual: r.actual, predicted: baseline }))) }];
  }));
  const distanceBands = [];
  for (let i = 0; i < DISTANCE_BANDS.length - 1; i++) {
    const lo = DISTANCE_BANDS[i], hi = DISTANCE_BANDS[i + 1];
    const rows = predictions.filter(p => p.radius === SUPPORT_KM && p.nearestKm >= lo && p.nearestKm < hi);
    distanceBands.push({ bandKm: `${lo}-${hi === Infinity ? 'plus' : hi}`, ...scores(rows) });
  }
  const blockByDistance = [];
  for (let i = 0; i < DISTANCE_BANDS.length - 1; i++) {
    const lo = DISTANCE_BANDS[i], hi = DISTANCE_BANDS[i + 1];
    const rows = blockPredictions.filter(p => p.radius === SUPPORT_KM && p.nearestKm >= lo && p.nearestKm < hi);
    blockByDistance.push({ bandKm: `${lo}-${hi === Infinity ? 'plus' : hi}`, ...scores(rows) });
  }
  const blockByRadius = Object.fromEntries(RADII.map(radius => {
    const rows = blockPredictions.filter(p => p.radius === radius);
    return [radius, { coverageSites: rows.length, coveragePercent: 100 * rows.length / sites.length,
      error: scores(rows), baselineError: scores(rows.map(r => ({ actual: r.actual, predicted: baseline }))) }];
  }));
  const report = {
    generatedAt: new Date().toISOString(), source: snapshot.dataset, unit: snapshot.density_unit,
    retainedRows: (snapshot.rows || []).length, uniqueCoordinateSites: sites.length,
    estimator: { weighting: '1 / (1 + (distanceKm / 250)^3)', radiiKmEvaluated: RADII,
      minimumDistinctSites: MIN_SITES, minimumEffectiveSources: MIN_EFFECTIVE,
      productionRadiusKm: SUPPORT_KM, productionDirectObservationRadiusKm: 25 },
    validationDesign: {
      leaveOneSiteOut: 'Withhold all rows at one exact coordinate, predict the site mean from all other coordinate sites. This can still be optimistic under spatial autocorrelation.',
      spatialBlockHoldout: 'Withhold all sites in the target 5-degree latitude/longitude block; predict from sites in other blocks within 2,500 km. This reduces local leakage but is not an ecological-region holdout.',
      scoreSpace: 'Errors are on the source density unit and log1p density; this validates the abundance interpolation, not downstream monthly condition score or dive suitability.',
      limitations: 'One coordinate site can contain multiple surveys; site means are treated as independent targets. The bundled snapshot does not include replicate-level variance or original sampling effort metadata.' },
    leaveOneSiteOutByRadius: looByRadius,
    leaveOneSiteOutErrorByNearestSourceDistanceAtCurrentRadius: distanceBands,
    spatialBlockHoldoutByRadius: blockByRadius,
    spatialBlockHoldout: { withheldPredictions: blockByRadius[SUPPORT_KM].coverageSites, coveragePercent: blockByRadius[SUPPORT_KM].coveragePercent,
      error: blockByRadius[SUPPORT_KM].error, baselineMedian: baseline,
      baselineError: blockByRadius[SUPPORT_KM].baselineError,
      errorByNearestSourceDistanceAtCurrentRadius: blockByDistance }
  };
  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, 'fish-density-interpolation-validation.json'), JSON.stringify(report, null, 2) + '\n');
  const fmt = n => n == null ? 'n/a' : Number(n).toFixed(3);
  let md = '# NRMN fish-density interpolation validation\n\n';
  md += `Generated ${report.generatedAt}. Diagnostic only; production assets were not changed. Source unit: **${report.unit}**.\n\n`;
  md += `Unique coordinate sites evaluated: **${sites.length.toLocaleString()}**. Exact-coordinate leave-one-out withholds all rows from each target coordinate. The second validation withholds every site in its 5-degree block.\n\n`;
  md += '## Leave-one-site-out accuracy by maximum support radius\n\n| Radius km | Held-out sites | Coverage | MAE | RMSE | Median abs. error | Bias | MAE log1p | Spearman | Baseline median MAE |\n|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n';
  for (const radius of RADII) { const row = looByRadius[radius]; md += `| ${radius} | ${row.coverageSites} | ${row.coveragePercent.toFixed(1)}% | ${fmt(row.error.maeFishPer100m2)} | ${fmt(row.error.rmseFishPer100m2)} | ${fmt(row.error.medianAbsoluteErrorFishPer100m2)} | ${fmt(row.error.biasFishPer100m2)} | ${fmt(row.error.maeLog1p)} | ${fmt(row.error.spearman)} | ${fmt(row.baselineError.maeFishPer100m2)} |\n`; }
  md += '\nErrors are fish per 100 m², except MAE log1p; all are observed site mean versus predicted weighted site mean. Baseline is the global median observed density. Radius changes both prediction support and which targets meet minimum-support requirements.\n\n';
  md += '## Error versus nearest independent source distance\n\n| Nearest source km | Sites | MAE | RMSE | Bias | MAE log1p | Median abs. % error, nonzero actuals | Spearman |\n|---|---:|---:|---:|---:|---:|---:|---:|\n';
  for (const row of distanceBands) md += `| ${row.bandKm} | ${row.n} | ${fmt(row.maeFishPer100m2)} | ${fmt(row.rmseFishPer100m2)} | ${fmt(row.biasFishPer100m2)} | ${fmt(row.maeLog1p)} | ${fmt(row.medianAbsolutePercentErrorNonzero)} | ${fmt(row.spearman)} |\n`;
  const b = report.spatialBlockHoldout;
  md += '\n## Spatial-block holdout\n\n### Accuracy by maximum support radius\n\n| Radius km | Held-out sites | Coverage | MAE | RMSE | MAE log1p | Baseline median MAE | Baseline MAE log1p |\n|---:|---:|---:|---:|---:|---:|---:|---:|\n';
  for (const radius of RADII) { const row = blockByRadius[radius]; md += `| ${radius} | ${row.coverageSites} | ${row.coveragePercent.toFixed(1)}% | ${fmt(row.error.maeFishPer100m2)} | ${fmt(row.error.rmseFishPer100m2)} | ${fmt(row.error.maeLog1p)} | ${fmt(row.baselineError.maeFishPer100m2)} | ${fmt(row.baselineError.maeLog1p)} |\n`; }
  md += `\nCoverage at 2,500 km: **${b.withheldPredictions} / ${sites.length} sites (${b.coveragePercent.toFixed(1)}%)**. Model MAE: **${fmt(b.error.maeFishPer100m2)} fish/100 m²**, RMSE **${fmt(b.error.rmseFishPer100m2)}**, log1p MAE **${fmt(b.error.maeLog1p)}**; global-median baseline MAE: **${fmt(b.baselineError.maeFishPer100m2)}**.\n\n`;
  md += '| Nearest training site km | Sites | MAE | RMSE | Bias | MAE log1p | Spearman |\n|---|---:|---:|---:|---:|---:|---:|\n';
  for (const row of b.errorByNearestSourceDistanceAtCurrentRadius) md += `| ${row.bandKm} | ${row.n} | ${fmt(row.maeFishPer100m2)} | ${fmt(row.rmseFishPer100m2)} | ${fmt(row.biasFishPer100m2)} | ${fmt(row.maeLog1p)} | ${fmt(row.spearman)} |\n`;
  md += '\n## Interpretation and radius decision\n\nUse the spatial-block holdout as the more conservative estimate; leave-one-out results are likely optimistic. A larger radius is justified only where it increases valid-site coverage without materially worsening held-out log error and against the median baseline. Inspect the tables and distance-band trend before recommending a production maximum; this report does not change the 2,500 km setting. Scores are validated in source-density space, not the final relative percentile or suitability scale.\n\n';
  md += `## Limitations\n\n${report.validationDesign.limitations} Spatial blocking uses 5-degree bins, so adjacent blocks can still be near one another; nearest-source distance bands expose this. Results are global and can hide regional bias. No external/repeated temporal validation is possible from the bundled processed snapshot.\n`;
  await fs.writeFile(path.join(OUT, 'fish-density-interpolation-validation.md'), md);
  console.log(JSON.stringify({ report: 'reports/fish-density-interpolation-validation.md', json: 'reports/fish-density-interpolation-validation.json', sites: sites.length,
    looAt2500: looByRadius[2500], spatialBlockCoverage: b.coveragePercent, spatialBlockError: b.error }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
