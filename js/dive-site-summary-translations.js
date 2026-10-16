(function (root) {
  'use strict';

  const languages = new Set(['zh', 'ja', 'fr', 'de', 'nl', 'it', 'ru', 'pt', 'sv', 'no', 'es', 'ko', 'id']);

  function create({ fetch: fetchData = (...args) => root.fetch(...args), warn = (...args) => console.warn(...args) } = {}) {
    const loaded = new Map();
    const pending = new Map();

    function translate(language, english) {
      const entries = loaded.get(language)?.byEnglish;
      // Exact source keys deliberately invalidate translations after English
      // claims change, without requiring asynchronous hashing during rendering.
      return entries && Object.prototype.hasOwnProperty.call(entries, english)
        && typeof entries[english] === 'string' && entries[english].trim()
        ? entries[english] : english;
    }

    function ensure(language) {
      if (!languages.has(language)) return Promise.resolve(false);
      if (loaded.has(language)) return Promise.resolve(true);
      if (pending.has(language)) return pending.get(language);
      const request = (async () => {
        const response = await fetchData(`datasets/dive-site-summary-translations/${language}.json.gz?v=1`);
        if (!response.ok || !response.body) throw new Error(`Summary translation HTTP ${response.status}`);
        const payload = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
        if (payload?.schema !== 'dive-site-summary-translations-v1' || payload.language !== language
          || !payload.byEnglish || typeof payload.byEnglish !== 'object' || Array.isArray(payload.byEnglish)) {
          throw new Error('Invalid summary translation dataset');
        }
        loaded.set(language, payload);
        return true;
      })().catch(error => {
        // Optional translation failures must never hide a sourced summary.
        // Clear pending requests so a later popup can retry a transient failure.
        warn(`Dive-site summaries remain in English for ${language}.`, error);
        return false;
      }).finally(() => pending.delete(language));
      pending.set(language, request);
      return request;
    }

    return { ensure, translate };
  }

  root.DiveAtlasSummaryTranslations = create();
  if (typeof module !== 'undefined' && module.exports) module.exports = { create };
})(typeof window !== 'undefined' ? window : globalThis);
