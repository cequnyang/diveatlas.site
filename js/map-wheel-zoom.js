(function (root) {
  'use strict';

  function installSubpixelProjection(map, L) {
    const originalOrigin = map._getNewPixelOrigin;
    const originalLayerPoint = map.latLngToLayerPoint;
    const gridTransforms = new Map();
    const markerMethods = new Map();
    const rendererMethods = new Map();
    // Leaflet 1.9.4 rounds both the pixel origin and GridLayer translation.
    // `_move(..., { round:false })` does not disable either rounding step.
    // At fractional zoom those independent steps make raster coastlines wobble
    // against GL, and getCenter() also jitters once a pan has offset mapPane.
    // Keep this change on this map and its layers, not Leaflet's prototypes.
    map._getNewPixelOrigin = function (center, zoom) {
      return this.project(center, zoom).subtract(this.getSize().divideBy(2))
        .add(this._getMapPanePos());
    };
    map._pixelOrigin = map._getNewPixelOrigin(map.getCenter(), map.getZoom());
    // CircleMarker and polygon projection round here independently of the
    // origin. That error grows with the old renderer's zoom scale, then snaps
    // back when paths are reprojected at zoomend.
    map.latLngToLayerPoint = function (latlng) {
      return this.project(L.latLng(latlng)).subtract(this.getPixelOrigin());
    };

    function restoreMethod(layer, name, descriptor) {
      if (descriptor) Object.defineProperty(layer, name, descriptor);
      else delete layer[name];
    }

    function adaptMarker(layer) {
      if (markerMethods.has(layer)) return;
      markerMethods.set(layer, {
        update:Object.getOwnPropertyDescriptor(layer, 'update'),
        animate:Object.getOwnPropertyDescriptor(layer, '_animateZoom')
      });
      // Leaflet registers function references before layeradd. Replacing the
      // methods alone would leave its rounded callbacks running every zoom.
      map.off('zoom viewreset', layer.update, layer);
      map.off('zoomanim', layer._animateZoom, layer);
      layer.update = function () {
        if (this._icon && this._map) this._setPos(this._map.latLngToLayerPoint(this._latlng));
        return this;
      };
      layer._animateZoom = function (event) {
        this._setPos(this._map._latLngToNewLayerPoint(this._latlng, event.zoom, event.center));
      };
      map.on('zoom viewreset', layer.update, layer);
      if (layer._zoomAnimated) map.on('zoomanim', layer._animateZoom, layer);
      layer.update();
    }

    function adaptRenderer(layer) {
      if (rendererMethods.has(layer)) return;
      rendererMethods.set(layer, {
        update:Object.getOwnPropertyDescriptor(layer, '_update'),
        transform:Object.getOwnPropertyDescriptor(layer, '_updateTransform')
      });
      const update = layer._update;
      let pixelOrigin = map.getPixelOrigin().clone();
      map.off('moveend', update, layer);
      layer._update = function (...args) {
        const postponed = this._map._animatingZoom && this._bounds;
        const result = update.apply(this, args);
        if (!postponed) pixelOrigin = this._map.getPixelOrigin().clone();
        return result;
      };
      layer._updateTransform = function (center, zoom) {
        const scale = this._map.getZoomScale(zoom, this._zoom);
        // SVG/Canvas bounds are rounded for drawing and clipping. Transform
        // their actual painted origin, rather than an ideal padding rectangle
        // that can differ by half a pixel and cause a reset-time jump.
        const position = this._bounds.min.add(pixelOrigin).multiplyBy(scale)
          .subtract(this._map._getNewPixelOrigin(center, zoom));
        L.DomUtil.setTransform(this._container, position, scale);
      };
      map.on('moveend', layer._update, layer);
      layer._updateTransform(map.getCenter(), map.getZoom());
    }

    function adaptGrid({ layer }) {
      if (layer instanceof L.Marker) adaptMarker(layer);
      if (layer instanceof L.Renderer) adaptRenderer(layer);
      if (!(layer instanceof L.GridLayer) || gridTransforms.has(layer)) return;
      const ownTransform = Object.getOwnPropertyDescriptor(layer, '_setZoomTransform');
      gridTransforms.set(layer, ownTransform);
      layer._setZoomTransform = function (level, center, zoom) {
        const scale = this._map.getZoomScale(zoom, level.zoom);
        const position = level.origin.multiplyBy(scale)
          .subtract(this._map._getNewPixelOrigin(center, zoom));
        L.DomUtil.setTransform(level.el, position, scale);
      };
      // layeradd fires after onAdd has already positioned its initial levels.
      layer._setZoomTransforms(map.getCenter(), map.getZoom());
    }
    function restoreLayer({ layer }) {
      if (gridTransforms.has(layer)) {
        restoreMethod(layer, '_setZoomTransform', gridTransforms.get(layer));
        gridTransforms.delete(layer);
      }
      const marker = markerMethods.get(layer);
      if (marker) {
        map.off('zoom viewreset', layer.update, layer);
        map.off('zoomanim', layer._animateZoom, layer);
        restoreMethod(layer, 'update', marker.update);
        restoreMethod(layer, '_animateZoom', marker.animate);
        markerMethods.delete(layer);
      }
      const renderer = rendererMethods.get(layer);
      if (renderer) {
        map.off('moveend', layer._update, layer);
        restoreMethod(layer, '_update', renderer.update);
        restoreMethod(layer, '_updateTransform', renderer.transform);
        rendererMethods.delete(layer);
      }
    }
    map.eachLayer(layer => adaptGrid({ layer }));
    map.on('layeradd', adaptGrid);
    map.on('layerremove', restoreLayer);
    map.once('unload', () => {
      map._getNewPixelOrigin = originalOrigin;
      map.latLngToLayerPoint = originalLayerPoint;
      map.off('layeradd', adaptGrid);
      map.off('layerremove', restoreLayer);
      for (const layer of [...gridTransforms.keys(), ...markerMethods.keys(), ...rendererMethods.keys()]) restoreLayer({ layer });
    });
  }

  function install(map, L) {
    installSubpixelProjection(map, L);
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
    // Match Leaflet TouchZoom: every layer observes the same fractional view.
    // Freezing the GL texture for an entire wheel burst exposes its edges on
    // zoom-out and magnifies stale pixels on zoom-in; replacing it at zoomend
    // then causes a visible jump.
    const followMs = 65;
    const quietMs = 120;
    const clampZoom = zoom => Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), zoom));

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
      map._move(center, zoom, { pinch:true, round:false });
      displayZoom = zoom;
      displayCenter = center;
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
