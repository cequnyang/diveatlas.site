const test = require('node:test');
const assert = require('node:assert/strict');
const { SPEED_STOPS, colorAtSpeed, opacityForZoom, renderTintPixels, tileSampleCoordinates } = require('../../js/current-speed-tint.js');

test('speed tint interpolates a quiet marine palette across the documented stops', () => {
  assert.deepEqual(SPEED_STOPS.map(stop => stop.speed), [0, 0.2, 0.5, 1, 1.5]);
  const weak = colorAtSpeed(0.2, 'light');
  const medium = colorAtSpeed(0.5, 'light');
  const strong = colorAtSpeed(1.5, 'light');
  assert.deepEqual([weak.red, weak.green, weak.blue, weak.alpha], [166, 211, 225, 0.13]);
  assert.deepEqual([medium.red, medium.green, medium.blue, medium.alpha], [111, 174, 197, 0.21]);
  assert.deepEqual([strong.red, strong.green, strong.blue, strong.alpha], [64, 91, 151, 0.32]);
  assert.notDeepEqual(colorAtSpeed(0.5, 'dark'), medium);
  assert.equal(colorAtSpeed(Number.NaN), null);
  assert.equal(colorAtSpeed(-0.1), null);
});

test('zero speed is valid and high zoom gently reduces tint opacity', () => {
  assert.ok(colorAtSpeed(0).alpha > 0);
  assert.equal(opacityForZoom(8), 1);
  assert.equal(opacityForZoom(12), 0.76);
  assert.equal(opacityForZoom(20), 0.58);
});

test('tint derives magnitude from sampled u/v and leaves missing samples transparent', () => {
  const pixels = renderTintPixels({
    width: 2,
    height: 1,
    latitudeAt: () => -5,
    longitudeAt: x => x,
    sampleVelocity: (latitude, longitude, output) => {
      if (longitude === 1) return false;
      output[0] = 0.3;
      output[1] = 0.4;
      return true;
    }
  });
  const halfMeterPerSecond = colorAtSpeed(0.5);
  assert.deepEqual([...pixels.slice(0, 4)], [halfMeterPerSecond.red, halfMeterPerSecond.green,
    halfMeterPerSecond.blue, Math.round(halfMeterPerSecond.alpha * 255)]);
  assert.deepEqual([...pixels.slice(4, 8)], [0, 0, 0, 0]);
});

test('GEBCO ocean coverage keeps land clear and gives coastline pixels fractional alpha', () => {
  let velocitySamples = 0;
  const pixels = renderTintPixels({
    width: 3,
    height: 1,
    latitudeAt: () => -5,
    longitudeAt: x => x,
    sampleOceanMask: (_latitude, longitude) => longitude === 0 ? 1 : longitude === 1 ? 0.4 : 0,
    sampleVelocity: (_latitude, _longitude, output) => {
      velocitySamples += 1;
      output[0] = 0.3;
      output[1] = 0.4;
      return true;
    }
  });
  const oceanAlpha = Math.round(colorAtSpeed(0.5).alpha * 255);
  assert.equal(pixels[3], oceanAlpha);
  assert.equal(pixels[7], Math.round(colorAtSpeed(0.5).alpha * 0.4 * 255));
  assert.deepEqual([...pixels.slice(8, 12)], [0, 0, 0, 0]);
  assert.equal(velocitySamples, 2, 'land pixels do not request a current sample');
});

test('tile sampling remains continuous across the wrapped dateline', () => {
  const zoom = 8;
  const east = tileSampleCoordinates({ x: 255, y: 128, z: zoom }, 63, 31, 64);
  const west = tileSampleCoordinates({ x: 256, y: 128, z: zoom }, 0, 31, 64);
  assert.ok(east.longitude < 180 && east.longitude > 179);
  assert.ok(west.longitude > 180 && west.longitude < 181);
  assert.ok(Math.abs(west.longitude - east.longitude) < 0.1);
  assert.ok(Math.abs(west.latitude - east.latitude) < 0.1);
});
