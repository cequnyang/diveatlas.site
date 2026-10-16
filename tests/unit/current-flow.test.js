const test = require('node:test');
const assert = require('node:assert/strict');
const {
  decodeField,
  bilinearVelocity,
  geographicDisplacement,
  advanceParticle,
  adaptiveParticleCount,
  buildViewportVelocityField,
  FIELD_HEADER_BYTES,
  MISSING_VALUE,
  EARTH_RADIUS_M
} = require('../../js/current-flow.js');

test('viewport field reuses current samples without blending across missing cells', async () => {
  let calls = 0;
  const field = await buildViewportVelocityField({
    width: 12, height: 8,
    pixelToLatLng: (x, y) => ({ lat: -y, lng: x }),
    sampleVelocity: (lat, lng, output) => {
      calls += 1;
      if (lng > 4 && lng < 8) return false;
      output[0] = lng < 4 ? 0 : 0.5;
      output[1] = 0;
      return true;
    }
  });
  assert.equal(calls, 6);
  const output = new Float64Array(2);
  for (let frame = 0; frame < 100; frame += 1) {
    assert.equal(field.sample(1, 1, output), true, 'zero current remains valid');
    assert.deepEqual([...output], [0, 0]);
    assert.equal(field.sample(5, 1, output), false, 'missing cells stay missing');
    assert.equal(field.sample(9, 1, output), true);
    assert.deepEqual([...output], [0.5, 0]);
  }
  assert.equal(calls, 6, 'animation frames never repeat expensive source or coastline sampling');
  assert.equal(field.sample(-1, 0, output), false);
  assert.equal(field.sample(12, 0, output), false);
  assert.equal(field.sample(0, 8, output), false);
});

test('an obsolete viewport field is discarded before it can be used', async () => {
  let cancelled = false;
  let calls = 0;
  const field = await buildViewportVelocityField({
    width: 12, height: 8,
    pixelToLatLng: (x, y) => ({ lat: -y, lng: x }),
    cancelled: () => cancelled,
    sampleVelocity: (_lat, _lng, output) => {
      calls += 1;
      cancelled = true;
      output[0] = 0.5; output[1] = 0;
      return true;
    }
  });
  assert.equal(field, null);
  assert.equal(calls, 3, 'a cancelled build stops after its current row');
});

function makeField({ width = 2, height = 2, u = [100, 200, 300, 400], v = [400, 300, 200, 100], missing = [] } = {}) {
  const buffer = new ArrayBuffer(FIELD_HEADER_BYTES + width * height * 4);
  const view = new DataView(buffer);
  for (const [index, code] of [...'DAFV'].entries()) view.setUint8(index, code.charCodeAt(0));
  view.setUint8(4, 1);
  view.setUint16(5, width, true); view.setUint16(7, height, true);
  view.setFloat64(9, 128, true); view.setFloat64(17, -6, true);
  view.setFloat64(25, 0.25, true); view.setFloat64(33, 0.25, true);
  for (let index = 0; index < width * height; index += 1) {
    const offset = FIELD_HEADER_BYTES + index * 4;
    view.setInt16(offset, missing.includes(index) ? MISSING_VALUE : u[index], true);
    view.setInt16(offset + 2, missing.includes(index) ? MISSING_VALUE : v[index], true);
  }
  return buffer;
}

test('flow field decoder validates its header and preserves paired missing samples', () => {
  const field = decodeField(makeField({ missing: [3] }));
  assert.equal(field.width, 2);
  assert.equal(field.height, 2);
  assert.equal(field.longitudeStep, 0.25);
  assert.equal(field.latitudeStep, 0.25);
  assert.equal(field.u[3], MISSING_VALUE);
  assert.equal(field.v[3], MISSING_VALUE);
  assert.throws(() => decodeField(makeField().slice(0, 12)), /shorter than its header/);
  const invalid = makeField();
  new DataView(invalid).setUint8(0, 0);
  assert.throws(() => decodeField(invalid), /header or payload is invalid/);
});

