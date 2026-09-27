const assert = require('node:assert/strict');
const interactionContract = require('../js/map-interaction-contract');

assert.equal(
  interactionContract.resolveMarkerAction(interactionContract.MARKER_KIND.aggregate),
  'zoom',
  'count-bearing markers navigate deeper instead of opening details'
);
assert.equal(
  interactionContract.resolveMarkerAction(interactionContract.MARKER_KIND.individual),
  'details',
  'individual features open details instead of aggregate zoom'
);
assert.equal(interactionContract.resolveMarkerAction('unknown'), null);

console.log('Map marker semantics contract passed.');
