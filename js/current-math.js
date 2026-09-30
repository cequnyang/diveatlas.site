(function attachCurrentMath(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasCurrentMath = api;
})(typeof window === 'undefined' ? globalThis : window, function buildCurrentMath() {
  const COMPASS_DIRECTIONS = Object.freeze(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);

  function currentSpeed(u, v) {
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
    return Math.hypot(u, v);
  }

  // Components describe where water flows toward; bearing is clockwise from north.
  function currentBearing(u, v) {
    if (!Number.isFinite(u) || !Number.isFinite(v) || (u === 0 && v === 0)) return null;
    return (Math.atan2(u, v) * 180 / Math.PI + 360) % 360;
  }

  function currentDirection(u, v) {
    const bearing = currentBearing(u, v);
    if (bearing == null) return null;
    return COMPASS_DIRECTIONS[Math.round(bearing / 45) % COMPASS_DIRECTIONS.length];
  }

  return Object.freeze({ currentSpeed, currentBearing, currentDirection, COMPASS_DIRECTIONS });
});
