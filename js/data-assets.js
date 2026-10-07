(function exposeDataAssets(root) {
  const configuredBase = root.DIVEATLAS_DATA_ASSET_BASE_URL;
  let externalBase = null;
  if (configuredBase !== null && configuredBase !== undefined && configuredBase !== '') {
    const base = new URL(configuredBase, document.baseURI);
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/')) {
      throw new Error('External DiveAtlas data requires an HTTPS base URL ending in /.');
    }
    externalBase = base;
  }

  function dataAssetUrl(path) {
    if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\')) {
      throw new TypeError('Data asset paths must be non-empty relative paths.');
    }
    const suffixIndex = path.search(/[?#]/);
    const assetPath = suffixIndex < 0 ? path : path.slice(0, suffixIndex);
    const suffix = suffixIndex < 0 ? '' : path.slice(suffixIndex);
    const segments = assetPath.split('/');
    if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
      throw new TypeError('Data asset paths cannot contain empty or traversal segments.');
    }
    const base = externalBase || new URL('./', document.baseURI);
    return new URL(assetPath.split('/').map(encodeURIComponent).join('/') + suffix, base).href;
  }

  function shouldRewriteDataPath(pathname, appPath) {
    const appRelativePath = pathname.slice(appPath.length).split(/[?#]/, 1)[0];
    return appRelativePath.startsWith('data/');
  }

  root.DiveAtlasDataAssets = Object.freeze({
    external: externalBase !== null,
    url: dataAssetUrl,
    baseUrl: externalBase?.href || null
  });

  if (!externalBase) return;

  // Data URLs are authored as same-origin paths throughout this classic-script app.
  // Rewrite only app-owned data paths so application code and third-party requests stay local.
  const originalFetch = root.fetch.bind(root);
  root.fetch = (input, init) => {
    if (typeof input === 'string' || input instanceof URL) {
      const url = new URL(input, document.baseURI);
      const appPath = new URL('./', document.baseURI).pathname;
      if (url.origin === location.origin && shouldRewriteDataPath(url.pathname, appPath)) {
        const relative = url.pathname.slice(appPath.length) + url.search + url.hash;
        return originalFetch(dataAssetUrl(relative), init);
      }
    }
    if (input instanceof root.Request) {
      const url = new URL(input.url);
      const appPath = new URL('./', document.baseURI).pathname;
      if (url.origin === location.origin && shouldRewriteDataPath(url.pathname, appPath)) {
        const relative = url.pathname.slice(appPath.length) + url.search + url.hash;
        return originalFetch(new root.Request(dataAssetUrl(relative), input), init);
      }
    }
    return originalFetch(input, init);
  };

  const imageSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (imageSrc?.get && imageSrc?.set) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: imageSrc.configurable,
      enumerable: imageSrc.enumerable,
      get: imageSrc.get,
      set(value) { imageSrc.set.call(this, rewriteDataUrl(value)); }
    });
  }

  const scriptSrc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
  if (scriptSrc?.get && scriptSrc?.set) {
    Object.defineProperty(HTMLScriptElement.prototype, 'src', {
      configurable: scriptSrc.configurable,
      enumerable: scriptSrc.enumerable,
      get: scriptSrc.get,
      set(value) { scriptSrc.set.call(this, rewriteDataUrl(value)); }
    });
  }

  function rewriteDataUrl(value) {
    const url = new URL(value, document.baseURI);
    const appPath = new URL('./', document.baseURI).pathname;
    if (url.origin !== location.origin || !shouldRewriteDataPath(url.pathname, appPath)) return value;
    return dataAssetUrl(url.pathname.slice(appPath.length) + url.search + url.hash);
  }
})(typeof window === 'undefined' ? globalThis : window);
