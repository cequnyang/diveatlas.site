const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8').replace(/\r\n/g, '\n');
const source = html.match(/  function zoomIntoAggregate\(cluster, config, type\) \{[\s\S]*?\n  \}\n\n  function activateMapMarker/)[0]
  .replace(/\n\n  function activateMapMarker$/, '');

test('aggregate activation stops at the first zoom with a singleton, or detail zoom as fallback', () => {
  for (const cluster of [
    { lat: 1, lng: 2, bounds: [0, 0, 2, 4] },
    { lat: 1, lng: 2, bounds: [1, 2, 1, 2] },
    { lat: 1, lng: 2 }
  ]) {
    let flight;
    const context = {
      map: { getZoom: () => 5, getMaxZoom: () => 18, flyTo: (...args) => { flight = args; } },
      runInternalMapMovement: callback => callback(),
      fishLodStepForZoom: () => 0,
      clusterPointRows: (_rows, _type, zoom) => [{ clustered: zoom < 8 }],
      L: {
        latLng: (lat, lng) => ({ lat, lng }),
        latLngBounds: (sw, ne) => ({
          isValid: () => Boolean(ne),
          getSouthWest: () => ({ lat: sw[0], lng: sw[1] }),
          getNorthEast: () => ({ lat: ne[0], lng: ne[1] }),
          getCenter: () => [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2]
        })
      }
    };
    cluster.members = [{ lat: 1, lng: 2 }, { lat: 2, lng: 3 }];
    vm.runInNewContext(source + '\nresult = zoomIntoAggregate(cluster, { expandZoom: 14 }, "species");',
      Object.assign(context, { cluster }));
    assert.equal(context.result, true);
    assert.equal(flight[1], 8);
  }
});
