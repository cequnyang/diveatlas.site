const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, confidence, createResult } = require('../../js/dive-conditions-model.js');

test('condition interpretation stays metric-specific and transparent', () => {
  assert.equal(classify('temperature', 27), 'Warm');
  assert.equal(classify('clarity', 20), 'High');
  assert.equal(classify('current', 0.3), 'Moderate');
  assert.equal(classify('waves', 0.7), 'Low wave height');
  assert.equal(classify('temperature', 18), 'Very cool');
  assert.equal(classify('temperature', 20), 'Cool');
  assert.equal(classify('temperature', 23), 'Mild');
  assert.equal(classify('temperature', 25), 'Comfortably warm');
  assert.equal(classify('clarity', 2), 'Low');
  assert.equal(classify('clarity', 5), 'Fair');
  assert.equal(classify('clarity', 8), 'Moderate');
  assert.equal(classify('clarity', 12), 'Good');
  assert.equal(classify('current', 0.1), 'Light');
  assert.equal(classify('current', 0.45), 'Moderately strong');
  assert.equal(classify('current', 0.6), 'Strong');
  assert.equal(classify('waves', 0.25), 'Very low wave height');
  assert.equal(classify('waves', 0.5), 'Low wave height');
  assert.equal(classify('waves', 1.25), 'High wave height');
  assert.equal(confidence(4), 'High');
  assert.equal(confidence(2), 'Moderate');
  assert.equal(confidence(0), 'Unavailable');
});

test('result retains provenance, location and explicit unavailable observations', () => {
  const result = createResult({ location: { lat: -5, lng: 130 }, month: 9, samples: {
    temperature: { value: 28, unit: '°C', provenance: 'WOA23', resolution: '0.25°', period: '1991-2020' },
    clarity: { value: null }, current: { value: 0.3 }, waves: { value: 0.6 }
  } });
  assert.equal(result.metrics.temperature.value, 28);
  assert.equal(result.metrics.temperature.provenance, 'WOA23');
  assert.equal(result.metrics.clarity.value, null);
  assert.equal(result.availableCount, 3);
  assert.equal(result.dataConfidence, 'Moderate');
  assert.equal(result.caveat, 'Typical historical conditions — not a live forecast.');
});
