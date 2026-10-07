const test = require('node:test');
const assert = require('node:assert/strict');
const createEnvironmentalViewController = require('../../js/environmental-view-controller');

test('environmental views are exclusive and default stays inactive', () => {
  const events = [];
  const controller = createEnvironmentalViewController({
    views: {
      terrain: { activate: () => events.push('terrain:on'), deactivate: () => events.push('terrain:off') }
    }
  });
  controller.register('temperature', {
    activate: () => events.push('temperature:on'),
    deactivate: () => events.push('temperature:off')
  });

  assert.equal(controller.activeView, 'default');
  assert.deepEqual(events, []);
  controller.select('terrain');
  controller.select('temperature');
  controller.select('default');
  assert.deepEqual(events, ['terrain:on', 'terrain:off', 'temperature:on', 'temperature:off']);
  assert.equal(controller.activeView, 'default');
});

test('temperature slice changes replace the layer and ignore stale completions', async () => {
  const { createTemperatureView } = require('../../js/temperature-view.js');
  const layers = [];
  const attached = new Set();
  const statuses = [];
  const map = {
    hasLayer: layer => attached.has(layer),
    removeLayer(layer) { attached.delete(layer); layer.removed = true; },
    addLayer(layer) { attached.add(layer); }
  };
  const L = {
    tileLayer(url, options) {
      const layer = {
        url, options, handlers: {},
        on(event, callback) { this.handlers[event] = callback; return this; },
        addTo(target) { target.addLayer(this); return this; }
      };
      layers.push(layer);
      return layer;
    }
  };
  const metadata = {
    asset_base: 'temperature/development-1deg',
    tile_template: 'woa23/monthly/{month}/{depth}/{z}/{x}/{y}.png',
    generated_at_utc: '2026-09-27T00:00:00+00:00',
    max_native_zoom: 2,
    min_native_zoom: 1,
    available_slices: [[9, 20], [9, 30], [10, 30], [11, 40]],
    temperature_scale: { min_c: -2, max_c: 32 }
  };
  const view = createTemperatureView({
    L, map, onStatus: status => statuses.push(status), metadataLoader: () => metadata
  });

  view.activate(9, '20');
  await new Promise(resolve => setImmediate(resolve));
  view.selectSlice(9, '30');
  view.selectSlice(10, '30');
  assert.equal(layers.length, 3);
  assert.match(layers[0].url, /^data\/temperature\/development-1deg\//);
  assert.match(layers[0].url, /development-1deg\/woa23\/monthly\/09\/20\/\{z\}\/\{x\}\/\{y\}\.png/);
  assert.match(layers[1].url, /\/09\/30\//);
  assert.match(layers[2].url, /\/10\/30\//);
  assert.equal(layers[0].removed, true);
  assert.equal(layers[1].removed, true);
  assert.equal(attached.size, 1);
  assert.equal(layers[2].options.maxNativeZoom, 2);
  assert.equal(layers[2].options.minNativeZoom, 1);
  assert.equal(layers[2].options.pane, 'temperaturePane');

  layers[0].handlers.load();
  layers[1].handlers.tileerror();
  assert.equal(statuses.at(-1).state, 'loading');
  layers[2].handlers.tileerror();
  assert.equal(statuses.at(-1).state, 'unavailable');
  layers[2].handlers.load();
  assert.equal(statuses.at(-1).state, 'ready');
  assert.equal(view.formatLabel(), '30 m · October');
  const layerCountBeforeUnsupportedSlice = layers.length;
  assert.equal(view.selectSlice(9, '5'), false);
  assert.equal(layers.length, layerCountBeforeUnsupportedSlice);
  assert.equal(attached.size, 0);
  assert.equal(statuses.at(-1).state, 'unavailable');

  view.deactivate();
  assert.equal(attached.size, 0);
  assert.equal(view.state.enabled, false);
  assert.equal(view.state.hasLayer, false);
  const countAfterOff = layers.length;
  view.selectSlice(11, '40');
  assert.equal(layers.length, countAfterOff);
  view.activate(11, '40');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(layers.length, countAfterOff + 1);
  assert.equal(attached.size, 1);
  view.deactivate();
  assert.equal(attached.size, 0);
});

test('selection made while metadata is loading wins over the activation defaults', async () => {
  const { createTemperatureView } = require('../../js/temperature-view.js');
  let resolveMetadata;
  const attached = new Set();
  const layers = [];
  const map = {
    hasLayer: layer => attached.has(layer),
    removeLayer(layer) { attached.delete(layer); },
    addLayer(layer) { attached.add(layer); }
  };
  const L = {
    tileLayer(url, options) {
      const layer = { url, options, handlers: {}, on(event, callback) { this.handlers[event] = callback; return this; }, addTo(target) { target.addLayer(this); return this; } };
      layers.push(layer);
      return layer;
    }
  };
  const view = createTemperatureView({
    L,
    map,
    metadataLoader: () => new Promise(resolve => { resolveMetadata = resolve; })
  });
  view.activate(9, '20');
  await Promise.resolve();
  view.selectSlice(9, '30');
  view.selectSlice(10, '30');
  resolveMetadata({
    asset_base: 'temperature/development-1deg',
    tile_template: 'woa23/monthly/{month}/{depth}/{z}/{x}/{y}.png',
    max_native_zoom: 2,
    available_slices: [[9, 20], [9, 30], [10, 30]],
    temperature_scale: { min_c: -2, max_c: 32 }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(layers.length, 1);
  assert.match(layers[0].url, /\/10\/30\//);
  assert.equal(attached.size, 1);
});
