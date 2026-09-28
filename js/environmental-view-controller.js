(function attachEnvironmentalViewController(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory;
  } else {
    root.DiveAtlasEnvironmentalViewController = factory;
  }
})(typeof window === 'undefined' ? globalThis : window, function createEnvironmentalViewController({
  initialView = 'default',
  views = {},
  onChange = () => {}
} = {}) {
  const handlers = new Map(Object.entries(views));
  let activeView = initialView;
  let generation = 0;

  function register(id, handler) {
    if (!id || id === 'default' || handlers.has(id) || !handler ||
        typeof handler.activate !== 'function' || typeof handler.deactivate !== 'function') {
      throw new TypeError('Register a unique environmental view with activate/deactivate handlers.');
    }
    handlers.set(id, handler);
    return () => {
      if (activeView === id) select('default');
      handlers.delete(id);
    };
  }

  function select(id = 'default') {
    if (id !== 'default' && !handlers.has(id)) return false;
    if (activeView === id) return true;

    const previous = activeView;
    const transition = ++generation;
    if (previous !== 'default') handlers.get(previous)?.deactivate();
    activeView = id;
    if (id !== 'default') {
      handlers.get(id)?.activate({
        isCurrent: () => transition === generation && activeView === id
      });
    }
    onChange({ activeView, previous, generation });
    return true;
  }

  return Object.freeze({
    register,
    select,
    get activeView() { return activeView; },
    get generation() { return generation; }
  });
});