test('bilinear interpolation operates on u and v, then derives speed', () => {
  const field = decodeField(makeField());
  const result = bilinearVelocity(field, -6.125, 128.125);
  assert.ok(Math.abs(result.u - 0.25) < 1e-12);
  assert.ok(Math.abs(result.v - 0.25) < 1e-12);
  assert.ok(Math.abs(result.speed - Math.hypot(0.25, 0.25)) < 1e-12);
});

test('bilinear interpolation rejects weighted land corners but permits zero-weight masked corners', () => {
  const field = decodeField(makeField({ missing: [3] }));
  assert.equal(bilinearVelocity(field, -6.125, 128.125), null);
  const exactCoastEdge = bilinearVelocity(field, -6.25, 128.0);
  assert.equal(exactCoastEdge.u, 0.3);
  assert.equal(exactCoastEdge.v, 0.2);
});

test('geographic advection follows east, west, north, south, NE, and SW at multiple latitudes', () => {
  for (const latitude of [0, 45, 70]) {
    const east = geographicDisplacement(latitude, 1, 0, 1);
    const west = geographicDisplacement(latitude, -1, 0, 1);
    const north = geographicDisplacement(latitude, 0, 1, 1);
    const south = geographicDisplacement(latitude, 0, -1, 1);
    const northeast = geographicDisplacement(latitude, 1, 1, 1);
    const southwest = geographicDisplacement(latitude, -1, -1, 1);
    assert.ok(east.longitude > 0 && Math.abs(east.latitude - latitude) < 1e-12);
    assert.ok(west.longitude < 0 && Math.abs(west.latitude - latitude) < 1e-12);
    assert.ok(north.latitude > latitude && Math.abs(north.longitude) < 1e-12);
    assert.ok(south.latitude < latitude && Math.abs(south.longitude) < 1e-12);
    assert.ok(northeast.longitude > 0 && northeast.latitude > latitude);
    assert.ok(southwest.longitude < 0 && southwest.latitude < latitude);

    const eastProjectedMeters = EARTH_RADIUS_M * east.longitude * Math.PI / 180;
    const northProjectedMeters = EARTH_RADIUS_M * (Math.log(Math.tan(Math.PI / 4 + north.latitude * Math.PI / 360)) - Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360)));
    assert.ok(Math.abs(eastProjectedMeters - northProjectedMeters) < 1e-5, `east/north Mercator displacement differed at ${latitude}`);
  }
  assert.equal(geographicDisplacement(89.9, 1, 1, 1), null);
});

test('particle lifecycle advances, expires, and respawns on no-data', () => {
  const field = decodeField(makeField());
  const particle = { longitude: 128, latitude: -6, age: 0.2 };
  const advanced = advanceParticle(field, particle, 0.02, { visualTimeScale: 20_000, maxAgeSeconds: 1.5 });
  assert.ok(advanced.longitude > particle.longitude);
  assert.ok(advanced.latitude > particle.latitude);
  assert.equal(advanceParticle(field, { ...particle, age: 1.5 }, 0.016, { maxAgeSeconds: 1.5 }), null);
  const masked = decodeField(makeField({ missing: [0] }));
  assert.equal(advanceParticle(masked, particle, 0.016), null);
});

test('adaptive density respects reduced motion and scales for mobile and viewport area', () => {
  const desktop = adaptiveParticleCount({ width: 1280, height: 900, mobile: false, cores: 8, reducedMotion: false });
  const mobile = adaptiveParticleCount({ width: 412, height: 839, mobile: true, cores: 8, reducedMotion: false });
  assert.equal(desktop, 5_000);
  assert.ok(mobile >= 1_000 && mobile < desktop);
  assert.equal(adaptiveParticleCount({ width: 1280, height: 900, mobile: false, cores: 8, reducedMotion: true }), 0);
});
