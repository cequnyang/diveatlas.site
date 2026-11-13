(() => {
  'use strict';
  const KEY = 'diveatlas-saved-trips-v1';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const validSite = site => site && typeof site.id === 'string' && site.id.length <= 150 && typeof site.name === 'string' && site.name.length <= 300 && Number.isFinite(site.lat) && Math.abs(site.lat) <= 90 && Number.isFinite(site.lng) && Math.abs(site.lng) <= 180;
  window.DiveAtlasSavedTrips = { mount(adapter) {
    if (document.getElementById('savedTripsPanel')) return;
    const locale = () => document.documentElement.lang || 'en';
    const tr = (key, values) => window.DiveAtlasTripCopy.text(locale(), key, values);
    const count = (total, short = false) => window.DiveAtlasTripCopy.count(locale(), total, short);

    let data = { version:1, active:null, trips:[] }, storageOK = true, pending = null, origin = null, timer, restoring = false, monthWheel, selectionFeedback = null, pendingContext = null, lastFeedback = null, pendingExample = null, acceptedExample = null;
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
    // Trips are stored in creation order, including records saved before this UI.
    const newestTrips = () => [...data.trips].reverse();
    let tripTrigger, tripMenuIndex = 0, tripHandleInteraction, siteListObserver;
    const tripSurface = document.createElement('div');
    tripSurface.id = 'savedTripsMenu'; tripSurface.className = 'dive-search-results saved-trips-menu';
    const tripScroll = document.createElement('div');
    tripScroll.className = 'dive-search-results-scroll'; tripScroll.setAttribute('role','listbox'); tripScroll.setAttribute('aria-label',tr('savedTrips'));
    tripSurface.append(tripScroll); document.body.append(tripSurface);
    const tripMenu = window.DiveAtlasSearchResultsMenu.create({
      surface:tripSurface, scroll:tripScroll, getInput:() => tripTrigger,
      onSelect:index => { const trip = newestTrips()[index]; if (!trip) return; remember(); data.active = trip.id; persist(); render(); tripTrigger.focus(); },
      onLoadMore:() => {}
    });
    const tripHandle = document.createElement('button');
    tripHandle.type = 'button'; tripHandle.className = 'dive-search-results-handle';
    tripHandle.setAttribute('aria-label',tr('handleUp'));
    tripHandle.title = tr('swipeUp');
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
    function positionTripMenu() {
      if (!tripSurface.classList.contains('visible') || !tripTrigger?.isConnected) return;
      const topBoundary = (document.getElementById('topMenuBar')?.getBoundingClientRect().bottom || 0) + 8;
      tripMenu.position({anchor:tripTrigger,inline:true,fitContent:true,topBoundary});
      const direction = tripSurface.dataset.placement === 'above' ? 'down' : 'up';
      tripHandle.setAttribute('aria-label', tr(direction === 'down' ? 'handleDown' : 'handleUp'));
      tripHandle.title = tr(direction === 'down' ? 'swipeDown' : 'swipeUp');
    }
    function openTripMenu() {
      monthWheel?.close(); tripSurface.classList.add('visible'); tripTrigger.setAttribute('aria-expanded','true');
      const trips = newestTrips();
      tripMenuIndex = Math.max(0,trips.findIndex(t => t.id === data.active));
      tripMenu.render({items:trips.map(t => ({name:t.name,meta:count(t.sites.length)})),total:data.trips.length,query:'',activeIndex:tripMenuIndex});
      tripScroll.querySelectorAll('.dive-search-result').forEach((item,index) => {
        const trip = trips[index];
        const row = document.createElement('div'); row.className = 'saved-trips-row';
        item.before(row); row.append(item); item.classList.add('saved-trips-site');
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'tutorial-close';
        remove.setAttribute('aria-label', tr('deleteTrip',{name:trip.name})); remove.dataset.deleteTrip = trip.id; remove.title = tr('deleteTrip',{name:trip.name});
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
      confirmation.className = 'saved-trips-delete-confirm'; confirmation.dataset.tripId = trip.id;
      confirmation.setAttribute('role','dialog');
      confirmation.setAttribute('aria-modal','false');
      confirmation.setAttribute('aria-label',tr('deleteTitle'));
      confirmation.innerHTML = `<p class="site-suggestion-copy">${escape(tr('confirmDelete',{name:trip.name,sites:count(trip.sites.length,true)}))}</p><div class="site-suggestion-actions"><button class="contact-button contact-button-secondary" type="button" data-cancel>${escape(tr('cancel'))}</button><button class="contact-button contact-button-primary" type="button" data-confirm>${escape(tr('delete'))}</button></div>`;
      row.replaceChildren(confirmation);
      const cancel = () => {
        openTripMenu();
        [...tripScroll.querySelectorAll('button[data-delete-trip]')][index]?.focus();
      };
      confirmation.querySelector('[data-cancel]').onclick = event => { event.stopPropagation(); cancel(); };
      confirmation.querySelector('[data-confirm]').onclick = event => {
        event.stopPropagation();
        remember();
        data.trips = data.trips.filter(candidate => candidate.id !== trip.id);
        if (data.active === trip.id) data.active = newestTrips()[Math.min(index,data.trips.length - 1)]?.id || null;
        persist(); render(); updateButtons();
        if (data.trips.length) { openTripMenu(); tripScroll.querySelector('button[data-delete-trip]')?.focus(); }
        else panel.querySelector(window.matchMedia('(max-width:720px)').matches ? '.diveatlas-mobile-sheet-handle' : '[data-close]').focus();
        announce({key:'deleted',values:{name:trip.name}},false);
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
    const button = document.getElementById('savedTripsButton') || document.createElement('button');
    button.id = 'savedTripsButton'; button.type = 'button'; button.className = 'top-menu-share saved-trips-trigger';
    button.setAttribute('aria-label',tr('myTrips')); button.title = tr('myTrips');
    if (!button.querySelector('svg')) button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4Z" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round"/></svg>';
    button.setAttribute('aria-controls','savedTripsPanel'); button.setAttribute('aria-expanded','false');
    if (!button.isConnected) document.querySelector('.top-menu-controls').prepend(button);
    const panel = document.createElement('aside'); panel.id = 'savedTripsPanel'; panel.className = 'saved-trips-panel tutorial-dialog'; panel.hidden = true; panel.setAttribute('aria-label',tr('savedSites'));
    const dialog = document.createElement('dialog'); dialog.className = 'saved-trips-dialog site-suggestion-dialog share-dialog'; dialog.setAttribute('aria-labelledby','savedTripsDialogTitle');
    const feedback = document.createElement('div'); feedback.className = 'saved-trips-feedback'; feedback.hidden = true;
    document.body.append(panel, dialog, feedback);
    const localCopy = () => tr(storageOK ? 'local' : 'unavailable');
    function announce(message, action) {
      lastFeedback = {message, action};
      const text = typeof message === 'string' ? message : tr(message.key, message.values) + (!storageOK ? ' ' + tr('unavailable') : '');
      clearTimeout(timer);
      // A native dialog's backdrop covers body-level toasts. Keep feedback in
      // its owning modal until dismissal, then use the ordinary map toast.
      const inlineFeedback = dialog.open && dialog.querySelector('[data-feedback]');
      if (inlineFeedback) {
        feedback.hidden = true;
        const copy = typeof message === 'object' && message.key === 'saved' ? tr('added',message.values) + (!storageOK ? ' ' + tr('unavailable') : '') : text;
        inlineFeedback.querySelector('[data-feedback-copy]').textContent = copy;
        inlineFeedback.title = copy;
        inlineFeedback.classList.add('has-feedback');
        return;
      }
      feedback.replaceChildren(); const copy = document.createElement('span'); copy.setAttribute('role','status'); copy.textContent = text; feedback.append(copy);
      if (action) { const link = document.createElement('button'); link.className = 'contact-button contact-button-secondary'; link.textContent = tr('viewSites'); link.onclick = () => { feedback.hidden = true; open(false); }; feedback.append(link); }
      feedback.hidden = false; timer = setTimeout(() => { feedback.hidden = true; }, 7000);
    }
    function remember() { if (!restoring && !panel.hidden && active()) { active().context = adapter.capture(); persist(); } }
    function close(restoreFocus = true) {
      if (panel.hidden) return;
      dismissTripMenu(); monthWheel?.close(); remember();
      const finish = () => {
        adapter.resetSheet(panel); panel.hidden = true;
        button.setAttribute('aria-expanded','false');
        if (restoreFocus) button.focus();
      };
      adapter.exitSheet(panel, finish);
    }
    function open(restore = false) {
      adapter.resetSheet(panel);
      if (restore && active()?.context) adapter.restore(active().context);
      feedback.hidden = true; adapter.prepareOverlay({tripPanel:true}); panel.hidden = false; button.setAttribute('aria-expanded','true'); render(); panel.querySelector(window.matchMedia('(max-width:720px)').matches ? '.diveatlas-mobile-sheet-handle' : '[data-close]').focus();
      adapter.enterSheet(panel);
      const openedTrip = data.active;
      void adapter.loadSites().then(() => {
        if (!panel.hidden && data.active === openedTrip && !tripSurface.classList.contains('visible') && (!monthWheel || monthWheel.panel.hidden)) render();
      }).catch(() => {});
    }
    function siteMeta(site) { return [site.location, adapter.depth(site)].filter(Boolean).join(' · '); }
    function siteCopy(site, meta = siteMeta(site)) {
      return `<span class="dive-search-result-copy"><span class="dive-search-result-name"><span class="dive-search-result-title">${escape(site.name)}</span></span>${meta ? `<span class="dive-search-result-meta">${escape(meta)}</span>` : ''}</span>`;
    }
    function render() {
      dismissTripMenu();
      monthWheel?.destroy();
      monthWheel = null;
      const trip = active();
      const content = trip ? `<label>${escape(tr('trip'))}<span class="temperature-select-hit-area"><button class="map-welcome-language saved-trips-picker" type="button" aria-label="${escape(tr('chooseTrip'))}" aria-haspopup="listbox" aria-expanded="false" aria-controls="savedTripsMenu">${escape(trip.name)}</button></span></label>
        <label hidden>${escape(tr('month'))}<span class="temperature-select-hit-area saved-trips-month-picker"><select id="savedTripMonth" aria-label="${escape(tr('month'))}"><option value="">${escape(tr('undecided'))}</option>${Array.from({length:12},(_,i) => `<option value="${i+1}"${trip.month === i+1 ? ' selected' : ''}>${new Intl.DateTimeFormat(locale(),{month:'long'}).format(new Date(2020,i,1))}</option>`).join('')}</select></span></label>
        <div class="map-welcome-navigation" hidden><button class="tutorial-button primary tutorial-cta saved-trips-resume" data-resume type="button">${escape(tr('resume'))}</button></div><h3>${escape(count(trip.sites.length))}</h3>
        ${trip.sites.length ? `<div class="saved-trips-site-list" role="region" aria-label="${escape(tr('savedSites'))}" tabindex="0">${trip.sites.map((site,index) => `<div class="dive-search-result saved-trips-row"><button type="button" class="saved-trips-site" data-site="${index}" title="${escape(tr('showMap'))}">${siteCopy(site)}</button><button class="tutorial-close" type="button" data-remove="${index}" aria-label="${escape(tr('remove',{name:site.name}))}" title="${escape(tr('remove',{name:site.name}))}"></button></div>`).join('')}</div>` : `<p class="saved-trips-empty">${escape(tr('noSites'))}</p>`}` :
        `<div class="saved-trips-empty saved-trips-first"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg><h3>${escape(tr('noTrips'))}</h3><p>${escape(tr('startTrip'))}</p><div class="map-welcome-navigation"><button class="tutorial-button primary tutorial-cta" type="button" data-explore>${escape(tr('explore'))}</button></div></div>`;
      panel.innerHTML = `<button class="diveatlas-mobile-sheet-handle" type="button" aria-label="${escape(tr('hideSheet'))}" title="${escape(tr('swipeDown'))}"></button><div class="saved-trips-heading"><h2 class="tutorial-title">${escape(tr('myTrips'))}</h2><button class="tutorial-close" type="button" data-close aria-label="${escape(tr('closeSites'))}" title="${escape(tr('closeSites'))}"></button></div>${content}<p class="saved-trips-local">${escape(localCopy())}</p>`;
      siteListObserver?.disconnect();
      const siteList = panel.querySelector('.saved-trips-site-list');
      if (siteList) {
        // Measure actual shared row geometry so font/unit changes preserve the
        // five-item limit without introducing a second row-size definition.
        const rows = [...siteList.children].slice(0, 5);
        const limitHeight = () => { siteList.style.maxHeight = `${rows.reduce((height,row) => height + row.getBoundingClientRect().height, 0)}px`; };
        siteListObserver = new ResizeObserver(limitHeight);
        rows.forEach(row => siteListObserver.observe(row));
        limitHeight();
      }
      panel.querySelector('[data-close]').onclick = () => close();
      adapter.bindSheetDrag(panel.querySelector('.diveatlas-mobile-sheet-handle'), panel, close);
      if (!trip) { panel.querySelector('[data-explore]').onclick = () => close(); return; }
      tripTrigger = panel.querySelector('.saved-trips-picker');
      tripTrigger.value = '';
      tripTrigger.onclick = () => tripSurface.classList.contains('visible') ? dismissTripMenu() : openTripMenu();
      tripTrigger.onkeydown = event => {
        if (event.key === 'Escape' && tripSurface.classList.contains('visible')) { event.preventDefault(); event.stopPropagation(); dismissTripMenu(); return; }
        if (!tripSurface.classList.contains('visible') && ['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault(); openTripMenu(); return; }
        if (tripSurface.classList.contains('visible')) tripMenu.keydown(event,{activeIndex:tripMenuIndex,visibleCount:data.trips.length,total:data.trips.length,setActive:index => { tripMenuIndex=tripMenu.setActive(index); },open:() => {},dismiss:dismissTripMenu});
      };
      panel.querySelector('#savedTripMonth').onchange = event => { trip.month = Number(event.target.value) || null; persist(); };
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
        const label = saved ? tr('chooseTrip') : tr('saveTitle');
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
      if (!exists) trip.context = pendingContext || adapter.capture(pending.id);
      persist(); updateButtons(); if (!panel.hidden) render();
      if (keepOpen) {
        dialog.querySelectorAll('[data-trip]').forEach(node => {
          const item = data.trips.find(t => t.id === node.dataset.trip);
          const selected = item.sites.some(site => site.id === pending.id);
          node.setAttribute('aria-pressed', String(selected));
          node.querySelector('.dive-search-result-meta').textContent = count(item.sites.length,true);
          node.querySelector('.saved-trips-choice-status')?.remove();
          if (selected) node.insertAdjacentHTML('beforeend','<span class="saved-trips-choice-status" aria-hidden="true">✓</span>');
        });
      } else { selectionFeedback = null; dialog.close(); }
      const message = {key:exists && keepOpen ? 'removed' : 'saved', values:{name:trip.name}};
      if (keepOpen) selectionFeedback = message;
      announce(message,!keepOpen);
    }
    function choose(site, retainOrigin = false) {
      if (!validSite(site)) return;
      pending = site;
      if (!retainOrigin) {
        origin = document.activeElement; acceptedExample = null;
        // Keep the source site context while its sheet remains beneath this modal.
        pendingContext = adapter.capture(site.id);
        if (!panel.hidden) close(false);
        feedback.hidden = true;
        adapter.prepareOverlay({preserveSite:true});
      }
      const example = adapter.tripExample(site); pendingExample = example;
      const details = adapter.details(site) || siteMeta(site);
      const form = `<form id="savedTripsCreateForm" class="saved-trips-create"><label class="site-suggestion-field"><span>${escape(tr('tripName'))}</span><input class="site-suggestion-input" name="name" aria-describedby="savedTripNameError" required maxlength="70" placeholder="${escape(tr('example',{name:example.name}))}" autocomplete="off"></label><p id="savedTripNameError" class="site-suggestion-status is-error" role="alert" hidden></p><p class="site-suggestion-copy">${localCopy()}</p></form>`;
      dialog.innerHTML = `<div class="site-suggestion-header"><h2 class="site-suggestion-title" id="savedTripsDialogTitle">${escape(tr('saveTitle'))}</h2><button class="contact-dialog-close" id="savedTripsCloseButton" type="button" data-cancel aria-label="${escape(tr('closeSave'))}" title="${escape(tr('closeSave'))}">${document.getElementById('shareCloseButton').innerHTML}</button><div class="saved-trips-source-site"><div class="saved-trips-row"><div class="saved-trips-site">${siteCopy(site, details)}</div></div></div></div><div class="site-suggestion-form">${data.trips.length ? `<div class="saved-trips-choices"><p>${escape(tr('chooseTrip'))}</p><div class="saved-trips-choice-list" role="region" aria-label="${escape(tr('savedTrips'))}" tabindex="0">${newestTrips().map(t => `<button type="button" class="dive-search-result saved-trips-choice" data-trip="${escape(t.id)}" aria-pressed="${t.sites.some(s => s.id === site.id)}"><span class="dive-search-result-copy"><span class="dive-search-result-name"><span class="dive-search-result-title">${escape(t.name)}</span></span><span class="dive-search-result-meta">${escape(count(t.sites.length,true))}</span></span>${t.sites.some(s => s.id === site.id) ? '<span class="saved-trips-choice-status" aria-hidden="true">✓</span>' : ''}</button>`).join('')}</div></div><details><summary>${escape(tr('createTrip'))}</summary>${form}</details>` : form}<div class="site-suggestion-actions saved-trips-footer"><p class="site-suggestion-status saved-trips-inline-feedback" role="status" aria-live="polite" data-feedback><span data-feedback-copy></span></p><button class="contact-button contact-button-primary" type="button" form="savedTripsCreateForm" data-save>${escape(tr('save'))}</button></div></div>`;
      dialog.querySelectorAll('[data-cancel]').forEach(node => { node.onclick = () => dialog.close(); });
      const saveButton = dialog.querySelector('[data-save]');
      const createDetails = dialog.querySelector('details');
      const creating = () => !createDetails || createDetails.open;
      // One footer action owns both paths; native form submission keeps Enter
      // and required-field validation consistent with the visible action.
      const syncAction = () => {
        saveButton.textContent = tr(creating() ? 'createSave' : 'save');
        saveButton.type = creating() ? 'submit' : 'button';
      };
      createDetails?.addEventListener('toggle', syncAction);
      syncAction();
      saveButton.onclick = () => { if (!creating()) { persist(); dialog.close(); } };
      dialog.querySelectorAll('[data-trip]').forEach(node => { node.onclick = () => save(node.dataset.trip, true); });
      const nameInput = dialog.querySelector('input[name="name"]');
      const nameError = dialog.querySelector('#savedTripNameError');
      const showNameError = key => {
        nameError.dataset.errorKey = key;
        nameError.textContent = tr(key); nameError.hidden = false;
        nameInput.setAttribute('aria-invalid','true'); nameInput.focus();
      };
      nameInput.addEventListener('invalid',event => { event.preventDefault(); showNameError('requiredName'); });
      nameInput.addEventListener('input', () => { nameError.hidden = true; nameInput.removeAttribute('aria-invalid'); });
      nameInput.addEventListener('keydown', event => {
        // Tab accepts the visible example once; later Tab/Shift+Tab retain
        // normal focus traversal and never overwrite a name the user entered.
        if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || nameInput.value.trim()) return;
        event.preventDefault();
        acceptedExample = example;
        nameInput.value = example.name;
        nameInput.dispatchEvent(new Event('input', { bubbles:true }));
        nameInput.setSelectionRange(nameInput.value.length, nameInput.value.length);
      });
      dialog.querySelector('form').onsubmit = event => {
        event.preventDefault(); const input = dialog.querySelector('input'); const name = input.value.trim(); if (!name) { input.focus(); return; }
        if (data.trips.some(trip => nameKey(trip.name) === nameKey(name))) {
          showNameError('duplicate');
          return;
        }
        const id = crypto.randomUUID(); data.trips.push({id, name, month:name === example.name ? example.month : name === acceptedExample?.name ? acceptedExample.month : null, sites:[], context:null}); save(id);
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
      if (origin?.isConnected) origin.focus({preventScroll:true});
    });
    button.onclick = () => (panel.hidden || panel.classList.contains('mobile-sheet-exiting')) ? open(false) : close();
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('.saved-trips-dialog[open]') && !panel.hidden) { event.stopPropagation(); close(); } });
    document.addEventListener('click', event => { const target = event.target.closest('[data-save-trip-site]'); if (!target) return; event.preventDefault(); event.stopPropagation(); choose(adapter.describe(target.dataset.saveTripSite)); }, true);
    adapter.onOverlayOpen(event => {
      // Native modal input cannot select the map behind it. Late map data must
      // not reopen its source sheet or interrupt typing in the chooser.
      if (dialog.open && event.detail.owner === 'map-detail') { event.preventDefault(); return; }
      // A new task must receive focus; closing trips here must not steal it back.
      if (!panel.hidden || dialog.open) feedback.hidden = true;
      if (!panel.hidden) close(false);
      if (dialog.open) { origin = null; selectionFeedback = null; dialog.close(); }
    });
    let previousLocale = locale();
    new MutationObserver(() => {
      if (locale() === previousLocale) return;
      previousLocale = locale();
      button.setAttribute('aria-label',tr('myTrips')); button.title = tr('myTrips');
      panel.setAttribute('aria-label',tr('savedSites'));
      tripScroll.setAttribute('aria-label',tr('savedTrips'));
      const menuOpen = tripSurface.classList.contains('visible');
      const deleting = tripScroll.querySelector('[data-trip-id]')?.dataset.tripId;
      if (!panel.hidden) {
        render();
        if (menuOpen) {
          openTripMenu();
          const trips = newestTrips();
          const index = trips.findIndex(item => item.id === deleting);
          if (index >= 0) confirmDeleteTrip(trips[index],index);
        }
      }
      if (dialog.open && pending) {
        const input = dialog.querySelector('input[name="name"]');
        if (input.value === pendingExample?.name) acceptedExample = pendingExample;
        const draft = {value:input.value, open:dialog.querySelector('details')?.open,
          error:input.hasAttribute('aria-invalid') ? dialog.querySelector('#savedTripNameError').dataset.errorKey : null, focused:document.activeElement === input,
          start:input.selectionStart, end:input.selectionEnd};
        choose(pending,true);
        const replacement = dialog.querySelector('input[name="name"]');
        replacement.value = draft.value;
        const details = dialog.querySelector('details');
        if (details) { details.open = draft.open; details.dispatchEvent(new Event('toggle')); }
        if (draft.error) {
          replacement.setAttribute('aria-invalid','true');
          const error = dialog.querySelector('#savedTripNameError');
          error.dataset.errorKey = draft.error; error.textContent = tr(draft.error); error.hidden = false;
        }
        if (draft.focused) { replacement.focus({preventScroll:true}); replacement.setSelectionRange(draft.start,draft.end); }
        if (selectionFeedback) announce(selectionFeedback,false);
      } else if (!feedback.hidden && lastFeedback) announce(lastFeedback.message,lastFeedback.action);
      updateButtons();
    }).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
    adapter.onContextChange(remember);
    // Popup content is rebuilt by localization, viewport changes and marker refreshes.
    new MutationObserver(updateButtons).observe(document.body,{childList:true,subtree:true});
    updateButtons();
  } };
})();
