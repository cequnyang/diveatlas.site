(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  if (!byId('siteSuggestionModal')) return;
  const els = Object.fromEntries(Array.from(document.querySelectorAll('[id^="sitePhotoUpload"]'), node => [node.id, node]));
  let language = 'en';
  try { language = localStorage.getItem('global-coral-map-lang') || 'en'; } catch (_) {}
  const t = key => {
    const texts = window.DiveAtlasContributionTexts;
    return texts.photo[language]?.[key] || texts.suggestion[language]?.[key]
      || texts.photo.en[key] || texts.suggestion.en[key] || (key === 'contactClose' ? 'Close' : key);
  };
  const tf = (key, values) => t(key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
  const photo = window.DiveAtlasPhotoSubmission.create({ els, t, tf });
  const modal = byId('siteSuggestionModal');
  const form = byId('siteSuggestionForm');
  const status = byId('siteSuggestionStatus');
  let previousFocus, busy = false, sent = false, widget = null, token = '', loader, statusKey = '';
  const message = key => { statusKey = key; status.textContent = key ? t(key) : ''; };
  function renderTexts() {
    photo.renderSitePhotoUploadTexts();
    for (const [id, key] of Object.entries({ siteSuggestionTitle:'siteSuggestionTitle', siteSuggestionCopy:'siteSuggestionCopy',
      siteSuggestionNameLabel:'siteSuggestionName', siteSuggestionCancelButton:'siteSuggestionCancel' })) {
      if (byId(id)) byId(id).textContent = t(key);
    }
    byId('siteSuggestionSubmitButton').textContent = t(busy ? 'siteSuggestionSending' : 'siteSuggestionSend');
    byId('siteSuggestionSubmitButton').disabled = busy || sent;
    for (const [id, key] of [['siteSuggestionRegionLabel', 'siteSuggestionRegion'], ['siteSuggestionSourceLabel', 'siteSuggestionSource']]) {
      const optional = document.createElement('small');
      optional.textContent = `(${window.DiveAtlasContributionTexts.optional[language] || 'optional'})`;
      byId(id).replaceChildren(document.createTextNode(`${t(key)} `), optional);
    }
    message(statusKey);
  }
  async function verify() {
    try {
      if (!window.turnstile) {
        loader ||= new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
          script.onload = resolve; script.onerror = reject; document.head.append(script);
        }).catch(error => { loader = null; throw error; });
        await loader;
      }
      if (modal.hidden) return;
      if (widget !== null) { window.turnstile.reset(widget); return; }
      widget = window.turnstile.render(byId('siteSuggestionTurnstile'), {
        sitekey:'0x4AAAAAAFCEklFmZKeIgpIp', action:'site_suggestion', theme:'auto',
        callback: value => { token = value; if (!sent) message(''); },
        'expired-callback': () => { token = ''; message('siteSuggestionVerify'); },
        'error-callback': () => { token = ''; message('siteSuggestionVerifyUnavailable'); }
      });
    } catch (_) { message('siteSuggestionVerifyUnavailable'); }
  }
  function closeSuggestion() {
    if (busy) return;
    modal.hidden = true;
    document.body.classList.remove('site-suggestion-open');
    token = '';
    if (widget !== null) window.turnstile?.reset(widget);
    previousFocus?.focus({ preventScroll:true });
  }
  function openSuggestion(name = '', trigger = document.activeElement) {
    if (!modal.hidden) return;
    previousFocus = trigger;
    form.reset(); message(''); token = ''; sent = false;
    form.querySelectorAll('input').forEach(input => { input.readOnly = false; });
    byId('siteSuggestionName').value = name.slice(0, 120);
    modal.hidden = false;
    document.body.classList.add('site-suggestion-open');
    renderTexts(); byId('siteSuggestionName').focus();
    void verify();
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || sent) return;
    const name = byId('siteSuggestionName');
    const source = byId('siteSuggestionSource');
    const siteName = name.value.trim().replace(/\s+/g, ' ');
    if (siteName.length < 2) { message('siteSuggestionNameRequired'); name.focus(); return; }
    let sourceUrl = source.value.trim();
    if (sourceUrl) {
      try { if (!['http:', 'https:'].includes(new URL(sourceUrl).protocol)) throw Error(); }
      catch (_) { message('siteSuggestionSourceInvalid'); source.focus(); return; }
    }
    if (!token) { message('siteSuggestionVerify'); return; }
    busy = true;
    form.querySelectorAll('button, input').forEach(node => { node.disabled = true; });
    byId('siteSuggestionCloseButton').disabled = true;
    renderTexts(); message('siteSuggestionSending');
    try {
      const response = await fetch('/api/site-suggestions', { method:'POST', credentials:'same-origin',
        headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ siteName, sourceUrl,
          region:byId('siteSuggestionRegion').value.trim().replace(/\s+/g, ' '),
          website:byId('siteSuggestionWebsite').value, turnstileToken:token }) });
      const result = await response.json();
      if (!response.ok || result?.success !== true) throw Error();
      form.reset(); sent = true; message('siteSuggestionSent');
    } catch (_) { message('siteSuggestionError'); }
    finally {
      busy = false; token = '';
      form.querySelectorAll('button, input').forEach(node => { node.disabled = false; });
      byId('siteSuggestionCloseButton').disabled = false;
      form.querySelectorAll('input').forEach(input => { input.readOnly = sent; });
      renderTexts(); window.turnstile?.reset(widget);
    }
  });
  modal.addEventListener('click', event => { if (event.target.closest('[data-site-suggestion-close]')) closeSuggestion(); });
  els.sitePhotoUploadModal.addEventListener('click', event => {
    if (event.target.closest('[data-site-photo-upload-close]')) photo.closeSitePhotoUploadModal();
    else if (event.target.closest('#sitePhotoUploadPolicyTrigger')) photo.toggleSitePhotoUploadPolicyPopover();
    else if (!event.target.closest('#sitePhotoUploadPolicyPopover')) photo.closeSitePhotoUploadPolicyPopover();
  });
  els.sitePhotoUploadFile.addEventListener('change', photo.previewSitePhotoUpload);
  els.sitePhotoUploadPreviewRemoveButton.addEventListener('click', photo.removeSelectedSitePhotoUpload);
  els.sitePhotoUploadForm.addEventListener('submit', photo.submitSitePhotoUpload);
  els.sitePhotoUploadPolicyAttestation.addEventListener('change', () => {
    photo.setSitePhotoUploadFieldInvalid('policy', !els.sitePhotoUploadPolicyAttestation.checked);
    if (photo.statusKey === 'photoUploadConsentRequired' && els.sitePhotoUploadPolicyAttestation.checked) photo.setSitePhotoUploadStatus();
  });
  els.sitePhotoUploadSignIn.addEventListener('click', photo.rememberSitePhotoUploadContinuation);
  els.sitePhotoUploadDialog.addEventListener('scroll', photo.positionSitePhotoUploadPolicyPopover, { passive:true });
  window.addEventListener('resize', photo.positionSitePhotoUploadPolicyPopover);
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-site-contribution]');
    if (!trigger) return;
    event.preventDefault();
    if (trigger.dataset.siteContribution === 'suggest') openSuggestion('', trigger);
    else {
      const page = byId('detailPage');
      void photo.openSitePhotoUploadModal(page.dataset.siteId, byId('site-title').textContent, trigger);
    }
  });
  document.addEventListener('keydown', event => {
    const active = !modal.hidden ? modal : !els.sitePhotoUploadModal.hidden ? els.sitePhotoUploadModal : null;
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (active === modal) closeSuggestion();
      else if (!photo.closeSitePhotoUploadPolicyPopover(true)) photo.closeSitePhotoUploadModal();
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(active.querySelectorAll('button, input, a[href], [tabindex="0"], iframe'))
      .filter(node => !node.disabled && node.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }, true);
  window.addEventListener('diveatlas:language-change', event => { language = event.detail.language; renderTexts(); });
  window.DiveAtlasContributions = { openSuggestion };
  photo.continueSitePhotoUploadAfterSignIn();
})();
