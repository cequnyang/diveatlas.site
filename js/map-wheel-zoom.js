(function (root) {
  'use strict';

  function install(map, L) {
    const handler = map.scrollWheelZoom;
    const originalWheel = handler._onWheelScroll;
    const originalRemove = handler.removeHooks;
    let frame = 0;
    let targetZoom = null;
    let anchor = null;
    let pointer = null;
    let displayZoom = null;
    let displayCenter = null;
    let moving = false;
    let lastInput = 0;
    let lastFrame = 0;
    let basemapSnapshots = [];
    // Follow input quickly without starting a fixed-duration CSS animation for
    // each wheel event. A short quiet window groups trackpad/wheel bursts.
    const followMs = 65;
    const quietMs = 120;
    const clampZoom = zoom => Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), zoom));

    function basemapOrigin(gl, center, zoom) {
      // Use the GL camera and viewport, not Leaflet's rounded pane position.
      // A half-pixel origin error grows while the old texture is scaled and
      // disappears on redraw, which looks like the basemap is shaking.
      const half = L.point(gl.transform.width, gl.transform.height).divideBy(2);
      return map.unproject(map.project(center, zoom).subtract(half), zoom);
    }

    function freezeBasemaps() {
      map.eachLayer(layer => {
        if (!layer.getMaplibreMap || !layer._pinchZoom || !layer._container) return;
        const container = layer._container;
        const gl = layer.getMaplibreMap();
        const center = gl.getCenter();
        const zoom = gl.getZoom() + 1;
        const snapshot = { layer, container, zoom,
          origin:basemapOrigin(gl, L.latLng(center.lat, center.lng), zoom),
          transformOrigin:container.style.transformOrigin, willChange:container.style.willChange };
        // Leave the GL camera on its painted frame during the gesture. The
        // container transform reuses that texture without per-frame jumpTo.
        map.off('zoom', layer._pinchZoom, layer);
        map.off('zoomanim', layer._animateZoom, layer);
        container.style.transformOrigin = '0 0';
        container.style.willChange = 'transform';
        basemapSnapshots.push(snapshot);
      });
    }

    function transformBasemaps(center, zoom) {
      for (const snapshot of basemapSnapshots) {
        const { layer, container } = snapshot;
        if (!map.hasLayer(layer)) continue;
        const scale = map.getZoomScale(zoom, snapshot.zoom);
        const position = map.project(snapshot.origin, zoom).subtract(map.project(center, zoom))
          .add(map.getSize().divideBy(2)).subtract(map._getMapPanePos());
        L.DomUtil.setTransform(container, position, scale);
      }
    }

    function restoreBasemaps() {
      for (const { layer, container, transformOrigin, willChange } of basemapSnapshots) {
        container.style.transformOrigin = transformOrigin;
        container.style.willChange = willChange;
        if (map.hasLayer(layer)) {
          map.on('zoom', layer._pinchZoom, layer);
          map.on('zoomanim', layer._animateZoom, layer);
        }
      }
      basemapSnapshots = [];
    }

    function centerAt(zoom) {
      const offset = pointer.subtract(map.getSize().divideBy(2));
      const center = map.unproject(map.project(anchor, zoom).subtract(offset), zoom);
      return map._limitCenter(center, zoom, map.options.maxBounds);
    }

    function finish() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (moving) {
        // This adapter follows Leaflet 1.9.4 TouchZoom's private movement API.
        // During the gesture pinch:true lets GridLayers transform existing
        // tiles. Reset their integer LOD once, after the last visible frame.
        const zoom = clampZoom(targetZoom ?? displayZoom ?? map.getZoom());
        map._move(centerAt(zoom), zoom, { pinch:true, round:false });
        moving = false;
        restoreBasemaps();
        map.fire('viewreset');
        map._moveEnd(true);
      }
      targetZoom = null;
      displayZoom = null;
      displayCenter = null;
      lastFrame = 0;
    }

    function tick(now) {
      frame = 0;
      // A button/double-click animation may already be in flight. Preserve
      // wheel input until it completes; wheel gestures themselves never start it.
      if (map._animatingZoom) {
        frame = requestAnimationFrame(tick);
        return;
      }
      if (!moving) {
        map._stop();
        freezeBasemaps();
        moving = true;
        displayZoom = map.getZoom();
        displayCenter = map.getCenter();
        map._moveStart(true, false);
      }
      const elapsed = lastFrame ? Math.min(now - lastFrame, 64) : 16;
      lastFrame = now;
      const current = displayZoom;
      const remaining = targetZoom - current;
      const done = now - lastInput >= quietMs && Math.abs(remaining) < 0.005;
      const zoom = done ? targetZoom : current + remaining * (1 - Math.exp(-elapsed / followMs));
      const center = centerAt(zoom);
      // Keep Leaflet's starting zoom fixed while each layer applies its
      // absolute fractional transform. Advancing map state first makes raster
      // overlays calculate only the incremental scale and visibly drift.
      map.fire('zoomanim', { center, zoom, noUpdate:true });
      displayZoom = zoom;
      displayCenter = center;
      transformBasemaps(center, zoom);
      if (done) finish();
      else frame = requestAnimationFrame(tick);
    }

    handler.disable();
    handler._onWheelScroll = function (event) {
      if (event.target?.closest?.('.leaflet-control, .leaflet-popup')) return;
      const delta = L.DomEvent.getWheelDelta(event);
      if (!delta) return;
      L.DomEvent.stop(event);
      const current = targetZoom ?? displayZoom ?? map.getZoom();
      const next = clampZoom((targetZoom ?? current) + delta / map.options.wheelPxPerZoomLevel);
      if (targetZoom == null && next === current) return;
      const nextPointer = map.mouseEventToContainerPoint(event);
      // Repeatedly unprojecting an unchanged pointer accumulates Leaflet's
      // pixel rounding error. Keep a stable geographic anchor for the burst.
      if (targetZoom == null || !pointer || nextPointer.distanceTo(pointer) > 1) {
        pointer = nextPointer;
        const center = displayCenter ?? map.getCenter();
        const zoom = displayZoom ?? map.getZoom();
        anchor = map.unproject(map.project(center, zoom)
          .subtract(map.getSize().divideBy(2)).add(pointer), zoom);
      }
      targetZoom = next;
      lastInput = performance.now();
      if (!frame) frame = requestAnimationFrame(tick);
    };
    handler.removeHooks = function () {
      originalRemove.call(this);
      finish();
    };
    handler.enable();
    // Finish before another interaction takes ownership of map movement.
    const container = map.getContainer();
    container.addEventListener('pointerdown', finish, true);
    container.addEventListener('keydown', finish, true);
    map.on('resize', finish);
    map.on('unload', () => {
      handler.disable();
      handler._onWheelScroll = originalWheel;
      handler.removeHooks = originalRemove;
      container.removeEventListener('pointerdown', finish, true);
      container.removeEventListener('keydown', finish, true);
      map.off('resize', finish);
    });
  }

  root.DiveAtlasWheelZoom = Object.freeze({ install });
})(window);
