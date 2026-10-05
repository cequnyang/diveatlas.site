(function attachCurrentVectors(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasCurrentVectors = api;
})(typeof window === 'undefined' ? globalThis : window, function buildCurrentVectorsApi() {
  function createLayer({ map, sampleVelocity }) {
    if (!map || typeof sampleVelocity !== 'function') {
      throw new TypeError('A map and current sampler are required for static current vectors');
    }

    let canvas = null;
    let context = null;
    let resizeObserver = null;
    let themeObserver = null;
    let active = false;
    const velocity = new Float64Array(2);

    function syncPosition() {
      if (!canvas || canvas.parentElement !== map.getPane('currentFlowPane')) return;
      const origin = map.containerPointToLayerPoint([0, 0]);
      canvas.style.left = `${origin.x}px`;
      canvas.style.top = `${origin.y}px`;
    }

    function resize() {
      if (!canvas || !context) return;
      const size = map.getSize();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(size.x * ratio));
      canvas.height = Math.max(1, Math.round(size.y * ratio));
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      syncPosition();
      redraw();
    }

    function drawArrow(x, y, u, v) {
      const speed = Math.hypot(u, v);
      if (speed < 0.005) return;
      const dx = u / speed;
      const dy = -v / speed;
      const length = 12;
      const half = length / 2;
      const tipX = x + dx * half;
      const tipY = y + dy * half;
      const tailX = x - dx * half;
      const tailY = y - dy * half;
      const headLength = 4;
      const headAngle = Math.PI / 6;

      context.beginPath();
      context.moveTo(tailX, tailY);
      context.lineTo(tipX, tipY);
      context.moveTo(tipX - headLength * Math.cos(Math.atan2(dy, dx) - headAngle),
        tipY - headLength * Math.sin(Math.atan2(dy, dx) - headAngle));
      context.lineTo(tipX, tipY);
      context.lineTo(tipX - headLength * Math.cos(Math.atan2(dy, dx) + headAngle),
        tipY - headLength * Math.sin(Math.atan2(dy, dx) + headAngle));
      context.stroke();
    }

    function redraw() {
      if (!active || !context || !canvas) return;
      const size = map.getSize();
      const spacing = size.x <= 600 ? 48 : 58;
      const theme = document.documentElement.dataset.theme;
      context.clearRect(0, 0, size.x, size.y);
      context.strokeStyle = theme === 'dark' ? 'rgba(92, 153, 255, 0.82)' : 'rgba(59, 115, 232, 0.72)';
      context.lineWidth = size.x <= 600 ? 1 : 1.15;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      // Fixed bearings preserve directional context for reduced-motion users without animating the map.
      for (let y = spacing / 2; y < size.y; y += spacing) {
        for (let x = spacing / 2; x < size.x; x += spacing) {
          const point = map.containerPointToLatLng([x, y]);
          if (point.lat < -79.5 || point.lat > 84.5 || !sampleVelocity(point.lat, point.lng, velocity)) continue;
          drawArrow(x, y, velocity[0], velocity[1]);
        }
      }
    }

    function attach() {
      if (canvas) return;
      const pane = map.getPane('currentFlowPane');
      if (!pane) throw new Error('The current-flow Leaflet pane is unavailable');
      pane.classList.add('current-flow-screen-pane');
      pane.style.pointerEvents = 'none';
      pane.style.overflow = 'visible';
      canvas = document.createElement('canvas');
      canvas.className = 'regional-current-vector-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none' });
      pane.appendChild(canvas);
      context = canvas.getContext('2d', { alpha: true });
      resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
      resizeObserver?.observe(map.getContainer());
      themeObserver = typeof MutationObserver === 'function' ? new MutationObserver(redraw) : null;
      themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      map.on('moveend zoomend resize', handleViewChange);
      resize();
    }

    function handleViewChange() {
      syncPosition();
      redraw();
    }

    function detach() {
      map.off('moveend zoomend resize', handleViewChange);
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      resizeObserver = null;
      themeObserver = null;
      canvas?.remove();
      canvas = null;
      context = null;
    }

    return Object.freeze({
      addTo(target = map) {
        if (target !== map) throw new TypeError('Static current vectors belong to their source map');
        if (!active) {
          active = true;
          attach();
        }
        return this;
      },
      remove() {
        active = false;
        detach();
        return this;
      },
      redraw,
      get active() { return active; }
    });
  }

  return Object.freeze({ createLayer });
});
