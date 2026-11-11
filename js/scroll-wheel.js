(() => {
  'use strict';
  function enhance(select) {
    if (select.dataset.wheelReady || !select.options.length || select.multiple) return;
    const options = [...select.options];
    const frame = document.createElement('div');
    frame.className = 'scroll-wheel-frame';
    const wheel = document.createElement('div');
    wheel.className = 'scroll-wheel';
    wheel.tabIndex = 0;
    wheel.setAttribute('role', 'spinbutton');
    const label = document.querySelector(`label[for="${CSS.escape(select.id)}"]`);
    wheel.setAttribute('aria-label', select.getAttribute('aria-label') || label?.textContent || 'Choose an option');
    if (select.hasAttribute('aria-describedby')) wheel.setAttribute('aria-describedby', select.getAttribute('aria-describedby'));
    wheel.setAttribute('aria-valuemin', '1');
    wheel.setAttribute('aria-valuemax', String(options.length));
    let selected = -1;
    const rows = options.map((option, index) => {
      const row = document.createElement('div');
      row.className = 'scroll-wheel-option';
      row.textContent = option.textContent;
      row.setAttribute('aria-hidden', 'true');
      row.addEventListener('click', () => { wheel.focus({preventScroll:true}); choose(index, true); });
      wheel.append(row);
      return row;
    });
    function choose(index, align = false) {
      index = Math.max(0, Math.min(options.length - 1, index));
      if (selected !== index) {
        selected = index;
        wheel.setAttribute('aria-valuenow', String(index + 1));
        wheel.setAttribute('aria-valuetext', options[index].textContent);
        rows.forEach((row, n) => row.classList.toggle('is-selected', n === index));
        if (select.selectedIndex !== index) {
          select.selectedIndex = index;
          select.dispatchEvent(new Event('change', {bubbles:true}));
        }
      }
      if (align) wheel.scrollTo({top: index * rows[0].offsetHeight, behavior:'instant'});
    }
    wheel.addEventListener('scroll', () => {
      const height = rows[0].offsetHeight;
      if (height) choose(Math.round(wheel.scrollTop / height));
    }, {passive:true});
    wheel.addEventListener('keydown', event => {
      const targets = {ArrowUp:selected-1, ArrowDown:selected+1, PageUp:selected-3, PageDown:selected+3, Home:0, End:options.length-1};
      if (!(event.key in targets)) return;
      event.preventDefault();
      choose(targets[event.key], true);
    });
    select.addEventListener('change', () => {
      // A change emitted by the moving wheel must not cancel native touch inertia.
      if (selected !== select.selectedIndex) choose(select.selectedIndex, true);
    });
    select.addEventListener('diveatlas:wheel-labels-change', () => {
      rows.forEach((row, index) => { row.textContent = options[index].textContent; });
      wheel.setAttribute('aria-label', select.getAttribute('aria-label') || label?.textContent || 'Choose an option');
      wheel.setAttribute('aria-valuetext', options[selected].textContent);
    });
    frame.append(wheel);
    select.after(frame);
    select.hidden = true;
    select.dataset.wheelReady = 'true';
    choose(Math.max(0, select.selectedIndex), true);
  }
  window.DiveAtlasScrollWheel = {enhance};
  document.querySelectorAll('select[data-scroll-wheel]').forEach(enhance);
})();
