(function attachCoralHeatStressStyle(root, factory) {
  const style = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = style;
  else root.DiveAtlasCoralHeatStressStyle = style;
})(typeof window === 'undefined' ? globalThis : window, function buildCoralHeatStressStyle(root) {
  // Shared visual tokens align categorical BAA severity with increasing DHW bands;
  // the underlying NOAA category and DHW values remain independent.
  const tokens = typeof module === 'object' && module.exports
    ? require('./../data/coral-heat-stress/thermal-style.json')
    : root?.DiveAtlasThermalStyleTokens || root?.parent?.DiveAtlasThermalStyleTokens;
  if (!tokens) throw new Error('Shared thermal-stress display tokens are unavailable');
  const colors = Object.freeze(tokens.colors);
  const alpha = Object.freeze(tokens.alpha);
  const historyColors = Object.freeze(tokens.historyColorCategories.map(index => colors[index]));
  const historyAlpha = Object.freeze(tokens.historyAlphaCategories.map(index => alpha[index]));
  const reducedMotion = Object.freeze({ normal: 1, reduced: 0 });
  const zoomOpacity = Object.freeze(tokens.zoomOpacity);
  const transition = Object.freeze({ durationMs: tokens.transitionDurationMs });
  const css = doc => {
    if (!doc || doc.getElementById('coralHeatStressStyleTokens')) return;
    const style = doc.createElement('style');
    style.id = 'coralHeatStressStyleTokens';
    style.textContent = `:root{${colors.map((color, index) => `--thermal-level-${index}:${color}`).join(';')}}`;
    doc.head.append(style);
  };

  function zoomOpacityAt(zoom) {
    if (zoom <= zoomOpacity.fullThrough) return 1;
    if (zoom < zoomOpacity.fadedFrom) return 0.92;
    return Math.max(zoomOpacity.floor, 1 - (zoom - zoomOpacity.fadedFrom + 1) * 0.065);
  }

  return Object.freeze({ colors, alpha, historyColors, historyAlpha, reducedMotion, zoomOpacity, zoomOpacityAt, transition, css });
});
