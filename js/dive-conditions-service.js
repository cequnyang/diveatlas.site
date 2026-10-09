(function attachDiveConditionsService(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasConditionsService = api;
})(typeof window === 'undefined' ? globalThis : window, function buildDiveConditionsService() {
  function createDiveConditionsService({ temperature, clarity, current, waves, model }) {
    function distanceKm(aLat, aLon, bLat, bLon) {
      const radians = value => value * Math.PI / 180;
      const dLat = radians(bLat - aLat), dLon = radians(bLon - aLon);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLon / 2) ** 2;
      return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    async function query(location, month, { signal } = {}) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const queryTemperature = async () => {
        try {
          return await temperature.query(location, {
            month, depth:5, signal, maxDistanceKm:25, includeProfile:false, includeYear:false
          });
        } catch (firstError) {
          if (signal?.aborted || firstError?.name === 'AbortError') throw firstError;
          // A transient chunk request must not turn an otherwise supported dive location into a missing score dimension.
          return temperature.query(location, {
            month, depth:5, signal, maxDistanceKm:25, includeProfile:false, includeYear:false
          });
        }
      };
      const [t, c, r, w] = await Promise.allSettled([
        queryTemperature(),
        clarity.query(location, { month, maxDistanceKm:25 }),
        current.sample(location.lat, location.lng, month, '10'),
        waves.sample(location.lat, location.lng, month, { signal })
      ]);
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const unwrap = result => result.status === 'fulfilled' ? result.value : null;
      const tv = unwrap(t), cv = unwrap(c), rv = unwrap(r), wv = unwrap(w);
      const lookup = (settled, value) => settled.status === 'rejected'
        ? { lookupStatus:'request_failed', lookupError:String(settled.reason?.message || settled.reason || 'Unknown request error') }
        : value == null || settled.value?.unavailable
          ? { lookupStatus:'no_data', lookupError:null }
          : { lookupStatus:'available', lookupError:null };
      for (const [name, settled] of Object.entries({ temperature:t, clarity:c, current:r, waves:w })) {
        if (settled.status === 'rejected' && settled.reason?.name !== 'AbortError') {
          console.warn(`Dive conditions ${name} data request failed:`, settled.reason);
        }
      }
      const source = (metadata, overrides = {}) => ({
        provenance: metadata?.source || metadata?.source_product || metadata?.dataset_id || null,
        resolution: metadata?.source_resolution_degrees ? `${metadata.source_resolution_degrees}°` : metadata?.source_resolution_km ? `${metadata.source_resolution_km} km` : null,
        period: metadata?.climatology_period || null, ...overrides
      });
      const samples = {
        temperature: { value: tv && !tv.unavailable ? tv.value_c : null, ...lookup(t, tv?.value_c), unit: '°C',
          estimated: Boolean(tv?.nearby_estimate),
          sourceLocation: tv?.source_latitude != null ? `${tv.source_latitude.toFixed(4)}, ${tv.source_longitude.toFixed(4)}` : null,
          sourceLatitude:tv?.source_latitude ?? null, sourceLongitude:tv?.source_longitude ?? null,
          sampleDistanceKm: tv?.sample_distance_km ?? null,
          fallbackBehavior:'Nearest valid same-month, 5 m native grid cell within 25 km; otherwise unavailable.', ...source(tv?.metadata) },
        clarity: { value: cv && !cv.unavailable ? cv.value_m : null, ...lookup(c, cv?.value_m), unit: 'm',
          sourceLocation: cv?.source_latitude != null ? `${cv.source_latitude.toFixed(4)}, ${cv.source_longitude.toFixed(4)}` : null,
          sourceLatitude:cv?.source_latitude ?? null, sourceLongitude:cv?.source_longitude ?? null,
          sampleDistanceKm: cv?.sample_distance_km ?? null,
          fallbackBehavior:'Nearest valid optical grid sample within 25 km; otherwise unavailable.',
          ...source(cv?.metadata, { provenance: 'Satellite-derived Secchi transparency', resolution: `${cv?.metadata?.source_resolution_km || 4} km` }) },
        current: { value: rv?.speed ?? null, ...lookup(r, rv?.speed), unit: 'm/s', sourceLocation: rv ? `${rv.source_latitude.toFixed(4)}, ${rv.source_longitude.toFixed(4)}` : null,
          sourceLatitude:rv?.source_latitude ?? null, sourceLongitude:rv?.source_longitude ?? null,
          sampleDistanceKm: rv ? distanceKm(location.lat, location.lng, rv.source_latitude, rv.source_longitude) : null,
          fallbackBehavior:'Nearest available coarse regional model grid cell; no extra-radius search.',
          ...source(rv?.metadata, { provenance: 'Copernicus Marine regional ocean-model current', resolution: `${(rv?.metadata?.grid?.longitude_step * 4 * 111).toFixed(1) || '37'} km grid`, period: 'Monthly climatology' }) },
        waves: { value: wv?.height_m ?? null, ...lookup(w, wv?.height_m), unit: 'm', sourceLocation: wv ? `${wv.source_latitude.toFixed(2)}, ${wv.source_longitude.toFixed(2)}` : null,
          sourceLatitude:wv?.source_latitude ?? null, sourceLongitude:wv?.source_longitude ?? null,
          sampleDistanceKm: wv ? distanceKm(location.lat, location.lng, wv.source_latitude, wv.source_longitude) : null,
          fallbackBehavior:'Nearest available regional wave grid cell; missing ocean data remains unavailable.',
          ...source(waves.getMetadata?.(), { provenance: waves.getMetadata?.()?.dataset_id || 'Copernicus Marine wave model', resolution: `${waves.getMetadata?.()?.grid?.resolution_degrees || 0.2}°`, period: waves.getMetadata?.()?.climatology_period || null }) }
      };
      return model.createResult({ location, month, samples });
    }
    return Object.freeze({ query });
  }
  return Object.freeze({ createDiveConditionsService });
});
