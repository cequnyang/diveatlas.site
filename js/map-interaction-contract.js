(function installDiveAtlasInteractionContract(root, factory) {
  const contract = factory();
  if (typeof module === 'object' && module.exports) module.exports = contract;
  if (root) root.DiveAtlasInteractionContract = contract;
})(typeof globalThis === 'object' ? globalThis : this, function createContract() {
  'use strict';

  const MARKER_KIND = Object.freeze({
    aggregate: 'aggregate',
    individual: 'individual'
  });

  function resolveMarkerAction(value) {
    const kind = typeof value === 'string' ? value : value?.kind;
    if (kind === MARKER_KIND.aggregate) return 'zoom';
    if (kind === MARKER_KIND.individual) return 'details';
    return null;
  }

  function isFeatureInteractable({
    layerEnabled,
    representationActive,
    featureActive,
    geometryVisible
  } = {}) {
    return layerEnabled === true &&
      representationActive === true &&
      featureActive === true &&
      geometryVisible === true;
  }

  function choosePopupVerticalPlacement({
    aboveShift,
    belowShift,
    aboveAdjustment = { cost: Infinity, shift: 0 },
    belowAdjustment = { cost: Infinity, shift: 0 }
  } = {}) {
    if (aboveShift == null && belowShift == null) {
      const belowWins = belowAdjustment.cost < aboveAdjustment.cost ||
        (belowAdjustment.cost === aboveAdjustment.cost &&
          Math.abs(belowAdjustment.shift) < Math.abs(aboveAdjustment.shift));
      const adjustment = belowWins ? belowAdjustment : aboveAdjustment;
      return { side: belowWins ? 'below' : 'above', shift: adjustment.shift, fallback: true };
    }
    if (aboveShift == null) return { side: 'below', shift: belowShift, fallback: false };
    if (belowShift == null || Math.abs(aboveShift) <= Math.abs(belowShift)) {
      return { side: 'above', shift: aboveShift, fallback: false };
    }
    return { side: 'below', shift: belowShift, fallback: false };
  }

  function popupArrowSide(side) {
    return side === 'below' ? 'top' : 'bottom';
  }

  function canFinishPopupClose({ currentEpoch, expectedEpoch, lifecycle } = {}) {
    return currentEpoch === expectedEpoch && lifecycle === 'closing';
  }

  function isCurrentPopupOwner({
    popupIsActive,
    ownerRevision,
    expectedRevision
  } = {}) {
    return popupIsActive === true && ownerRevision === expectedRevision;
  }

  function shouldDismissPopupAfterMovement({
    internalMovement,
    userMovementIntent,
    anchorVisible,
    ownerValid
  } = {}) {
    if (internalMovement && !userMovementIntent) return false;
    return anchorVisible !== true || ownerValid !== true;
  }

  function shouldStartDepthLongPress({ pointerType, multiplePointers, gestureActive } = {}) {
    return (pointerType === 'touch' || pointerType === 'pen') &&
      multiplePointers !== true && gestureActive !== true;
  }

  function shouldResolveDepthLongPress({
    pointerActive,
    moved,
    multiplePointers,
    gestureActive,
    interactionSuppressed
  } = {}) {
    return pointerActive === true && moved !== true && multiplePointers !== true &&
      gestureActive !== true && interactionSuppressed !== true;
  }

  return Object.freeze({
    MARKER_KIND,
    resolveMarkerAction,
    isFeatureInteractable,
    choosePopupVerticalPlacement,
    popupArrowSide,
    canFinishPopupClose,
    isCurrentPopupOwner,
    shouldDismissPopupAfterMovement,
    shouldStartDepthLongPress,
    shouldResolveDepthLongPress
  });
});
