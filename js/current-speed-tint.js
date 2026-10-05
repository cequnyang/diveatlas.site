(function attachCurrentSpeedTint(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasCurrentSpeedTint = api;
})(typeof window === 'undefined' ? globalThis : window, function buildCurrentSpeedTintApi() {
  const SPEED_STOPS = Object.freeze([
    { speed: 0, light: [205, 226, 234], dark: [48, 78, 96], alpha: 0.045 },
    { speed: 0.2, light: [166, 211, 225], dark: [45, 91, 110], alpha: 0.13 },
    { speed: 0.5, light: [111, 174, 197], dark: [43, 91, 122], alpha: 0.21 },
    { speed: 1, light: [69, 133, 180], dark: [42, 75, 124], alpha: 0.28 },
    { speed: 1.5, light: [64, 91, 151], dark: [43, 61, 112], alpha: 0.32 }
  ]);

  function opacityForZoom(zoom) {
    return Math.max(0.58, 1 - Math.max(0, zoom - 8) * 0.06);
  }

  function colorAtSpeed(speed, theme = 'light', zoom = 8) {
    if (!Number.isFinite(speed) || speed < 0) return null;
    const dark = theme === 'dark';
    const last = SPEED_STOPS.length - 1;
    let lower = SPEED_STOPS[0];
    let upper = SPEED_STOPS[1];
    if (speed >= SPEED_STOPS[last].speed) lower = upper = SPEED_STOPS[last];
    else {
      for (let index = 1; index < SPEED_STOPS.length; index += 1) {
        if (speed <= SPEED_STOPS[index].speed) {
          lower = SPEED_STOPS[index - 1];
          upper = SPEED_STOPS[index];
          break;
        }
      }
    }
    const fraction = lower === upper ? 0 : (speed - lower.speed) / (upper.speed - lower.speed);
    const scale = opacityForZoom(zoom);
    return {
      red: Math.round(lower[dark ? 'dark' : 'light'][0] * (1 - fraction) + upper[dark ? 'dark' : 'light'][0] * fraction),
      green: Math.round(lower[dark ? 'dark' : 'light'][1] * (1 - fraction) + upper[dark ? 'dark' : 'light'][1] * fraction),
      blue: Math.round(lower[dark ? 'dark' : 'light'][2] * (1 - fraction) + upper[dark ? 'dark' : 'light'][2] * fraction),
      alpha: lower.alpha * (1 - fraction) * scale + upper.alpha * fraction * scale
    };
  }

  function renderTintPixels({ width, height, sampleVelocity, sampleOceanMask = null, oceanMaskTile = null, latitudeAt, longitudeAt, theme = 'light', zoom = 8 }) {
    const pixels = new Uint8ClampedArray(width * height * 4);
    const velocity = new Float64Array(2);
    const longitudes = Float64Array.from({ length: width }, (_, x) => longitudeAt(x));
    const latitudes = Float64Array.from({ length: height }, (_, y) => latitudeAt(y));
    for (let y = 0; y < height; y += 1) {
      const latitude = latitudes[y];
      for (let x = 0; x < width; x += 1) {
        const longitude = longitudes[x];
        const oceanCoverage = sampleOceanMask ? sampleOceanMask(latitude, longitude, oceanMaskTile) : null;
        if (oceanCoverage !== null && !(oceanCoverage > 0)) continue;
        let sampled = sampleVelocity(latitude, longitude, velocity);
        if (!sampled && oceanCoverage !== null) {
          sampled = sampleVelocity(latitude, longitude, velocity, (fromLatitude, fromLongitude, toLatitude, toLongitude) => {
            const latitudeDistance = (toLatitude - fromLatitude) * 111_320;
            const longitudeDistance = (((toLongitude - fromLongitude + 540) % 360) - 180) *
              111_320 * Math.cos((fromLatitude + toLatitude) * Math.PI / 360);
            const steps = Math.max(1, Math.ceil(Math.hypot(latitudeDistance, longitudeDistance) / 1_000));
            for (let step = 1; step <= steps; step += 1) {
              const fraction = step / steps;
              const coverage = sampleOceanMask(
                fromLatitude + (toLatitude - fromLatitude) * fraction,
                fromLongitude + (((toLongitude - fromLongitude + 540) % 360) - 180) * fraction,
                oceanMaskTile
              );
              if (!(coverage >= 0.5)) return false;
            }
            return true;
          });
        }
        if (!sampled) continue;
        const color = colorAtSpeed(Math.hypot(velocity[0], velocity[1]), theme, zoom);
        if (!color) continue;
        const offset = (y * width + x) * 4;
        pixels[offset] = color.red;
        pixels[offset + 1] = color.green;
        pixels[offset + 2] = color.blue;
        pixels[offset + 3] = Math.round(color.alpha * (oceanCoverage ?? 1) * 255);
      }
    }
    return pixels;
  }

  function tileSampleCoordinates(coords, x, y, resolution, tileSize = 256) {
    const worldSize = tileSize * 2 ** coords.z;
    const pixelX = coords.x * tileSize + (x + 0.5) * tileSize / resolution;
    const pixelY = coords.y * tileSize + (y + 0.5) * tileSize / resolution;
    const mercatorY = Math.PI * (1 - 2 * pixelY / worldSize);
    return {
      longitude: pixelX / worldSize * 360 - 180,
      latitude: Math.atan(Math.sinh(mercatorY)) * 180 / Math.PI
    };
  }

  function createLayer({ L, sampleVelocity, sampleOceanMask = null, getOceanMaskTile = null,
    theme = () => document.documentElement.dataset.theme || 'light', mobile = () => matchMedia('(max-width: 600px)').matches }) {
    if (!L?.GridLayer || typeof sampleVelocity !== 'function') throw new TypeError('Leaflet and the shared current-tile sampler are required');
    let renderCount = 0;
    let renderedSamples = 0;
    let renderDurationMs = 0;
    let lastRenderMs = null;

    const SpeedTintGridLayer = L.GridLayer.extend({
      options: { pane: 'currentSpeedTintPane', tileSize: 256, keepBuffer: 1, updateWhenIdle: true, updateWhenZooming: false },

      createTile(coords, done) {
        const startedAt = performance.now();
        const tile = document.createElement('canvas');
        // Source currents are much coarser than these screen buffers; 48/32
        // samples per 256px tile keeps the field smooth without oversampling.
        const resolution = mobile() ? 32 : 48;
        // Keep regional speed sampling coarse; the higher-resolution canvas is
        // for compositing the existing GEBCO land mask without staircase edges.
        const outputResolution = 128;
        tile.width = outputResolution;
        tile.height = outputResolution;
        tile.setAttribute('aria-hidden', 'true');
        tile.className = 'regional-current-speed-tint-tile';
        const context = tile.getContext('2d', { alpha: true });
        if (!context) {
          queueMicrotask(() => done(new Error('Canvas 2D is unavailable for current speed tint'), tile));
          return tile;
        }

        const worldSize = this.options.tileSize * 2 ** coords.z;
        const pixelOriginX = coords.x * this.options.tileSize;
        const pixelOriginY = coords.y * this.options.tileSize;
        const longitudeAt = x => (pixelOriginX + (x + 0.5) * this.options.tileSize / resolution) / worldSize * 360 - 180;
        const latitudeAt = y => {
          const mercatorY = Math.PI * (1 - 2 * (pixelOriginY + (y + 0.5) * this.options.tileSize / resolution) / worldSize);
          return Math.atan(Math.sinh(mercatorY)) * 180 / Math.PI;
        };
        const render = oceanMaskTile => {
          const pixels = renderTintPixels({
            width: resolution,
            height: resolution,
            sampleVelocity,
            sampleOceanMask: sampleOceanMask ? (latitude, longitude) => sampleOceanMask(latitude, longitude, coords, oceanMaskTile) : null,
            oceanMaskTile,
            latitudeAt,
            longitudeAt,
            theme: theme(),
            zoom: coords.z
          });
          const speedCanvas = document.createElement('canvas');
          speedCanvas.width = resolution;
          speedCanvas.height = resolution;
          const speedContext = speedCanvas.getContext('2d', { alpha: true });
          const image = speedContext.createImageData(resolution, resolution);
          image.data.set(pixels);
          speedContext.putImageData(image, 0, 0);
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = 'high';
          context.drawImage(speedCanvas, 0, 0, outputResolution, outputResolution);
          tile.dataset.coastMask = oceanMaskTile?.canvas ? 'gebco' : 'current-validity';
          if (oceanMaskTile?.canvas) {
            context.globalCompositeOperation = 'destination-in';
            context.drawImage(oceanMaskTile.canvas,
              oceanMaskTile.x, oceanMaskTile.y, oceanMaskTile.width, oceanMaskTile.height,
              0, 0, outputResolution, outputResolution);
            context.globalCompositeOperation = 'source-over';
          }
          lastRenderMs = performance.now() - startedAt;
          renderDurationMs += lastRenderMs;
          renderCount += 1;
          renderedSamples += resolution * resolution;
          tile.dataset.renderMs = lastRenderMs.toFixed(2);
          // GridLayer registers and inserts the canvas after createTile returns.
          // Defer readiness so Leaflet can apply leaflet-tile-loaded; otherwise
          // its default hidden-tile rule keeps the tint invisible.
          queueMicrotask(() => done(null, tile));
        };
        let oceanMaskResult;
        try {
          oceanMaskResult = getOceanMaskTile?.(coords) ?? null;
        } catch {
          oceanMaskResult = null;
        }
        Promise.resolve(oceanMaskResult).then(render, () => render(null));
        return tile;
      },

      onAdd(map) {
        L.GridLayer.prototype.onAdd.call(this, map);
        this._themeObserver = new MutationObserver(() => this.redraw());
        this._themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      },

      onRemove(map) {
        this._themeObserver?.disconnect();
        this._themeObserver = null;
        L.GridLayer.prototype.onRemove.call(this, map);
      }
    });

    const layer = new SpeedTintGridLayer();
    Object.defineProperty(layer, 'tintMetrics', { get: () => ({ renderCount, renderedSamples, renderDurationMs, lastRenderMs }) });
    return layer;
  }

  return Object.freeze({ SPEED_STOPS, opacityForZoom, colorAtSpeed, renderTintPixels, tileSampleCoordinates, createLayer });
});
