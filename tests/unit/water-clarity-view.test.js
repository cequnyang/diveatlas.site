const test = require('node:test');
const assert = require('node:assert/strict');
const { createWaterClarityView } = require('../../js/water-clarity-view.js');

function makeMap() {
  const attached = new Set();
  return {
    attached,
    hasLayer: layer => attached.has(layer),
    addLayer(layer) { attached.add(layer); },
    removeLayer(layer) { attached.delete(layer); layer.removed = true; }
  };
}

function makeLeaflet() {
  const layers = [];
  return {
    layers,
    tileLayer(url, options) {
      const layer = {
        url, options, handlers: {},
        on(name, callback) { this.handlers[name] = callback; return this; },
        addTo(map) { map.addLayer(this); return this; }
      };
      layers.push(layer);
      return layer;
    }
  };
}

const metadata = {
  format: 'diveatlas-water-clarity', format_version: 1,
  available_months: Array.from({ length: 12 }, (_, index) => index + 1),
  generated_at_utc: 'test-version',
  rendering: { tile_template: 'tiles/{month}/{z}/{x}/{y}.png', min_native_zoom: 5, max_native_zoom: 5, opacity: 0.58 }
};

test('view loads only on activation and keeps the last complete month until replacement is ready', async () => {
  const L = makeLeaflet();
  const map = makeMap();
  const statuses = [];
  let metadataLoads = 0;
  const view = createWaterClarityView({ L, map, metadataLoader: () => { metadataLoads += 1; return metadata; }, onStatus: status => statuses.push(status) });
  assert.equal(metadataLoads, 0);
  view.activate(9);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(metadataLoads, 1);
  assert.equal(L.layers.length, 1);
  assert.match(L.layers[0].url, /tiles\/09\/\{z\}\/\{x\}\/\{y\}\.png/);
  L.layers[0].handlers.load();
  assert.equal(map.attached.size, 1);
  view.selectMonth(10);
  await Promise.resolve();
  assert.equal(L.layers.length, 2);
  assert.equal(map.attached.size, 2);
  L.layers[1].handlers.load();
  assert.equal(map.attached.size, 1);
  assert.equal(L.layers[0].removed, true);
  assert.equal(statuses.at(-1).state, 'ready');
  view.deactivate();
  assert.equal(map.attached.size, 0);
});

test('rapid month changes discard obsolete pending tiles and ignore stale completions', async () => {
  const L = makeLeaflet();
  const map = makeMap();
  const view = createWaterClarityView({ L, map, metadataLoader: () => metadata });
  view.activate(9);
  await new Promise(resolve => setImmediate(resolve));
  L.layers[0].handlers.load();
  view.selectMonth(10);
  view.selectMonth(11);
  assert.equal(L.layers[1].removed, true);
  L.layers[1].handlers.load();
  assert.equal(map.attached.has(L.layers[1]), false);
  L.layers[2].handlers.load();
  assert.equal(map.attached.size, 1);
  assert.equal(map.attached.has(L.layers[2]), true);
  assert.equal(view.state.month, 11);
});
