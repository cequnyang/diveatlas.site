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
    preferredSide = 'above',
    aboveAdjustment = { cost: Infinity },
    belowAdjustment = { cost: Infinity }
  } = {}) {
    if (aboveShift == null && belowShift == null) {
      const belowWins = belowAdjustment.cost < aboveAdjustment.cost;
      return { side: belowWins ? 'below' : 'above', fallback: true };
    }
    if (aboveShift == null) return { side: 'below', fallback: false };
    if (belowShift == null) return { side: 'above', fallback: false };
    if (preferredSide === 'below' || preferredSide === 'above') {
      // Keep the responsive preference when that side fits without moving the
      // popup; use the other side if only it fits in place, then minimize shift.
      const preferredShift = preferredSide === 'below' ? belowShift : aboveShift;
      const alternateSide = preferredSide === 'below' ? 'above' : 'below';
      const alternateShift = alternateSide === 'below' ? belowShift : aboveShift;
      if (preferredShift === 0 || alternateShift !== 0) {
        if (preferredShift === 0 || Math.abs(preferredShift) <= Math.abs(alternateShift)) {
          return { side: preferredSide, fallback: false };
        }
      }
      return { side: alternateSide, fallback: false };
    }
    if (Math.abs(aboveShift) <= Math.abs(belowShift)) {
      return { side: 'above', fallback: false };
    }
    return { side: 'below', fallback: false };
  }

  function popupArrowSide(side) {
    return side === 'below' ? 'top' : 'bottom';
  }

  function disablePopupAutoPan(options = {}) {
    return { ...options, autoPan: false };
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
    disablePopupAutoPan,
    canFinishPopupClose,
    isCurrentPopupOwner,
    shouldDismissPopupAfterMovement,
    shouldStartDepthLongPress,
    shouldResolveDepthLongPress
  });
});
