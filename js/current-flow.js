(function attachCurrentFlow(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasCurrentFlow = api;
})(typeof window === 'undefined' ? globalThis : window, function buildCurrentFlow() {
  const FIELD_MAGIC = 'DAFV';
  const FIELD_HEADER_BYTES = 41;
  const MISSING_VALUE = -32768;
  const EARTH_RADIUS_M = 6_371_008.8;
  const TILE_SIZE_PX = 256;

  function decodeField(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < FIELD_HEADER_BYTES) {
      throw new TypeError('Current flow field is shorter than its header');
    }
    const view = new DataView(buffer);
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    const version = view.getUint8(4);
    const width = view.getUint16(5, true);
    const height = view.getUint16(7, true);
    const longitudeMin = view.getFloat64(9, true);
    const latitudeMax = view.getFloat64(17, true);
    const longitudeStep = view.getFloat64(25, true);
    const latitudeStep = view.getFloat64(33, true);
    if (magic !== FIELD_MAGIC || version !== 1 || !width || !height ||
        !Number.isFinite(longitudeMin) || !Number.isFinite(latitudeMax) ||
        !(longitudeStep > 0) || !(latitudeStep > 0) ||
        buffer.byteLength !== FIELD_HEADER_BYTES + width * height * 4) {
      throw new TypeError('Current flow field header or payload is invalid');
    }
    const u = new Int16Array(width * height);
    const v = new Int16Array(width * height);
    let offset = FIELD_HEADER_BYTES;
    for (let index = 0; index < u.length; index += 1) {
      u[index] = view.getInt16(offset, true);
      v[index] = view.getInt16(offset + 2, true);
      offset += 4;
    }
    return Object.freeze({ width, height, longitudeMin, latitudeMax, longitudeStep, latitudeStep,
      scale: 0.001, missingValue: MISSING_VALUE, u, v });
  }

  function bilinearVelocity(field, latitude, longitude) {
    if (!field || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    const span = (field.width - 1) * field.longitudeStep;
    let lon = longitude;
    if (span >= 359 && (lon < field.longitudeMin || lon > field.longitudeMin + span)) {
      lon = field.longitudeMin + ((lon - field.longitudeMin) % 360 + 360) % 360;
    }
    const x = (lon - field.longitudeMin) / field.longitudeStep;
    const y = (field.latitudeMax - latitude) / field.latitudeStep;
    if (x < -1e-9 || y < -1e-9 || x > field.width - 1 + 1e-9 || y > field.height - 1 + 1e-9) return null;
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(x0 + 1, field.width - 1);
    const y1 = Math.min(y0 + 1, field.height - 1);
    const fx = Math.max(0, Math.min(1, x - x0));
    const fy = Math.max(0, Math.min(1, y - y0));
    const corners = [
      [y0, x0, (1 - fx) * (1 - fy)], [y0, x1, fx * (1 - fy)],
      [y1, x0, (1 - fx) * fy], [y1, x1, fx * fy]
    ];
    let u = 0;
    let v = 0;
    for (const [row, column, weight] of corners) {
      if (weight <= 1e-9) continue;
      const index = row * field.width + column;
      const storedU = field.u[index];
      const storedV = field.v[index];
      if (storedU === field.missingValue || storedV === field.missingValue) return null;
      u += storedU * field.scale * weight;
      v += storedV * field.scale * weight;
    }
    return Object.freeze({ u, v, speed: Math.hypot(u, v) });
  }

  function geographicDisplacement(latitude, u, v, seconds) {
    if (![latitude, u, v, seconds].every(Number.isFinite) || seconds < 0 || Math.abs(latitude) >= 89.5) return null;
    const latitudeRadians = latitude * Math.PI / 180;
    const deltaLatitude = (v * seconds / EARTH_RADIUS_M) * 180 / Math.PI;
    const deltaLongitude = (u * seconds / (EARTH_RADIUS_M * Math.cos(latitudeRadians))) * 180 / Math.PI;
    return { latitude: latitude + deltaLatitude, longitude: deltaLongitude };
  }

  function advanceParticle(field, particle, deltaSeconds, { visualTimeScale = 1, maxAgeSeconds = 1.5 } = {}) {
    if (!particle || !Number.isFinite(particle.age) || particle.age >= maxAgeSeconds) return null;
    const velocity = bilinearVelocity(field, particle.latitude, particle.longitude);
    if (!velocity || velocity.speed < 0.005) return null;
    const delta = geographicDisplacement(particle.latitude, velocity.u, velocity.v,
      Math.max(0, Math.min(0.05, deltaSeconds)) * visualTimeScale);
    if (!delta) return null;
    const latitude = delta.latitude;
    const longitude = particle.longitude + delta.longitude;
    if (latitude < -85 || latitude > 85) return null;
    return Object.freeze({ latitude, longitude, age: particle.age + Math.max(0, deltaSeconds),
      u: velocity.u, v: velocity.v, speed: velocity.speed });
  }

  function fieldBounds(field) {
    return {
      west: field.longitudeMin - field.longitudeStep / 2,
      east: field.longitudeMin + (field.width - 1) * field.longitudeStep + field.longitudeStep / 2,
      north: field.latitudeMax + field.latitudeStep / 2,
      south: field.latitudeMax - (field.height - 1) * field.latitudeStep - field.latitudeStep / 2
    };
  }

  function longitudeIsWithinField(longitude, bounds) {
    const width = bounds.east - bounds.west;
    if (width >= 359) {
      longitude = bounds.west + ((longitude - bounds.west) % 360 + 360) % 360;
    }
    return longitude >= bounds.west && longitude <= bounds.east;
  }

  function adaptiveParticleCount({ width, height, mobile, cores, reducedMotion }) {
    if (reducedMotion) return 0;
    const areaScale = Math.sqrt(Math.max(1, width * height) / (1280 * 900));
    const deviceScale = mobile ? 0.4 : (cores > 0 && cores <= 4 ? 0.7 : 1);
    return Math.round(Math.max(mobile ? 1_000 : 2_500, Math.min(mobile ? 8_000 : 20_000,
      (mobile ? 2_000 : 5_000) * Math.max(0.6, Math.min(1.4, areaScale)) * deviceScale)));
  }

  function createRenderer({ L, map, baseUrl = 'tests/fixtures/regional-currents-flow', sampleVelocity = null, onDiagnostics = () => {} }) {
    if (!L || !map) throw new TypeError('Leaflet and map are required for the current flow renderer');
    const resolutions = new Set(['0.083', '0.25', '0.5']);
    const maxAgeSeconds = 1.35;
    const baseVisualTimeScale = 120_000;
    let canvas = null;
    let context = null;
    let field = null;
    let active = false;
    let rafId = 0;
    let generation = 0;
    let selectedResolution = '0.083';
    let selectedCount = null;
    let particles = null;
    let candidates = [];
    let lastFrame = 0;
    let lastFpsWindow = 0;
    let framesInWindow = 0;
    let frameIntervals = [];
    let drawDuration = 0;
    let visibleSegments = 0;
    let firstFrameMs = null;
    let activatedAt = 0;
    let resizeObserver = null;
    let intersectObserver = null;
    let inViewport = true;
    let unavailableReason = null;
    let mapGestureActive = false;
    let respawnCount = 0;
    const sampledVelocity = new Float64Array(2);
    const usesSharedTiles = typeof sampleVelocity === 'function';
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const viewportSize = () => map.getSize();
    const defaultParticleCount = () => {
      const size = viewportSize();
      return adaptiveParticleCount({ width: size.x, height: size.y, mobile: size.x <= 600,
        cores: navigator.hardwareConcurrency || 0, reducedMotion: reducedMotion.matches });
    };

    function diagnostics(status = 'idle', extras = {}) {
      const size = viewportSize();
      const now = performance.now();
      const sorted = [...frameIntervals].sort((a, b) => a - b);
      onDiagnostics({
        status, resolution: selectedResolution, particleCount: particles?.longitudes.length || 0,
        loadedBytes: field?._compressedBytes || 0, cacheEntries: field ? 1 : 0,
        fps: framesInWindow, meanFrameMs: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null,
        p99FrameMs: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] : null,
        worstFrameMs: sorted.length ? sorted[sorted.length - 1] : null,
        drawCpuMs: drawDuration, firstFlowVisibleMs: firstFrameMs,
        heapBytes: performance.memory?.usedJSHeapSize ?? null,
        canvasBytes: canvas ? canvas.width * canvas.height * 4 : 0,
        decodeMs: field?._decodeMs ?? null,
        downloadMs: field?._downloadMs ?? null,
        decompressionMs: field?._decompressionMs ?? null,
        renderCpuPercent: null,
        rafEligible: Boolean(active && (field || usesSharedTiles) && !document.hidden && inViewport &&
          !reducedMotion.matches && particles && !mapGestureActive),
        inViewport,
        reducedMotion: reducedMotion.matches,
        rafPending: Boolean(rafId),
        contextReady: Boolean(context),
        mapGestureActive,
        pauseReason: document.hidden ? 'hidden' : !inViewport ? 'outside-viewport' : reducedMotion.matches ? 'reduced-motion'
          : mapGestureActive ? 'map-gesture' : !particles ? 'no-particles' : null,
        elapsedMs: activatedAt ? now - activatedAt : 0,
        ...extras
      });
    }

    function clearTrails() {
      if (context && canvas) context.clearRect(0, 0, canvas.width, canvas.height);
    }

    function syncCanvasPosition() {
      if (!canvas || !map.getPane?.('currentFlowPane') || canvas.parentElement !== map.getPane('currentFlowPane')) return;
      // A pane child inherits Leaflet's map transform. Offset it back to the map
      // container origin so its existing container-pixel particle coordinates stay valid.
      const layerOrigin = map.containerPointToLayerPoint([0, 0]);
      canvas.style.left = `${layerOrigin.x}px`;
      canvas.style.top = `${layerOrigin.y}px`;
    }

    function clearOverlayFootprints() {
      if (!context || !canvas) return;
      const containerRect = map.getContainer().getBoundingClientRect();
      for (const overlay of map.getContainer().querySelectorAll('.leaflet-popup, .leaflet-tooltip')) {
        if (!overlay.getClientRects().length || getComputedStyle(overlay).visibility === 'hidden') continue;
        const overlayRect = overlay.getBoundingClientRect();
        // Include the popup tip, tooltip arrow, and soft edges around each box.
        const left = Math.max(0, overlayRect.left - containerRect.left - 8);
        const top = Math.max(0, overlayRect.top - containerRect.top - 8);
        const right = Math.min(containerRect.width, overlayRect.right - containerRect.left + 8);
        const bottom = Math.min(containerRect.height, overlayRect.bottom - containerRect.top + 8);
        if (right > left && bottom > top) context.clearRect(left, top, right - left, bottom - top);
      }
    }

    function resizeCanvas() {
      if (!canvas) return;
      const size = viewportSize();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(size.x * ratio));
      canvas.height = Math.max(1, Math.round(size.y * ratio));
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      context?.setTransform(ratio, 0, 0, ratio, 0, 0);
      syncCanvasPosition();
      clearTrails();
      rebuildCandidates(true);
    }

    function ensureCanvas() {
      if (canvas) return;
      const container = map.getContainer();
      let pane = map.getPane?.('currentFlowPane');
      if (pane) {
        pane.classList.add('current-flow-screen-pane');
        pane.style.pointerEvents = 'none';
        // Leaflet panes do not have viewport dimensions; clipping to the pane box
        // would hide this viewport-sized canvas entirely.
        pane.style.overflow = 'visible';
      } else pane = container.querySelector(':scope > .current-flow-screen-pane');
      if (!pane) {
        pane = document.createElement('div');
        pane.className = 'current-flow-screen-pane';
        // Flow points use container pixels; keeping this above mapPane (400) avoids applying Leaflet's pan transform twice.
        Object.assign(pane.style, {
          position: 'absolute', inset: '0', zIndex: '401',
          pointerEvents: 'none', overflow: 'hidden'
        });
        container.appendChild(pane);
      }
      canvas = document.createElement('canvas');
      canvas.className = 'regional-current-flow-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none' });
      pane.appendChild(canvas);
      context = canvas.getContext('2d', { alpha: true });
      resizeCanvas();
      resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resizeCanvas) : null;
      resizeObserver?.observe(map.getContainer());
      intersectObserver = typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(entries => {
          inViewport = Boolean(entries[0]?.isIntersecting);
          if (inViewport) scheduleFrame();
          else { pauseFrame(); diagnostics('paused-outside-viewport'); }
        }) : null;
      intersectObserver?.observe(map.getContainer());
      map.on('moveend zoomend resize', handleMapViewChange);
      map.on('movestart zoomstart', startMapGesture);
      document.addEventListener('visibilitychange', handleVisibilityChange);
      reducedMotion.addEventListener?.('change', handleReducedMotionChange);
    }

    function detachCanvas() {
      pauseFrame();
      resizeObserver?.disconnect(); resizeObserver = null;
      intersectObserver?.disconnect(); intersectObserver = null;
      map.off('moveend zoomend resize', handleMapViewChange);
      map.off('movestart zoomstart', startMapGesture);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      reducedMotion.removeEventListener?.('change', handleReducedMotionChange);
      canvas?.remove();
      canvas = null; context = null;
      particles = null; candidates = [];
      field = null;
    }

    function pauseFrame() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      lastFrame = 0;
    }

    function handleVisibilityChange() {
      if (document.hidden) { pauseFrame(); clearTrails(); diagnostics('paused-hidden'); }
      else scheduleFrame();
    }

    function handleReducedMotionChange() {
      if (reducedMotion.matches) { pauseFrame(); clearTrails(); diagnostics('reduced-motion'); }
      else { diagnostics('resumed'); scheduleFrame(); }
    }

    function startMapGesture() {
      mapGestureActive = true;
      pauseFrame();
      clearTrails();
    }

    function handleMapViewChange() {
      mapGestureActive = false;
      syncCanvasPosition();
      clearTrails();
      rebuildCandidates(true);
      scheduleFrame();
    }

    function rebuildCandidates(reseed = false) {
      if ((!field && !usesSharedTiles) || !canvas) return;
      const size = viewportSize();
      const next = [];
      if (usesSharedTiles) {
        const currentZoom = map.getZoom();
        const target = selectedCount == null ? defaultParticleCount() : selectedCount;
        // A bounded jittered screen grid keeps startup work tied to viewport area. Random
        // rejection sampling can otherwise spend tens of thousands of projections over land.
        const spacing = Math.max(8, Math.min(24, Math.sqrt((size.x * size.y) / Math.max(1_000, target * 1.5))));
        for (let y = spacing / 2; y < size.y; y += spacing) {
          for (let x = spacing / 2; x < size.x; x += spacing) {
            const point = L.point(x + (Math.random() - 0.5) * spacing * 0.8,
              y + (Math.random() - 0.5) * spacing * 0.8);
            const latlng = map.containerPointToLatLng(point);
            if (latlng.lat < -79.5 || latlng.lat > 84.5 || !sampleVelocity(latlng.lat, latlng.lng, sampledVelocity)) continue;
            if (sampledVelocity[0] * sampledVelocity[0] + sampledVelocity[1] * sampledVelocity[1] < 0.000025) continue;
            // Keep Leaflet's unwrapped longitude so a wide viewport can seed
            // particles in each horizontally repeated world copy.
            next.push({ latitude: latlng.lat, longitude: latlng.lng, halfLatitude: 0, halfLongitude: 0 });
          }
        }
        candidates = next;
        if (reseed && particles) seedParticles(particles.longitudes.length);
        if (!candidates.length) { pauseFrame(); diagnostics('waiting-for-current-tiles', { zoom: currentZoom, candidateCount: 0 }); }
        return;
      }
      const zoom = map.getZoom();
      const bounds = map.getBounds();
      const halfCellWidth = field.longitudeStep * 256 * 2 ** zoom / 720;
      for (let row = 0; row < field.height - 1; row += 1) {
        const latitude = field.latitudeMax - (row + 0.5) * field.latitudeStep;
        const halfCellHeight = field.latitudeStep * 256 * 2 ** zoom /
          (720 * Math.max(0.01, Math.cos(latitude * Math.PI / 180)));
        for (let column = 0; column < field.width - 1; column += 1) {
          const longitude = field.longitudeMin + (column + 0.5) * field.longitudeStep;
          const velocity = bilinearVelocity(field, latitude, longitude);
          if (!velocity || velocity.speed < 0.005) continue;
          const firstCopy = Math.ceil((bounds.getWest() - longitude - halfCellWidth) / 360);
          const lastCopy = Math.floor((bounds.getEast() - longitude + halfCellWidth) / 360);
          for (let copy = firstCopy; copy <= lastCopy; copy += 1) {
            const worldLongitude = longitude + copy * 360;
            const point = map.latLngToContainerPoint([latitude, worldLongitude]);
            if (point.x < -halfCellWidth || point.y < -halfCellHeight ||
                point.x > size.x + halfCellWidth || point.y > size.y + halfCellHeight) continue;
            // Sub-cell seeding avoids a visible particle lattice at coarse data resolutions.
            // Each visible world copy gets candidates from the same valid source cell.
            next.push({ latitude, longitude: worldLongitude, halfLatitude: field.latitudeStep / 2, halfLongitude: field.longitudeStep / 2 });
          }
        }
      }
      candidates = next;
      if (reseed && particles) seedParticles(particles.longitudes.length);
      if (!candidates.length) { pauseFrame(); diagnostics('no-valid-water-in-viewport'); }
    }

    function seedParticles(count) {
      if (!count || !candidates.length) { particles = null; return; }
      const longitudes = new Float32Array(count);
      const latitudes = new Float32Array(count);
      const ages = new Float32Array(count);
      const previousX = new Float32Array(count);
      const previousY = new Float32Array(count);
      for (let index = 0; index < count; index += 1) {
        const candidate = candidates[Math.floor(Math.random() * candidates.length)];
        longitudes[index] = candidate.longitude + (Math.random() * 2 - 1) * candidate.halfLongitude;
        latitudes[index] = candidate.latitude + (Math.random() * 2 - 1) * candidate.halfLatitude;
        ages[index] = Math.random() * maxAgeSeconds;
        const point = map.latLngToContainerPoint([latitudes[index], longitudes[index]]);
        previousX[index] = point.x;
        previousY[index] = point.y;
      }
      particles = { longitudes, latitudes, ages, previousX, previousY };
    }

    function ensureField(nextGeneration) {
      const url = `${baseUrl.replace(/\/$/, '')}/field-${selectedResolution}.bin.gz`;
      const requestedResolution = selectedResolution;
      const requestStarted = performance.now();
      diagnostics('loading-field');
      return fetch(url).then(response => {
        if (!response.ok) throw new Error(`Experimental current field returned HTTP ${response.status}`);
        const compressedBytes = Number(response.headers.get('content-length')) || 0;
        return response.arrayBuffer().then(compressed => ({ compressed, compressedBytes, downloadMs: performance.now() - requestStarted }));
      }).then(async ({ compressed, compressedBytes, downloadMs }) => {
        if (typeof DecompressionStream !== 'function') throw new Error('Gzip decompression is unavailable');
        const decompressStarted = performance.now();
        const raw = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
        const decompressionMs = performance.now() - decompressStarted;
        const decodeStarted = performance.now();
        const decoded = decodeField(raw);
        const binaryDecodeMs = performance.now() - decodeStarted;
        if (nextGeneration !== generation || requestedResolution !== selectedResolution) return;
        field = Object.freeze({ ...decoded, _compressedBytes: compressedBytes || compressed.byteLength,
          _downloadMs: downloadMs, _decompressionMs: decompressionMs, _decodeMs: binaryDecodeMs });
        const automaticCount = defaultParticleCount();
        rebuildCandidates(false);
        seedParticles(selectedCount == null ? automaticCount : selectedCount);
        firstFrameMs = null;
        diagnostics('field-ready', { downloadMs: field._downloadMs, decompressionMs, binaryDecodeMs });
        scheduleFrame();
      });
    }

    function scheduleFrame() {
      if (!active || (!field && !usesSharedTiles) || rafId || document.hidden || !inViewport || reducedMotion.matches || !particles) return;
      rafId = requestAnimationFrame(drawFrame);
    }

    function respawn(index) {
      let candidate = candidates[Math.floor(Math.random() * candidates.length)];
      if (usesSharedTiles && !candidate) {
        const size = viewportSize();
        for (let attempt = 0; attempt < 40; attempt += 1) {
          const latlng = map.containerPointToLatLng(L.point(Math.random() * size.x, Math.random() * size.y));
          if (latlng.lat < -79.5 || latlng.lat > 84.5 || !sampleVelocity(latlng.lat, latlng.lng, sampledVelocity) ||
              Math.hypot(sampledVelocity[0], sampledVelocity[1]) < 0.005) continue;
          candidate = { latitude: latlng.lat, longitude: latlng.lng, halfLatitude: 0, halfLongitude: 0 };
          break;
        }
      }
      if (!candidate) return false;
      respawnCount += 1;
      particles.longitudes[index] = candidate.longitude + (Math.random() * 2 - 1) * candidate.halfLongitude;
      particles.latitudes[index] = candidate.latitude + (Math.random() * 2 - 1) * candidate.halfLatitude;
      particles.ages[index] = 0;
      const point = map.latLngToContainerPoint([particles.latitudes[index], particles.longitudes[index]]);
      particles.previousX[index] = point.x;
      particles.previousY[index] = point.y;
      return true;
    }

    function drawFrame(timestamp) {
      rafId = 0;
      if (!active || (!field && !usesSharedTiles) || !context || document.hidden || !inViewport || reducedMotion.matches || mapGestureActive) {
        return;
      }
      const size = viewportSize();
      const actualFrameIntervalMs = lastFrame ? Math.max(0, timestamp - lastFrame) : 16;
      const deltaSeconds = Math.min(0.05, actualFrameIntervalMs / 1000);
      lastFrame = timestamp;
      const frameStart = performance.now();
      context.globalCompositeOperation = 'destination-out';
      context.fillStyle = 'rgba(0,0,0,0.14)';
      context.fillRect(0, 0, size.x, size.y);
      context.globalCompositeOperation = 'source-over';
      context.beginPath();
      const theme = document.documentElement.dataset.theme;
      // Keep the flow distinctly blue so it does not blend into the teal reef overlay.
      context.strokeStyle = theme === 'dark' ? 'rgba(92, 153, 255, 0.82)' : 'rgba(59, 115, 232, 0.76)';
      context.lineWidth = window.innerWidth <= 600 ? 0.9 : 1.05;
      context.lineCap = 'round';
      let drawn = 0;
      const bounds = usesSharedTiles ? null : fieldBounds(field);
      const zoom = map.getZoom();
      const zoomCompensation = 2 ** (7 - zoom);
      const pixelsPerProjectedMeter = TILE_SIZE_PX * 2 ** zoom / (2 * Math.PI * EARTH_RADIUS_M);
      for (let index = 0; index < particles.longitudes.length; index += 1) {
        const previousLongitude = particles.longitudes[index];
        const previousLatitude = particles.latitudes[index];
        if (particles.ages[index] >= maxAgeSeconds) { respawn(index); continue; }
        let u; let v; let speed; let nextLongitude; let nextLatitude;
        if (usesSharedTiles) {
          if (!sampleVelocity(previousLatitude, previousLongitude, sampledVelocity)) { respawn(index); continue; }
          u = sampledVelocity[0]; v = sampledVelocity[1]; speed = Math.hypot(u, v);
          if (speed < 0.005 || Math.abs(previousLatitude) >= 89.5) { respawn(index); continue; }
          const seconds = deltaSeconds * baseVisualTimeScale * zoomCompensation;
          nextLatitude = previousLatitude + (v * seconds / EARTH_RADIUS_M) * 180 / Math.PI;
          nextLongitude = previousLongitude + (u * seconds / (EARTH_RADIUS_M * Math.cos(previousLatitude * Math.PI / 180))) * 180 / Math.PI;
          if (nextLatitude < -79.5 || nextLatitude > 84.5) { respawn(index); continue; }
        } else {
          const advanced = advanceParticle(field, { longitude: previousLongitude, latitude: previousLatitude, age: particles.ages[index] },
            deltaSeconds, { visualTimeScale: baseVisualTimeScale * zoomCompensation, maxAgeSeconds });
          if (!advanced || !longitudeIsWithinField(advanced.longitude, bounds) ||
              advanced.latitude < bounds.south || advanced.latitude > bounds.north) { respawn(index); continue; }
          u = advanced.u; v = advanced.v; speed = advanced.speed;
          nextLongitude = advanced.longitude; nextLatitude = advanced.latitude;
        }
        const latitudeFactor = 1 / Math.cos(previousLatitude * Math.PI / 180);
        const projectedScale = deltaSeconds * baseVisualTimeScale * zoomCompensation * pixelsPerProjectedMeter * latitudeFactor;
        const oldX = particles.previousX[index];
        const oldY = particles.previousY[index];
        const newX = oldX + u * projectedScale;
        const newY = oldY - v * projectedScale;
        if (Math.hypot(newX - oldX, newY - oldY) > 0 && Math.abs(oldX - newX) < size.x / 2) {
          context.moveTo(oldX, oldY);
          context.lineTo(newX, newY);
          particles.previousX[index] = newX;
          particles.previousY[index] = newY;
          drawn += 1;
        }
        particles.longitudes[index] = nextLongitude;
        particles.latitudes[index] = nextLatitude;
        particles.ages[index] += deltaSeconds;
      }
      context.stroke();
      // The screen-space canvas must remain above Leaflet's map pane to track map
      // drags without offset. Clear open popup and tooltip footprints so overlay
      // content stays legible while the current animation continues across the map.
      clearOverlayFootprints();
      if (firstFrameMs == null && drawn) {
        firstFrameMs = performance.now() - activatedAt;
        diagnostics('field-ready');
      }
      drawDuration += performance.now() - frameStart;
      visibleSegments = drawn;
      framesInWindow += 1;
      if (!lastFpsWindow) lastFpsWindow = timestamp;
      frameIntervals.push(actualFrameIntervalMs);
      if (frameIntervals.length > 240) frameIntervals.shift();
      if (timestamp - lastFpsWindow >= 1000) {
        const fpsWindowMs = timestamp - lastFpsWindow;
        lastFpsWindow = timestamp;
        const frameCount = framesInWindow;
        framesInWindow = 0;
        const renderCpuPercent = Math.min(100, drawDuration / Math.max(1, fpsWindowMs) * 100);
        diagnostics('animating', { frameCount, fps: frameCount * 1000 / fpsWindowMs, visibleSegments, renderCpuPercent });
        drawDuration = 0;
      }
      scheduleFrame();
    }

    function activate({ month = 9, depth = '0', resolution = selectedResolution, particleCount = selectedCount } = {}) {
      selectedResolution = String(resolution);
      if (!resolutions.has(selectedResolution)) throw new RangeError('Unsupported experimental current resolution');
      selectedCount = particleCount == null ? null : Math.max(0, Math.floor(particleCount));
      activatedAt = performance.now();
      firstFrameMs = null;
      generation += 1;
      const currentGeneration = generation;
      active = true;
      mapGestureActive = false;
      ensureCanvas();
      if (usesSharedTiles) {
        unavailableReason = null;
        rebuildCandidates(false);
        const automaticCount = defaultParticleCount();
        seedParticles(selectedCount == null ? automaticCount : selectedCount);
        firstFrameMs = null;
        diagnostics('waiting-for-current-tiles');
        scheduleFrame();
        return Promise.resolve(true);
      }
      if (Number(month) !== 9 || !['0', 'surface'].includes(String(depth))) {
        unavailableReason = 'This experiment contains September surface data only.';
        diagnostics('slice-unavailable');
        return Promise.resolve(false);
      }
      active = true;
      unavailableReason = null;
      return ensureField(currentGeneration).then(() => true).catch(error => {
        if (currentGeneration === generation) { active = false; diagnostics('error'); onDiagnostics({ status: 'error', error: String(error) }); }
        return false;
      });
    }

    function setResolution(resolution) {
      const next = String(resolution);
      if (!resolutions.has(next)) return Promise.resolve(false);
      selectedResolution = next;
      if (!active) return Promise.resolve(true);
      activatedAt = performance.now();
      firstFrameMs = null;
      generation += 1;
      field = null; particles = null; clearTrails();
      return ensureField(generation).then(() => true);
    }

    function setParticleCount(count) {
      selectedCount = count == null ? null : Math.max(0, Math.floor(Number(count) || 0));
      if (field && active) {
        const effectiveCount = selectedCount == null ? defaultParticleCount() : selectedCount;
        rebuildCandidates(false);
        seedParticles(effectiveCount);
        clearTrails();
        framesInWindow = 0; frameIntervals = []; drawDuration = 0; firstFrameMs = null; activatedAt = performance.now();
        lastFpsWindow = 0;
        diagnostics('warming');
        scheduleFrame();
      }
      return selectedCount;
    }

    function selectSlice(month, depth) {
      if (!active) return Promise.resolve(false);
      if (usesSharedTiles) {
        diagnostics('waiting-for-current-tiles', { month: Number(month), depth: String(depth) });
        return Promise.resolve(true);
      }
      generation += 1;
      activatedAt = performance.now();
      firstFrameMs = null;
      field = null; particles = null; clearTrails(); pauseFrame();
      if (Number(month) !== 9 || !['0', 'surface'].includes(String(depth))) {
        unavailableReason = 'This experiment contains September surface data only.';
        diagnostics('slice-unavailable');
        return Promise.resolve(false);
      }
      unavailableReason = null;
      return ensureField(generation).then(() => true);
    }

    function deactivate() {
      active = false;
      generation += 1;
      detachCanvas();
      diagnostics('off');
    }

    function refreshData() {
      if (!active || !usesSharedTiles) return false;
      rebuildCandidates(true);
      if (!particles && candidates.length) {
        const count = selectedCount == null ? defaultParticleCount() : selectedCount;
        seedParticles(count);
      }
      if (particles && candidates.length) {
        diagnostics('tiles-ready', { candidateCount: candidates.length });
        scheduleFrame();
      } else diagnostics('waiting-for-current-tiles', { candidateCount: candidates.length });
      return candidates.length > 0;
    }

    return Object.freeze({ activate, deactivate, setResolution, setParticleCount, selectSlice, refreshData, clearOverlayFootprints,
      get state() { return { active, resolution: selectedResolution, particleCount: particles?.longitudes.length || 0,
        loadedBytes: field?._compressedBytes || 0, canvasAttached: Boolean(canvas), rafActive: Boolean(rafId),
        unavailableReason, visibleSegments, respawnCount }; } });
  }

  return Object.freeze({ decodeField, bilinearVelocity, geographicDisplacement, advanceParticle, fieldBounds,
    adaptiveParticleCount, createRenderer, FIELD_HEADER_BYTES, MISSING_VALUE, EARTH_RADIUS_M });
});
