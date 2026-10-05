import { createTideVisualizationSampler } from './visualization.js?v=5';

const SCALE_STOPS = [-2, -1.2, -0.4, 0.4, 1.2, 2];
const COLOR_BIN_COUNT = 64;
const PALETTES = {
  light: ['#d9f3f8', '#a7ddeb', '#69b8dc', '#3285cc', '#1454b8', '#083a8c'],
  dark: ['#b8e1e8', '#97cee0', '#79bad6', '#5b9ac4', '#467faf', '#356890']
};
const colorTables = new Map();

function colorTable(theme) {
  if (colorTables.has(theme)) return colorTables.get(theme);
  const palette = PALETTES[theme] || PALETTES.light;
  const table = new Uint8ClampedArray(COLOR_BIN_COUNT * 4);
  const colors = palette.map(hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)));
  for (let bin = 0; bin < COLOR_BIN_COUNT; bin += 1) {
    const value = SCALE_STOPS[0] + (bin + 0.5) * (SCALE_STOPS.at(-1) - SCALE_STOPS[0]) / COLOR_BIN_COUNT;
    let stop = 0;
    while (stop < SCALE_STOPS.length - 2 && value > SCALE_STOPS[stop + 1]) stop += 1;
    const mix = (value - SCALE_STOPS[stop]) / (SCALE_STOPS[stop + 1] - SCALE_STOPS[stop]);
    const offset = bin * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      table[offset + channel] = Math.round(colors[stop][channel] + (colors[stop + 1][channel] - colors[stop][channel]) * mix);
    }
    table[offset + 3] = 245;
  }
  colorTables.set(theme, table);
  return table;
}

function sampleLocation(coords, tileSize, spacing, gutter, x, y) {
  const scale = tileSize * 2 ** coords.z;
  const worldX = (coords.x * tileSize + (x - gutter + 0.5) * spacing) / scale;
  const worldY = (coords.y * tileSize + (y - gutter + 0.5) * spacing) / scale;
  const longitude = worldX * 360 - 180;
  const latitude = Math.atan(Math.sinh(Math.PI * (1 - 2 * worldY))) * 180 / Math.PI;
  return { lat: latitude, lon: longitude };
}

self.addEventListener('message', async event => {
  const { id, coords, tileSize, sampleSize, gutter, timestamp, overview, theme } = event.data;
  try {
    const width = sampleSize + gutter * 2;
    const points = new Array(width * width);
    for (let y = 0; y < width; y += 1) {
      for (let x = 0; x < width; x += 1) {
        points[y * width + x] = sampleLocation(coords, tileSize, tileSize / sampleSize, gutter, x, y);
      }
    }

    const sampler = createTideVisualizationSampler(timestamp, { overview });
    const levels = await sampler.batch(points);
    const colors = colorTable(theme);
    const pixels = new Uint8ClampedArray(width * width * 4);
    for (let index = 0; index < levels.length; index += 1) {
      const level = levels[index];
      if (!Number.isFinite(level)) continue;
      const bin = Math.max(0, Math.min(COLOR_BIN_COUNT - 1, Math.floor(
        (level - SCALE_STOPS[0]) / (SCALE_STOPS.at(-1) - SCALE_STOPS[0]) * COLOR_BIN_COUNT
      )));
      const source = bin * 4;
      const target = index * 4;
      pixels[target] = colors[source];
      pixels[target + 1] = colors[source + 1];
      pixels[target + 2] = colors[source + 2];
      pixels[target + 3] = colors[source + 3];
    }
    self.postMessage({ id, width, pixels: pixels.buffer }, [pixels.buffer]);
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
