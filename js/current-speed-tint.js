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

  function createOceanPathCheck(sampleOceanMask, oceanMaskTile, maskCoords) {
    if (!sampleOceanMask) return null;
    return (fromLatitude, fromLongitude, toLatitude, toLongitude) => {
      const latitudeDistance = (toLatitude - fromLatitude) * 111_320;
      const longitudeDistance = (((toLongitude - fromLongitude + 540) % 360) - 180) *
        111_320 * Math.cos((fromLatitude + toLatitude) * Math.PI / 360);
      const steps = Math.max(1, Math.ceil(Math.hypot(latitudeDistance, longitudeDistance) / 1_000));
      for (let step = 1; step <= steps; step += 1) {
        const fraction = step / steps;
        const coverage = sampleOceanMask(
          fromLatitude + (toLatitude - fromLatitude) * fraction,
          fromLongitude + (((toLongitude - fromLongitude + 540) % 360) - 180) * fraction,
          maskCoords,
          oceanMaskTile
        );
        if (!(coverage >= 0.5)) return false;
      }
      return true;
    };
  }

  function createTintPixelRenderer({ width, height, sampleVelocity, sampleOceanMask = null, oceanMaskTile = null, maskCoords = null, latitudeAt, longitudeAt, theme = 'light', zoom = 8 }) {
    const pixels = new Uint8ClampedArray(width * height * 4);
    const velocity = new Float64Array(2);
    const maskAware = createOceanPathCheck(sampleOceanMask, oceanMaskTile, maskCoords);
    const longitudes = Float64Array.from({ length: width }, (_, x) => longitudeAt(x));
    const latitudes = Float64Array.from({ length: height }, (_, y) => latitudeAt(y));
    let nextPixel = 0;
    return { pixels, renderNext(count = 8) {
      const end = Math.min(width * height, nextPixel + count);
      for (; nextPixel < end; nextPixel += 1) {
        const y = Math.floor(nextPixel / width), x = nextPixel % width;
        const latitude = latitudes[y];
        const longitude = longitudes[x];
        const oceanCoverage = sampleOceanMask ? sampleOceanMask(latitude, longitude, oceanMaskTile) : null;
        if (oceanCoverage !== null && !(oceanCoverage > 0)) continue;
        let sampled = sampleVelocity(latitude, longitude, velocity);
        if (!sampled && maskAware) sampled = sampleVelocity(latitude, longitude, velocity, maskAware);
        if (!sampled) continue;
        const color = colorAtSpeed(Math.hypot(velocity[0], velocity[1]), theme, zoom);
        if (!color) continue;
        const offset = (y * width + x) * 4;
        pixels[offset] = color.red;
        pixels[offset + 1] = color.green;
        pixels[offset + 2] = color.blue;
        pixels[offset + 3] = Math.round(color.alpha * (oceanCoverage ?? 1) * 255);
      }
      return nextPixel === width * height;
    } };
  }

  function renderTintPixels(options) {
    const renderer = createTintPixelRenderer(options);
    renderer.renderNext(options.width * options.height);
    return renderer.pixels;
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
    zoom = () => 8,
    theme = () => document.documentElement.dataset.theme || 'light', mobile = () => matchMedia('(max-width: 600px)').matches }) {
    if (!L?.GridLayer || typeof sampleVelocity !== 'function') throw new TypeError('Leaflet and the shared current-tile sampler are required');
    let renderCount = 0;
    let renderedSamples = 0;
    let renderDurationMs = 0;
    let lastRenderMs = null;
    let cancelledJobs = 0;
    let maxWorkSliceMs = 0;

    const SpeedTintGridLayer = L.GridLayer.extend({
      options: { pane: 'currentSpeedTintPane', tileSize: 256, keepBuffer: 1, updateWhenIdle: true, updateWhenZooming: false },

      createTile(coords, done) {
        const tile = document.createElement('canvas');
        // Keep the established source sampling and output sizes. Edge extension
        // uses nearby valid currents without repainting the supported field.
        const outputResolution = 128;
        tile.width = outputResolution;
        tile.height = outputResolution;
        tile.setAttribute('aria-hidden', 'true');
        tile.className = 'regional-current-speed-tint-tile';
        if (!tile.getContext('2d', { alpha: true })) {
          queueMicrotask(() => done(new Error('Canvas 2D is unavailable for current speed tint'), tile));
          return tile;
        }
        this._queueTintTile(tile, coords, done);
        return tile;
      },

      _queueTintTile(tile, coords, done = null) {
        this._renderJobs ||= new Map();
        this._renderQueue ||= [];
        const previous = this._renderJobs.get(tile);
        if (previous) { previous.cancelled = true; cancelledJobs += 1; }
        const job = { tile, coords, done: done || previous?.done, cancelled: false, cpuMs: 0 };
        this._renderJobs.set(tile, job);
        const resolution = mobile() ? 32 : 48;
        const outputResolution = tile.width;
        const context = tile.getContext('2d', { alpha: true });

        const worldSize = this.options.tileSize * 2 ** coords.z;
        const pixelOriginX = coords.x * this.options.tileSize;
        const pixelOriginY = coords.y * this.options.tileSize;
        const longitudeAt = x => (pixelOriginX + (x + 0.5) * this.options.tileSize / resolution) / worldSize * 360 - 180;
        const latitudeAt = y => {
          const mercatorY = Math.PI * (1 - 2 * (pixelOriginY + (y + 0.5) * this.options.tileSize / resolution) / worldSize);
          return Math.atan(Math.sinh(mercatorY)) * 180 / Math.PI;
        };
        const render = oceanMaskTile => {
          if (job.cancelled || !this._map) return;
          job.renderer = createTintPixelRenderer({
            width: resolution,
            height: resolution,
            sampleVelocity,
            sampleOceanMask: sampleOceanMask ? (latitude, longitude) => sampleOceanMask(latitude, longitude, coords, oceanMaskTile) : null,
            oceanMaskTile,
            maskCoords: coords,
            latitudeAt,
            longitudeAt,
            theme: theme(),
            zoom: coords.z
          });
          job.finish = () => {
            const pixels = job.renderer.pixels;
            const speedCanvas = document.createElement('canvas');
            speedCanvas.width = resolution;
            speedCanvas.height = resolution;
            const speedContext = speedCanvas.getContext('2d', { alpha: true });
            const image = speedContext.createImageData(resolution, resolution);
            image.data.set(pixels);
            speedContext.putImageData(image, 0, 0);
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = 'high';
            // Finish into the existing tile only after all samples are ready.
            // Clearing or removing it at redraw time caused gaps during loading.
            context.clearRect(0, 0, outputResolution, outputResolution);
            context.drawImage(speedCanvas, 0, 0, outputResolution, outputResolution);
            tile.dataset.coastMask = oceanMaskTile?.canvas ? 'gebco' : 'current-validity';
            if (oceanMaskTile?.canvas) {
              context.globalCompositeOperation = 'destination-in';
              context.drawImage(oceanMaskTile.canvas,
                oceanMaskTile.x, oceanMaskTile.y, oceanMaskTile.width, oceanMaskTile.height,
                0, 0, outputResolution, outputResolution);
              context.globalCompositeOperation = 'source-over';
            }
            renderCount += 1;
            renderedSamples += resolution * resolution;
            // Defer initial readiness until Leaflet has registered the canvas.
            if (job.done) queueMicrotask(() => job.done(null, tile));
          };
          this._renderQueue.push(job);
          this._scheduleTintWork();
        };
        let oceanMaskResult;
        try {
          oceanMaskResult = getOceanMaskTile?.(coords) ?? null;
        } catch {
          oceanMaskResult = null;
        }
        Promise.resolve(oceanMaskResult).then(render, () => render(null));
      },

      _scheduleTintWork() {
        if (!this._map || this._dataPending || this._tintMoving || this._tintZooming || this._tintTimer != null || !this._renderQueue?.length) return;
        this._tintTimer = setTimeout(() => {
          this._tintTimer = null;
          if (!this._map || this._dataPending || this._tintMoving || this._tintZooming) return;
          const started = performance.now();
          // One layer-wide budget prevents many ready mask promises from
          // scheduling a separate uninterrupted raster task for every tile.
          while (this._renderQueue.length && performance.now() - started < 4) {
            const job = this._renderQueue[0];
            if (job.cancelled) { this._renderQueue.shift(); continue; }
            const stepStart = performance.now();
            const complete = job.renderer.renderNext(8);
            if (complete) job.finish();
            job.cpuMs += performance.now() - stepStart;
            if (complete) {
              lastRenderMs = job.cpuMs;
              renderDurationMs += job.cpuMs;
              job.tile.dataset.renderMs = job.cpuMs.toFixed(2);
              this._renderJobs.delete(job.tile);
              this._renderQueue.shift();
            }
          }
          maxWorkSliceMs = Math.max(maxWorkSliceMs, performance.now() - started);
          this._scheduleTintWork();
        }, 0);
      },

      _pauseTintWork(event) {
        if (event.type === 'zoomstart') this._tintZooming = true;
        else this._tintMoving = true;
        clearTimeout(this._tintTimer);
        this._tintTimer = null;
      },

      _resumeTintWork(event) {
        if (event.type === 'zoomend') this._tintZooming = false;
        else this._tintMoving = false;
        this._scheduleTintWork();
      },

      _cancelTintTile(event) {
        const job = this._renderJobs?.get(event.tile);
        if (job) { job.cancelled = true; cancelledJobs += 1; this._renderJobs.delete(event.tile); }
      },

      redraw() {
        this._dataPending = false;
        if (!this._map) return this;
        for (const entry of Object.values(this._tiles || {})) this._queueTintTile(entry.el, entry.coords);
        return this;
      },

      pauseForData() {
        this._dataPending = true;
        clearTimeout(this._tintTimer);
        this._tintTimer = null;
      },

      onAdd(map) {
        this._tintMoving = false;
        this._tintZooming = false;
        this.on('tileunload', this._cancelTintTile, this);
        map.on('movestart zoomstart', this._pauseTintWork, this);
        map.on('moveend zoomend', this._resumeTintWork, this);
        L.GridLayer.prototype.onAdd.call(this, map);
        this._themeObserver = new MutationObserver(() => this.redraw());
        this._themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      },

      onRemove(map) {
        map.off('movestart zoomstart', this._pauseTintWork, this);
        map.off('moveend zoomend', this._resumeTintWork, this);
        clearTimeout(this._tintTimer);
        this._tintTimer = null;
        for (const job of this._renderJobs?.values() || []) job.cancelled = true;
        this._renderJobs?.clear();
        this._renderQueue = [];
        this._themeObserver?.disconnect();
        this._themeObserver = null;
        L.GridLayer.prototype.onRemove.call(this, map);
        this.off('tileunload', this._cancelTintTile, this);
      }
    });

    const layer = new SpeedTintGridLayer();
    Object.defineProperty(layer, 'isOceanPath', { value:(fromLatitude, fromLongitude, toLatitude, toLongitude) =>
      createOceanPathCheck(sampleOceanMask, null, { z:zoom() })?.(fromLatitude, fromLongitude, toLatitude, toLongitude) ?? true });
    Object.defineProperty(layer, 'tintMetrics', { get: () => ({ renderCount, renderedSamples, renderDurationMs, lastRenderMs,
      pendingJobs: layer._renderJobs?.size || 0, cancelledJobs, maxWorkSliceMs }) });
    return layer;
  }

  return Object.freeze({ SPEED_STOPS, opacityForZoom, colorAtSpeed, renderTintPixels, createTintPixelRenderer, tileSampleCoordinates, createLayer });
});
