const test = require('node:test');
const assert = require('node:assert/strict');
const contract = require('../../js/map-interaction-contract.js');

test('aggregate Coral markers zoom and never open details', () => {
  assert.equal(contract.resolveMarkerAction({ kind: 'aggregate' }), 'zoom');
});

test('individual Coral features open details and do not zoom', () => {
  assert.equal(contract.resolveMarkerAction({ kind: 'individual' }), 'details');
});

test('unknown marker semantics do not activate an action', () => {
  assert.equal(contract.resolveMarkerAction({ kind: 'other' }), null);
});

test('feature interaction requires visible layer, active representation, feature, and geometry', () => {
  const visible = {
    layerEnabled: true,
    representationActive: true,
    featureActive: true,
    geometryVisible: true
  };
  assert.equal(contract.isFeatureInteractable(visible), true);
  for (const condition of Object.keys(visible)) {
    assert.equal(contract.isFeatureInteractable({ ...visible, [condition]: false }), false, condition);
  }
});

test('popup placement prefers above when both directions fit', () => {
  assert.deepEqual(contract.choosePopupVerticalPlacement({ aboveShift: 0, belowShift: 0 }), {
    side: 'above', shift: 0, fallback: false
  });
});

test('popup placement flips below when above does not fit', () => {
  assert.equal(contract.choosePopupVerticalPlacement({ aboveShift: null, belowShift: 0 }).side, 'below');
});

test('popup placement uses the least-cost adjustment when neither direction fits', () => {
  assert.deepEqual(contract.choosePopupVerticalPlacement({
    aboveShift: null,
    belowShift: null,
    aboveAdjustment: { cost: 28, shift: -18 },
    belowAdjustment: { cost: 9, shift: 7 }
  }), { side: 'below', shift: 7, fallback: true });
});

test('popup arrow points toward its anchor on either side', () => {
  assert.equal(contract.popupArrowSide('above'), 'bottom');
  assert.equal(contract.popupArrowSide('below'), 'top');
});

test('popup close may reset only for the current closing epoch', () => {
  assert.equal(contract.canFinishPopupClose({ currentEpoch: 8, expectedEpoch: 8, lifecycle: 'closing' }), true);
  assert.equal(contract.canFinishPopupClose({ currentEpoch: 9, expectedEpoch: 8, lifecycle: 'closing' }), false);
  assert.equal(contract.canFinishPopupClose({ currentEpoch: 8, expectedEpoch: 8, lifecycle: 'open' }), false);
});

test('a stale popup owner revision cannot operate on a newer popup', () => {
  assert.equal(contract.isCurrentPopupOwner({ popupIsActive: true, ownerRevision: 12, expectedRevision: 12 }), true);
  assert.equal(contract.isCurrentPopupOwner({ popupIsActive: false, ownerRevision: 12, expectedRevision: 12 }), false);
  assert.equal(contract.isCurrentPopupOwner({ popupIsActive: true, ownerRevision: 13, expectedRevision: 12 }), false);
});

test('popup auto-pan is not mistaken for user navigation', () => {
  assert.equal(contract.shouldDismissPopupAfterMovement({
    internalMovement: true,
    userMovementIntent: false,
    anchorVisible: false,
    ownerValid: false
  }), false);
  assert.equal(contract.shouldDismissPopupAfterMovement({
    internalMovement: false,
    userMovementIntent: true,
    anchorVisible: false,
    ownerValid: true
  }), true);
  assert.equal(contract.shouldDismissPopupAfterMovement({
    internalMovement: false,
    userMovementIntent: true,
    anchorVisible: true,
    ownerValid: true
  }), false);
});

test('desktop interaction does not start a depth long press', () => {
  assert.equal(contract.shouldStartDepthLongPress({ pointerType: 'mouse' }), false);
});

test('touch and pen long press starts only for one stationary pointer', () => {
  assert.equal(contract.shouldStartDepthLongPress({ pointerType: 'touch' }), true);
  assert.equal(contract.shouldStartDepthLongPress({ pointerType: 'pen' }), true);
  assert.equal(contract.shouldStartDepthLongPress({ pointerType: 'touch', multiplePointers: true }), false);
});

test('drag, pinch, cancellation, and suppressed touch do not become long-press actions', () => {
  const valid = { pointerActive: true };
  assert.equal(contract.shouldResolveDepthLongPress(valid), true);
  for (const condition of ['pointerActive', 'moved', 'multiplePointers', 'gestureActive', 'interactionSuppressed']) {
    const invalid = { ...valid, [condition]: condition === 'pointerActive' ? false : true };
    assert.equal(contract.shouldResolveDepthLongPress(invalid), false, condition);
  }
});
