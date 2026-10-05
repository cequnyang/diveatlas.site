import { resolveCoefficients } from './model-loader.js';
import { predictHarmonic } from './astronomy.js';
import { timezoneAt } from './timezone.js';

const STEP_MS = 10 * 60 * 1000;
const formatParts = (timestamp, timezone) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
}).formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));

function offsetMinutes(timestamp, timezone) {
  const parts = formatParts(timestamp, timezone);
  const representedUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return Math.round((representedUtc - Math.floor(timestamp / 60000) * 60000) / 60000);
}

function localMidnightUtc(year, month, day, timezone) {
  const target = Date.UTC(year, month - 1, day);
  let timestamp = target;
  for (let attempt = 0; attempt < 4; attempt += 1) timestamp = target - offsetMinutes(timestamp, timezone) * 60000;
  return timestamp;
}

function localDayBounds(timestamp, timezone) {
  const parts = formatParts(timestamp, timezone);
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return [localMidnightUtc(year, month, day, timezone), localMidnightUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timezone)];
}

function extrema(series) {
  const results = [];
  for (let index = 1; index < series.length - 1; index += 1) {
    const before = series[index - 1].level_m, current = series[index].level_m, after = series[index + 1].level_m;
    if (current >= before && current > after) results.push({ kind: 'high', ...series[index] });
    else if (current <= before && current < after) results.push({ kind: 'low', ...series[index] });
  }
  return results;
}

export function findTideExtrema(series) { return extrema(series); }

export async function predictAt(lat, lon, utcTimestamp = Date.now()) {
  const startedAt = performance.now();
  let resolved, timezone;
  try {
    [resolved, timezone] = await Promise.all([resolveCoefficients(lat, lon), timezoneAt(lat, lon)]);
  } catch {
    return null;
  }
  const assetsReadyAt = performance.now();
  if (!resolved || !timezone || !Number.isFinite(utcTimestamp)) return null;
  const at = Math.floor(utcTimestamp / STEP_MS) * STEP_MS;
  const startUtc = at, endUtc = at + 24 * 60 * 60 * 1000;
  const predict = time => predictHarmonic(resolved.coefficients, time);
  const series = [];
  for (let time = startUtc; time <= endUtc; time += STEP_MS) {
    const level_m = predict(time);
    if (!Number.isFinite(level_m)) return null;
    series.push({ time_utc: time, level_m });
  }
  const turning = extrema(series);
  const nextExtrema = [];
  for (const kind of ['high', 'low']) {
    const item = turning.find(point => point.kind === kind && point.time_utc > utcTimestamp);
    if (item) nextExtrema.push(item);
  }
  if (nextExtrema.length !== 2) return null;
  const [dayStart, dayEnd] = localDayBounds(utcTimestamp, timezone);
  const dayValues = [];
  for (let time = dayStart; time <= dayEnd; time += 30 * 60 * 1000) dayValues.push(predict(time));
  dayValues.push(predict(dayEnd));
  const offset = offsetMinutes(utcTimestamp, timezone);
  const sign = offset < 0 ? '−' : '+';
  const abs = Math.abs(offset);
  const pad = value => String(value).padStart(2, '0');
  return {
    level_m: predict(utcTimestamp), rising: predict(utcTimestamp + 15 * 60 * 1000) > predict(utcTimestamp),
    series, start_utc: startUtc, end_utc: endUtc, extrema: nextExtrema,
    turning_points: turning.filter(point => point.time_utc > utcTimestamp),
    range_m: Math.max(...dayValues) - Math.min(...dayValues), timezone,
    utc_offset: `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`,
    confidence: resolved.confidence, location: `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`,
    model: 'EOT20', attribution: resolved.manifest.attribution, chunk: resolved.chunk,
    timing_ms: { asset_resolution: assetsReadyAt - startedAt, prediction: performance.now() - assetsReadyAt }
  };
}

export function getTideSeries(lat, lon, startUtc, hours = 24) {
  return resolveCoefficients(lat, lon).then(resolved => {
    if (!resolved || !Number.isFinite(startUtc) || !Number.isFinite(hours) || hours <= 0 || hours > 48) return null;
    const series = [];
    for (let time = startUtc, end = startUtc + hours * 3600000; time <= end; time += STEP_MS) {
      series.push({ time_utc: time, level_m: predictHarmonic(resolved.coefficients, time) });
    }
    return series.every(point => Number.isFinite(point.level_m)) ? series : null;
  }).catch(() => null);
}
