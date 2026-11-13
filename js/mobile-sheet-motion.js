(function (root) {
  "use strict";
  // One cancellable lifecycle for map, saved trips and search sheets. Gesture
  // controllers retain ownership of their thresholds and intermediate positions.
  const sheetMotionStates = new WeakMap();
  const sheetMotion = {
    cancel(surface, { keepExit = false } = {}) {
      const state = surface && sheetMotionStates.get(surface);
      if (state) {
        if (state.frame) cancelAnimationFrame(state.frame);
        if (state.timer) clearTimeout(state.timer);
        if (state.listener) surface.removeEventListener('transitionend', state.listener);
        sheetMotionStates.delete(surface);
      }
      surface?.classList.remove('mobile-sheet-entering', 'mobile-sheet-returning-from-detail');
      if (!keepExit) surface?.classList.remove('mobile-sheet-exiting');
    },
    cancelExit(surface) {
      if (sheetMotionStates.get(surface)?.phase === 'exit') this.cancel(surface);
    },
    enter(surface, isOpen) {
      this.cancel(surface);
      if (!matchMedia('(max-width:720px)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const state = { phase:'enter' };
      sheetMotionStates.set(surface, state);
      surface.classList.add('mobile-sheet-entering');
      void surface.offsetHeight;
      state.frame = requestAnimationFrame(() => {
        if (sheetMotionStates.get(surface) !== state) return;
        sheetMotionStates.delete(surface);
        if (isOpen()) surface.classList.remove('mobile-sheet-entering', 'mobile-sheet-returning-from-detail');
      });
    },
    exit(surface, finish) {
      const pending = sheetMotionStates.get(surface);
      if (pending?.phase === 'exit') {
        // Keep the current motion continuous while replacing its destination.
        pending.finish = finish;
        return;
      }
      this.cancel(surface);
      if (!matchMedia('(max-width:720px)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        finish(); return;
      }
      surface.classList.remove('mobile-vertical-dragging');
      void surface.offsetHeight;
      const state = { phase:'exit', finish };
      const complete = () => {
        if (sheetMotionStates.get(surface) !== state) return;
        clearTimeout(state.timer);
        surface.removeEventListener('transitionend', state.listener);
        sheetMotionStates.delete(surface);
        state.finish();
      };
      state.listener = event => { if (event.target === surface && event.propertyName === 'translate') complete(); };
      sheetMotionStates.set(surface, state);
      surface.addEventListener('transitionend', state.listener);
      state.timer = setTimeout(complete, 320);
      surface.classList.add('mobile-sheet-exiting');
    }
  };
  root.DiveAtlasSheetMotion = sheetMotion;
})(window);
