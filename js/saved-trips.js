(() => {
  'use strict';
  const KEY = 'diveatlas-saved-trips-v1';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const validSite = site => site && typeof site.id === 'string' && site.id.length <= 150 && typeof site.name === 'string' && site.name.length <= 300 && Number.isFinite(site.lat) && Math.abs(site.lat) <= 90 && Number.isFinite(site.lng) && Math.abs(site.lng) <= 180;
  window.DiveAtlasSavedTrips = { mount(adapter) {
    if (document.getElementById('savedTripsButton')) return;
    let data = { version:1, active:null, trips:[] }, storageOK = true, pending = null, origin = null, timer, restoring = false, monthWheel, selectionFeedback = null;
    try {
      const stored = localStorage.getItem(KEY);
      let raw;
      try { raw = JSON.parse(stored); } catch (_) { /* Ignore damaged data without treating writable storage as unavailable. */ }
      if (raw?.version === 1 && Array.isArray(raw.trips)) {
        data.trips = raw.trips.filter(t => typeof t.id === 'string' && typeof t.name === 'string' && t.name.length <= 70 && Array.isArray(t.sites))
          .map(t => ({ id:t.id, name:t.name, month:Number.isInteger(t.month) && t.month >= 1 && t.month <= 12 ? t.month : null, sites:t.sites.filter(validSite), context:typeof t.context === 'string' && t.context.length <= 6000 ? t.context : null }));
        data.active = data.trips.some(t => t.id === raw.active) ? raw.active : data.trips[0]?.id || null;
      }
    } catch (_) { storageOK = false; }
    let tripTrigger, tripMenuIndex = 0, tripHandleInteraction;
    const tripSurface = document.createElement('div');
    tripSurface.id = 'savedTripsMenu'; tripSurface.className = 'dive-search-results saved-trips-menu';
    const tripScroll = document.createElement('div');
    tripScroll.className = 'dive-search-results-scroll'; tripScroll.setAttribute('role','listbox'); tripScroll.setAttribute('aria-label','Saved trips');
    tripSurface.append(tripScroll); document.body.append(tripSurface);
    const tripMenu = window.DiveAtlasSearchResultsMenu.create({
      surface:tripSurface, scroll:tripScroll, getInput:() => tripTrigger,
      onSelect:index => { if (!data.trips[index]) return; remember(); data.active = data.trips[index].id; persist(); render(); tripTrigger.focus(); },
      onLoadMore:() => {}
    });
    const tripHandle = document.createElement('button');
    tripHandle.type = 'button'; tripHandle.className = 'dive-search-results-handle';
    tripHandle.setAttribute('aria-label','Close trip selector; swipe up');
    tripHandle.title = 'Swipe up to close';
    tripSurface.append(tripHandle);
    tripHandleInteraction = tripMenu.bindMobileHandle({
      resultsHandle:tripHandle,
      onDismiss:() => { dismissTripMenu(); tripTrigger?.focus({preventScroll:true}); }
    });
    tripSurface.querySelector('.dive-search-modes').hidden = true;
    tripSurface.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismissTripMenu(); tripTrigger?.focus(); }
    });
    function dismissTripMenu() { tripHandleInteraction?.cancel(); tripSurface.classList.remove('visible'); tripTrigger?.setAttribute('aria-expanded','false'); }
    function positionTripMenu() { if (tripSurface.classList.contains('visible') && tripTrigger?.isConnected) tripMenu.position({anchor:tripTrigger,inline:true}); }
    function openTripMenu() {
      monthWheel?.close(); tripSurface.classList.add('visible'); tripTrigger.setAttribute('aria-expanded','true');
      tripMenuIndex = Math.max(0,data.trips.findIndex(t => t.id === data.active));
      tripMenu.render({items:data.trips.map(t => ({name:t.name,meta:`${t.sites.length} saved ${t.sites.length === 1 ? 'dive site' : 'dive sites'}`})),total:data.trips.length,query:'',activeIndex:tripMenuIndex});
      tripScroll.querySelectorAll('.dive-search-result').forEach((item,index) => {
        const trip = data.trips[index];
        const row = document.createElement('div'); row.className = 'saved-trips-row';
        item.before(row); row.append(item); item.classList.add('saved-trips-site');
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'tutorial-close';
        remove.setAttribute('aria-label', `Delete trip ${trip.name}`);
        remove.onclick = event => {
          event.preventDefault(); event.stopPropagation();
          confirmDeleteTrip(trip, index);
        };
        row.append(remove);
      });
      positionTripMenu();
    }
    function confirmDeleteTrip(trip, index) {
      // Keep confirmation in the same menu row as the delete target, without
      // moving the user's pointer/focus to a separate page-centered modal.
      if (tripScroll.querySelector('.saved-trips-delete-confirm')) openTripMenu();
      const row = tripScroll.querySelectorAll('.saved-trips-row')[index];
      if (!row) return;
      const confirmation = document.createElement('div');
      confirmation.className = 'saved-trips-delete-confirm';
      confirmation.setAttribute('role','dialog');
      confirmation.setAttribute('aria-modal','false');
      confirmation.setAttribute('aria-label','Delete trip?');
      confirmation.innerHTML = `<p class="site-suggestion-copy">Delete “${escape(trip.name)}” and its ${trip.sites.length} saved ${trip.sites.length === 1 ? 'site' : 'sites'} from this browser?</p><div class="site-suggestion-actions"><button class="contact-button contact-button-secondary" type="button" data-cancel>Cancel</button><button class="contact-button contact-button-primary" type="button" data-confirm>Delete</button></div>`;
      row.replaceChildren(confirmation);
      const cancel = () => {
        openTripMenu();
        [...tripScroll.querySelectorAll('button[aria-label^="Delete trip"]')][index]?.focus();
      };
      confirmation.querySelector('[data-cancel]').onclick = event => { event.stopPropagation(); cancel(); };
      confirmation.querySelector('[data-confirm]').onclick = event => {
        event.stopPropagation();
        remember();
        data.trips = data.trips.filter(candidate => candidate.id !== trip.id);
        if (data.active === trip.id) data.active = data.trips[Math.min(index,data.trips.length - 1)]?.id || null;
        persist(); render(); updateButtons();
        if (data.trips.length) { openTripMenu(); tripScroll.querySelector('button[aria-label^="Delete trip"]')?.focus(); }
        else panel.querySelector(window.matchMedia('(max-width:720px)').matches ? '.diveatlas-mobile-sheet-handle' : '[data-close]').focus();
        announce(`Deleted trip ${trip.name}.`,false);
      };
      confirmation.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
      });
      positionTripMenu();
      confirmation.scrollIntoView({block:'nearest'});
      confirmation.querySelector('[data-cancel]').focus({preventScroll:true});
    }
    document.addEventListener('pointerdown',event => { if (!tripSurface.contains(event.target) && !tripTrigger?.contains(event.target)) dismissTripMenu(); });
    window.addEventListener('resize',positionTripMenu);
    document.addEventListener('scroll',positionTripMenu,true);
    const nameKey = name => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
    const active = () => data.trips.find(t => t.id === data.active);
    const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); storageOK = true; } catch (_) { storageOK = false; } };
    const button = document.createElement('button');
    button.id = 'savedTripsButton'; button.type = 'button'; button.className = 'top-menu-share saved-trips-trigger';
    button.setAttribute('aria-label','My trips'); button.title = 'My trips';
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4Z" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round"/></svg>';
    button.setAttribute('aria-controls','savedTripsPanel'); button.setAttribute('aria-expanded','false');
    document.querySelector('.top-menu-controls').prepend(button);
    const panel = document.createElement('aside'); panel.id = 'savedTripsPanel'; panel.className = 'saved-trips-panel tutorial-dialog'; panel.hidden = true; panel.setAttribute('aria-label','Saved dive sites');
    const dialog = document.createElement('dialog'); dialog.className = 'saved-trips-dialog site-suggestion-dialog'; dialog.setAttribute('aria-labelledby','savedTripsDialogTitle');
    const feedback = document.createElement('div'); feedback.className = 'saved-trips-feedback'; feedback.hidden = true;
    document.body.append(panel, dialog, feedback);
    const localCopy = () => storageOK ? 'Saved in this browser on this device only. Clearing browser data may remove your trips. No account needed.' : 'Browser storage is unavailable. Changes last only for this open page.';
    function announce(text, action) {
      clearTimeout(timer); feedback.replaceChildren(); const copy = document.createElement('span'); copy.setAttribute('role','status'); copy.textContent = text; feedback.append(copy);
      if (action) { const link = document.createElement('button'); link.className = 'contact-button contact-button-secondary'; link.textContent = 'View saved sites'; link.onclick = () => { feedback.hidden = true; open(false); }; feedback.append(link); }
      feedback.hidden = false; timer = setTimeout(() => { feedback.hidden = true; }, 7000);
    }
    function remember() { if (!restoring && !panel.hidden && active()) { active().context = adapter.capture(); persist(); } }
    function close() { adapter.resetSheet(panel); dismissTripMenu(); monthWheel?.close(); remember(); panel.hidden = true; button.setAttribute('aria-expanded','false'); button.focus(); }
    function open(restore = false) {
      adapter.resetSheet(panel);
      if (restore && active()?.context) adapter.restore(active().context);
      adapter.closePopup(); panel.hidden = false; button.setAttribute('aria-expanded','true'); render(); panel.querySelector(window.matchMedia('(max-width:720px)').matches ? '.diveatlas-mobile-sheet-handle' : '[data-close]').focus();
      const openedTrip = data.active;
      void adapter.loadSites().then(() => {
        if (!panel.hidden && data.active === openedTrip && !tripSurface.classList.contains('visible') && (!monthWheel || monthWheel.panel.hidden)) render();
      }).catch(() => {});
    }
    function siteMeta(site) { return [site.location, adapter.depth(site)].filter(Boolean).join(' · '); }
    function render() {
      dismissTripMenu();
      monthWheel?.destroy();
      monthWheel = null;
      const trip = active();
      panel.innerHTML = `<button class="diveatlas-mobile-sheet-handle" type="button" aria-label="Hide trips sheet; swipe down" title="Swipe down to hide"></button><div class="saved-trips-heading"><h2 class="tutorial-title">My trips</h2><button class="tutorial-close" type="button" data-close aria-label="Close saved sites"></button></div>` +
        (trip ? `<label>Trip<span class="temperature-select-hit-area"><button class="map-welcome-language saved-trips-picker" type="button" aria-label="Choose trip" aria-haspopup="listbox" aria-expanded="false" aria-controls="savedTripsMenu">${escape(trip.name)}</button></span></label><label hidden>Travel month<span class="temperature-select-hit-area saved-trips-month-picker"><select id="savedTripMonth" aria-label="Travel month"><option value="">Not decided</option>${Array.from({length:12},(_,i) => `<option value="${i+1}"${trip.month === i+1 ? ' selected' : ''}>${new Intl.DateTimeFormat(document.documentElement.lang || 'en',{month:'long'}).format(new Date(2020,i,1))}</option>`).join('')}</select></span></label><div class="map-welcome-navigation" hidden><button class="tutorial-button primary tutorial-cta saved-trips-resume" data-resume type="button">Continue planning</button></div><h3>${trip.sites.length} saved ${trip.sites.length === 1 ? 'dive site' : 'dive sites'}</h3>${trip.sites.length ? trip.sites.map((site,index) => `<div class="dive-search-result saved-trips-row"><button type="button" class="saved-trips-site" data-site="${index}" title="Show on map"><span class="dive-search-result-copy"><span class="dive-search-result-name"><span class="dive-search-result-title">${escape(site.name)}</span></span>${siteMeta(site) ? `<span class="dive-search-result-meta">${escape(siteMeta(site))}</span>` : ''}</span></button><button class="tutorial-close" type="button" data-remove="${index}" aria-label="Remove ${escape(site.name)}"></button></div>`).join('') : '<p class="saved-trips-empty">No saved sites yet. Close this list and save a dive site from its map card.</p>'}` : '<div class="saved-trips-empty saved-trips-first"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg><h3>No saved trips yet</h3><p>Save a dive site from its map card to start your first trip.</p><div class="map-welcome-navigation"><button class="tutorial-button primary tutorial-cta" type="button" data-explore>Explore the map</button></div></div>') + `<p class="saved-trips-local">${localCopy()}</p>`;
      panel.querySelector('[data-close]').onclick = close;
      adapter.bindSheetDrag(panel.querySelector('.diveatlas-mobile-sheet-handle'), panel, close);
      if (!trip) { panel.querySelector('[data-explore]').onclick = close; return; }
      tripTrigger = panel.querySelector('[aria-label="Choose trip"]');
      tripTrigger.value = '';
      tripTrigger.onclick = () => tripSurface.classList.contains('visible') ? dismissTripMenu() : openTripMenu();
      tripTrigger.onkeydown = event => {
        if (event.key === 'Escape' && tripSurface.classList.contains('visible')) { event.preventDefault(); event.stopPropagation(); dismissTripMenu(); return; }
        if (!tripSurface.classList.contains('visible') && ['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault(); openTripMenu(); return; }
        if (tripSurface.classList.contains('visible')) tripMenu.keydown(event,{activeIndex:tripMenuIndex,visibleCount:data.trips.length,total:data.trips.length,setActive:index => { tripMenuIndex=tripMenu.setActive(index); },open:() => {},dismiss:dismissTripMenu});
      };
      panel.querySelector('[aria-label="Travel month"]').onchange = event => { trip.month = Number(event.target.value) || null; persist(); };
      monthWheel = adapter.monthWheel(panel.querySelector('#savedTripMonth'));
      panel.querySelector('[data-resume]').onclick = () => {
        const context = trip.context;
        // Restore emits ordinary map events. Do not let a partially applied
        // state overwrite the saved resume point while those events fire.
        restoring = true;
        try { if (context) adapter.restore(context); close(); } finally { restoring = false; }
      };
      panel.querySelectorAll('[data-site]').forEach(node => { node.onclick = async () => { const site = trip.sites[Number(node.dataset.site)]; close(); await adapter.focus(site); trip.context = adapter.capture(site.id); persist(); }; });
      panel.querySelectorAll('[data-remove]').forEach(node => { node.onclick = () => { trip.sites.splice(Number(node.dataset.remove),1); persist(); render(); panel.querySelector(window.matchMedia('(max-width:720px)').matches ? '.diveatlas-mobile-sheet-handle' : '[data-close]').focus(); updateButtons(); }; });
    }
    function updateButtons() {
      document.querySelectorAll('[data-save-trip-site]').forEach(node => {
        const saved = data.trips.some(t => t.sites.some(s => s.id === node.dataset.saveTripSite));
        const label = saved ? 'Saved · choose trip' : 'Save to trip';
        node.setAttribute('aria-label', label);
        node.title = label;
        node.classList.toggle('is-saved', saved);
      });
    }
    function save(id, keepOpen = false) {
      const trip = data.trips.find(t => t.id === id); if (!trip || !pending) return;
      const exists = trip.sites.some(s => s.id === pending.id);
      if (exists && keepOpen) trip.sites = trip.sites.filter(site => site.id !== pending.id);
      else if (!exists) trip.sites.push(pending);
      data.active = id;
      if (!exists) trip.context = adapter.capture(pending.id);
      persist(); updateButtons(); if (!panel.hidden) render();
      if (keepOpen) {
        dialog.querySelectorAll('[data-trip]').forEach(node => {
          const item = data.trips.find(t => t.id === node.dataset.trip);
          const selected = item.sites.some(site => site.id === pending.id);
          node.setAttribute('aria-pressed', String(selected));
          node.querySelector('.dive-search-result-meta').textContent = `${item.sites.length} saved ${item.sites.length === 1 ? 'site' : 'sites'}`;
          node.querySelector('.saved-trips-choice-status')?.remove();
          if (selected) node.insertAdjacentHTML('beforeend','<span class="saved-trips-choice-status" aria-hidden="true">✓</span>');
        });
      } else dialog.close();
      const message = `${exists && keepOpen ? 'Removed from' : 'Saved to'} ${trip.name}.${storageOK ? '' : ' Browser storage unavailable; this change lasts only for this open page.'}`;
      if (keepOpen) selectionFeedback = message;
      announce(message,!keepOpen);
    }
    function choose(site, retainOrigin = false) {
      if (!validSite(site)) return;
      pending = site; if (!retainOrigin) origin = document.activeElement;
      const example = adapter.tripExample(site);
      const form = `<form class="saved-trips-create"><label class="site-suggestion-field"><span>Trip name</span><input class="site-suggestion-input" name="name" aria-describedby="savedTripNameError" required maxlength="70" placeholder="${escape('e.g. ' + example.name)}" autocomplete="off"></label><p id="savedTripNameError" class="site-suggestion-status is-error" role="alert" hidden></p><p class="site-suggestion-copy">${localCopy()}</p><div class="site-suggestion-actions"><button class="contact-button contact-button-primary" type="submit">Create</button></div></form>`;
      dialog.innerHTML = `<div class="site-suggestion-header"><div><h2 class="site-suggestion-title" id="savedTripsDialogTitle">Save to a trip</h2><p class="site-suggestion-copy">${escape(site.name)}</p></div><button class="tutorial-close" type="button" data-cancel aria-label="Close save dialog"></button></div><div class="site-suggestion-form">${data.trips.length ? `<div class="saved-trips-choices"><p>Choose a trip</p>${data.trips.map(t => `<button type="button" class="dive-search-result saved-trips-choice" data-trip="${escape(t.id)}" aria-pressed="${t.sites.some(s => s.id === site.id)}"><span class="dive-search-result-copy"><span class="dive-search-result-name"><span class="dive-search-result-title">${escape(t.name)}</span></span><span class="dive-search-result-meta">${t.sites.length} saved ${t.sites.length === 1 ? 'site' : 'sites'}</span></span>${t.sites.some(s => s.id === site.id) ? '<span class="saved-trips-choice-status" aria-hidden="true">✓</span>' : ''}</button>`).join('')}</div><details><summary>Create a new trip</summary>${form}</details>` : form}</div>`;
      dialog.querySelectorAll('[data-cancel]').forEach(node => { node.onclick = () => dialog.close(); });
      dialog.querySelectorAll('[data-trip]').forEach(node => { node.onclick = () => save(node.dataset.trip, true); });
      const nameInput = dialog.querySelector('input[name="name"]');
      const nameError = dialog.querySelector('#savedTripNameError');
      nameInput.addEventListener('input', () => { nameError.hidden = true; nameInput.removeAttribute('aria-invalid'); });
      nameInput.addEventListener('keydown', event => {
        // Tab accepts the visible example once; later Tab/Shift+Tab retain
        // normal focus traversal and never overwrite a name the user entered.
        if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || nameInput.value.trim()) return;
        event.preventDefault();
        nameInput.value = nameInput.placeholder.replace(/^e\.g\.\s*/i, '');
        nameInput.dispatchEvent(new Event('input', { bubbles:true }));
        nameInput.setSelectionRange(nameInput.value.length, nameInput.value.length);
      });
      dialog.querySelector('form').onsubmit = event => {
        event.preventDefault(); const input = dialog.querySelector('input'); const name = input.value.trim(); if (!name) { input.focus(); return; }
        if (data.trips.some(trip => nameKey(trip.name) === nameKey(name))) {
          nameError.textContent = 'A trip with this name already exists. Choose it above or use a different name.';
          nameError.hidden = false;
          input.setAttribute('aria-invalid', 'true');
          input.focus();
          return;
        }
        const id = crypto.randomUUID(); data.trips.push({id, name, month:name === example.name ? example.month : null, sites:[], context:null}); save(id, true); choose(site, true);
        dialog.querySelector(`[data-trip="${id}"]`)?.focus();
      };
      if (!dialog.open) dialog.showModal();
    }
    const outsideDialog = event => {
      const rect = dialog.getBoundingClientRect();
      return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
    };
    let backdropPress = false;
    dialog.addEventListener('pointerdown', event => { backdropPress = outsideDialog(event); });
    dialog.addEventListener('click', event => {
      // A drag starting in the form must not become an accidental dismissal.
      if (backdropPress && outsideDialog(event)) dialog.close();
      backdropPress = false;
    });
    dialog.addEventListener('close', () => {
      if (selectionFeedback) { announce(selectionFeedback,true); selectionFeedback = null; }
      if (origin?.isConnected) origin.focus();
    });
    button.onclick = () => panel.hidden ? open(false) : close();
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('.saved-trips-dialog[open]') && !panel.hidden) { event.stopPropagation(); close(); } });
    document.addEventListener('click', event => { const target = event.target.closest('[data-save-trip-site]'); if (!target) return; event.preventDefault(); event.stopPropagation(); choose(adapter.describe(target.dataset.saveTripSite)); }, true);
    adapter.onContextChange(remember);
    // Popup content is rebuilt by localization, viewport changes and marker refreshes.
    new MutationObserver(updateButtons).observe(document.body,{childList:true,subtree:true});
    updateButtons();
  } };
})();
