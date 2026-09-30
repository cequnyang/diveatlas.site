(function attachCurrentTileCache(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiveAtlasCurrentTileCache = api;
})(typeof window === 'undefined' ? globalThis : window, function buildCurrentTileCache() {
  const FORMAT_MAGIC = 'DATC';
  const FORMAT_VERSION = 1;
  const HEADER_BYTES = 16;
  const MISSING_VALUE = -32768;

  function decodeTile(buffer, expected = {}) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < HEADER_BYTES) {
      throw new TypeError('Current tile is shorter than its header');
    }
    const bytes = new Uint8Array(buffer, 0, 4);
    if (String.fromCharCode(...bytes) !== FORMAT_MAGIC) throw new TypeError('Current tile magic is invalid');
    const view = new DataView(buffer);
    const version = view.getUint8(4);
    const log2Size = view.getUint8(5);
    const step = view.getUint8(6);
    const scaleMillimetersPerSecond = view.getUint16(8, true);
    const width = 2 ** log2Size;
    const height = view.getUint16(10, true);
    const row = view.getUint16(12, true);
    const column = view.getUint16(14, true);
    if (version !== FORMAT_VERSION || width !== expected.tileSize || height !== expected.tileSize ||
        step !== expected.step || (expected.row != null && row !== expected.row) ||
        (expected.column != null && column !== expected.column) || !scaleMillimetersPerSecond) {
      throw new TypeError('Current tile header does not match metadata or its requested address');
    }
    if (buffer.byteLength !== HEADER_BYTES + width * height * 4) {
      throw new TypeError('Current tile sample payload has an invalid length');
    }
    const samples = new Int16Array(buffer, HEADER_BYTES);
    return Object.freeze({
      width, height, step, row, column,
      scale: scaleMillimetersPerSecond / 1000,
      missingValue: MISSING_VALUE,
      samples
    });
  }

  class LruTileCache {
    constructor(maxEntries = 96) {
      if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new RangeError('maxEntries must be positive');
      this.maxEntries = maxEntries;
      this.entries = new Map();
    }

    get(key) {
      if (!this.entries.has(key)) return undefined;
      const value = this.entries.get(key);
      this.entries.delete(key);
      this.entries.set(key, value);
      return value;
    }

    set(key, value) {
      this.entries.delete(key);
      this.entries.set(key, value);
      while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
    }

    get size() { return this.entries.size; }
    clear() { this.entries.clear(); }
  }

  function tileCacheKey({ version, month, depth, step, column, row }) {
    return [version, month, depth, step, column, row].join('/');
  }

  return Object.freeze({ decodeTile, LruTileCache, tileCacheKey, HEADER_BYTES, MISSING_VALUE });
});
