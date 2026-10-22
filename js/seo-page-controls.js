(() => {
  document.querySelectorAll('.site-photo-gallery-map__cta').forEach(button => {
    const label = document.createElement('span');
    button.style.display = 'inline-flex';
    button.style.justifyContent = 'center';
    button.style.alignItems = 'center';
    label.style.display = 'inline-block';
    label.style.flexShrink = '0';
    label.style.whiteSpace = 'nowrap';
    label.append(...button.childNodes);
    button.append(label);
    const fitLabel = () => {
      const style = getComputedStyle(button);
      const available = button.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      // Measure the rendered text so browser minimum-font settings cannot clip it.
      label.style.transform = 'none';
      const width = label.getBoundingClientRect().width;
      label.style.transform = `scale(${width > 0 ? Math.min(1, Math.max(0, available - 2) / width) : 1})`;
    };
    new ResizeObserver(fitLabel).observe(button);
    document.fonts.ready.then(fitLabel);
    fitLabel();
  });

  if (document.body.classList.contains('seo-site-detail-layout')) {
    const syncViewportInlineSize = () => {
      document.documentElement.style.setProperty('--viewport-inline-size', `${document.documentElement.clientWidth}px`);
    };
    syncViewportInlineSize();
    window.addEventListener('resize', syncViewportInlineSize, { passive:true });
  }

  const byId = id => document.getElementById(id);
  const languageSelect = byId('seoLanguageSelect');
  const languageButton = byId('seoLanguageButton');
  const languageLabel = byId('seoLanguageLabel');
  const languageDropdown = byId('seoLanguageDropdown');
  const themeButton = byId('seoThemeButton');
  const menuButton = byId('seoMenuButton');
  const menuDropdown = byId('seoMenuDropdown');
  const menuBackdrop = byId('seoMenuBackdrop');
  const lengthSwitch = byId('seoLengthUnitSwitch');
  const temperatureSwitch = byId('seoTemperatureUnitSwitch');
  const shareModal = byId('seoShareModal');
  const contactModal = byId('seoContactModal');
  const supportedLanguages = new Set(Array.from(languageSelect?.options || [], option => option.value));
  const detailI18nReady = (() => {
    if (!document.body.classList.contains('seo-site-detail-layout') || window.DiveAtlasSiteDetailI18n) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      const script = document.createElement('script');
      script.src = '/js/dive-site-detail-i18n.js?v=2';
      script.onload = resolve;
      script.onerror = resolve;
      document.head.append(script);
    });
  })();
  const originalName = document.querySelector('[data-seo-site-name]')?.textContent || '';
  const summary = document.querySelector('[data-seo-summary]');
  const originalSummary = summary?.textContent || '';
  const siteId = document.querySelector('.detail-page')?.dataset.siteId || '';
  const shareUrl = document.querySelector('link[rel="canonical"]')?.href || location.href;
  const shareTitle = originalName || document.title;
  let previousFocus = null;
  let turnstileWidget = null;
  let turnstileToken = '';
  let turnstileLoadPromise = null;

  document.querySelectorAll('.site-photo-preview-trigger, .site-photo-gallery-thumbnail').forEach(trigger => {
    trigger.addEventListener('click', event => {
      const button = event.currentTarget;
      const photo = button.querySelector('img');
      const photoCredit = button.closest('.site-photo')?.querySelector('figcaption')?.textContent.trim();
      window.DiveAtlasPhotoPreview?.open({
        src: photo?.currentSrc || photo?.src,
        alt: photo?.alt || document.querySelector('[data-seo-site-name]')?.textContent || '',
        credit: photoCredit
      });
    });
  });

  function setTheme(theme, persist = false) {
    const isDark = theme === 'dark';
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    themeButton?.setAttribute('aria-pressed', String(isDark));
    if (persist) {
      try { localStorage.setItem('global-coral-map-theme', isDark ? 'dark' : 'light'); } catch (_) {}
    }
  }

  let savedTheme = 'light';
  try { savedTheme = localStorage.getItem('global-coral-map-theme') === 'dark' ? 'dark' : 'light'; } catch (_) {}
  setTheme(savedTheme);
  themeButton?.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true));

  const languageShort = { en: 'EN', zh: '中文', 'zh-TW': '繁中', es: 'ES', de: 'DE', fr: 'FR', ja: '日本語', pt: 'PT', it: 'IT', ru: 'RU', ko: '한국어', nl: 'NL', id: 'ID', sv: 'SV', no: 'NO' };
  const languageItems = new Map();
  Array.from(languageSelect?.options || []).forEach(option => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'top-menu-dropdown-item';
    item.setAttribute('role', 'menuitemradio');
    item.dataset.language = option.value;
    item.textContent = option.textContent;
    item.addEventListener('click', () => {
      void setLanguage(option.value, true);
      setLanguageMenu(false);
      languageButton?.focus({ preventScroll: true });
    });
    languageDropdown?.append(item);
    languageItems.set(option.value, item);
  });

  async function setLanguage(language, persist = false) {
    await detailI18nReady;
    if (!supportedLanguages.has(language)) language = 'en';
    if (languageSelect) languageSelect.value = language;
    document.documentElement.lang = language;
    if (languageLabel) languageLabel.textContent = languageShort[language] || language.toUpperCase();
    for (const [value, item] of languageItems) item.setAttribute('aria-checked', String(value === language));
    if (persist) {
      try { localStorage.setItem('global-coral-map-lang', language); } catch (_) {}
    }
    const title = document.querySelector('[data-seo-site-name]');
    const nameLocalization = window.DIVE_SITE_NAME_LOCALIZATION;
    const translationLanguage = language === 'zh-TW' ? 'zh' : language;
    if (title) title.textContent = translationLanguage === 'en' || !nameLocalization ? originalName : nameLocalization.localize(originalName, translationLanguage, siteId);
    window.dispatchEvent(new CustomEvent('diveatlas:language-change', { detail:{ language } }));
    if (!summary) return;
    if (language === 'en' || !window.DiveAtlasSummaryTranslations) {
      summary.textContent = originalSummary;
      return;
    }
    const ready = await window.DiveAtlasSummaryTranslations.ensure(translationLanguage);
    summary.textContent = ready ? window.DiveAtlasSummaryTranslations.translate(translationLanguage, originalSummary) : originalSummary;
  }

  let savedLanguage = 'en';
  try {
    const preference = localStorage.getItem('global-coral-map-lang');
    if (supportedLanguages.has(preference)) savedLanguage = preference;
  } catch (_) {}
  void setLanguage(savedLanguage);
  languageSelect?.addEventListener('change', () => void setLanguage(languageSelect.value, true));

  function setLanguageMenu(open) {
    if (!languageDropdown || !languageButton) return;
    if (open) {
      languageDropdown.hidden = false;
      languageButton.setAttribute('aria-expanded', 'true');
      requestAnimationFrame(() => languageDropdown.classList.add('is-open'));
    } else {
      languageDropdown.classList.remove('is-open');
      languageButton.setAttribute('aria-expanded', 'false');
      if (matchMedia('(max-width:720px)').matches) {
        setTimeout(() => { if (!languageDropdown.classList.contains('is-open')) languageDropdown.hidden = true; }, 260);
      } else languageDropdown.hidden = true;
    }
  }
  languageButton?.addEventListener('click', event => {
    event.stopPropagation();
    setMenu(false);
    setLanguageMenu(languageDropdown.hidden);
  });

  function setUnitSwitch(switchElement, attribute, value) {
    switchElement?.querySelectorAll(`[${attribute}]`).forEach(button => button.setAttribute('aria-pressed', String(button.getAttribute(attribute) === value)));
  }
  function renderDepth(unit) {
    document.querySelectorAll('[data-depth-min][data-depth-max]').forEach(value => {
      const min = value.dataset.depthMin;
      const max = value.dataset.depthMax;
      if (unit === 'ft') {
        const asFeet = metric => metric === '' ? '' : String(Math.round(Number(metric) * 3.28084));
        const values = [asFeet(min), asFeet(max)].filter(Boolean);
        if (values.length === 2 && values[0] === values[1]) values.pop();
        value.textContent = `${values.join('–')} ft`;
      } else {
        const values = [min, max].filter(Boolean);
        if (values.length === 2 && Number(values[0]) === Number(values[1])) values.pop();
        value.textContent = `${values.join('–')} m`;
      }
    });
    setUnitSwitch(lengthSwitch, 'data-length-unit', unit);
  }
  let savedLength = 'm';
  try { savedLength = localStorage.getItem('diveatlas-length-unit') === 'ft' ? 'ft' : 'm'; } catch (_) {}
  renderDepth(savedLength);
  lengthSwitch?.addEventListener('click', event => {
    const button = event.target.closest('[data-length-unit]');
    if (!button) return;
    const unit = button.dataset.lengthUnit;
    try { localStorage.setItem('diveatlas-length-unit', unit); } catch (_) {}
    renderDepth(unit);
  });
  let savedTemperature = 'C';
  try { savedTemperature = localStorage.getItem('diveatlas-temperature-unit') === 'F' ? 'F' : 'C'; } catch (_) {}
  setUnitSwitch(temperatureSwitch, 'data-temperature-unit', savedTemperature);
  temperatureSwitch?.addEventListener('click', event => {
    const button = event.target.closest('[data-temperature-unit]');
    if (!button) return;
    const unit = button.dataset.temperatureUnit;
    try { localStorage.setItem('diveatlas-temperature-unit', unit); } catch (_) {}
    setUnitSwitch(temperatureSwitch, 'data-temperature-unit', unit);
  });

  function setMenu(open) {
    if (!menuDropdown || !menuButton) return;
    if (open) {
      setLanguageMenu(false);
      menuDropdown.hidden = false;
      menuButton.setAttribute('aria-expanded', 'true');
      if (menuBackdrop) menuBackdrop.hidden = !matchMedia('(max-width:720px)').matches;
      requestAnimationFrame(() => menuDropdown.classList.add('is-open'));
    } else {
      menuDropdown.classList.remove('is-open');
      menuButton.setAttribute('aria-expanded', 'false');
      if (menuBackdrop) menuBackdrop.hidden = true;
      if (matchMedia('(max-width:720px)').matches) {
        setTimeout(() => { if (!menuDropdown.classList.contains('is-open')) menuDropdown.hidden = true; }, 240);
      } else menuDropdown.hidden = true;
    }
  }
  menuButton?.addEventListener('click', event => { event.stopPropagation(); setMenu(menuDropdown.hidden); });
  menuBackdrop?.addEventListener('click', () => setMenu(false));
  menuDropdown?.addEventListener('click', event => {
    if (event.target.closest('a.top-menu-dropdown-item')) setMenu(false);
  });
  const aboutButton = byId('seoAboutButton');
  const aboutDetails = byId('seoAboutDetails');
  aboutButton?.addEventListener('click', () => {
    aboutDetails.hidden = !aboutDetails.hidden;
    aboutButton.setAttribute('aria-expanded', String(!aboutDetails.hidden));
  });

  function copyText(text) {
    return (async () => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          return;
        }
      } catch (_) {}
      return new Promise((resolve, reject) => {
      const field = document.createElement('textarea');
      field.value = text;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.append(field);
      field.select();
      const success = document.execCommand('copy');
      field.remove();
      success ? resolve() : reject(new Error('Copy failed'));
      });
    })();
  }
  const shareUrlNode = byId('seoShareUrl');
  if (shareUrlNode) shareUrlNode.textContent = shareUrl;
  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedTitle = encodeURIComponent(shareTitle);
  const facebook = byId('seoShareFacebook');
  const whatsapp = byId('seoShareWhatsapp');
  const shareX = byId('seoShareX');
  const shareReddit = byId('seoShareReddit');
  const shareTelegram = byId('seoShareTelegram');
  const shareLine = byId('seoShareLine');
  const email = byId('seoShareEmail');
  if (facebook) facebook.href = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
  if (whatsapp) whatsapp.href = `https://api.whatsapp.com/send?text=${encodedTitle}%20${encodedUrl}`;
  if (shareX) shareX.href = `https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encodedUrl}`;
  if (shareReddit) shareReddit.href = `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedTitle}`;
  if (shareTelegram) shareTelegram.href = `https://t.me/share/url?url=${encodedUrl}&text=${encodedTitle}`;
  if (shareLine) shareLine.href = `https://social-plugins.line.me/lineit/share?url=${encodedUrl}`;
  if (email) email.href = `mailto:?subject=${encodedTitle}&body=${encodedTitle}%0A${encodedUrl}`;
  const footerShareUrls = {
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    whatsapp: `https://api.whatsapp.com/send?text=${encodedTitle}%20${encodedUrl}`,
    x: `https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encodedUrl}`,
    reddit: `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedTitle}`,
    telegram: `https://t.me/share/url?url=${encodedUrl}&text=${encodedTitle}`,
    line: `https://social-plugins.line.me/lineit/share?url=${encodedUrl}`,
    email: `mailto:?subject=${encodedTitle}&body=${encodedTitle}%0A${encodedUrl}`,
  };
  document.querySelectorAll('[data-footer-share]').forEach(link => {
    const destination = footerShareUrls[link.dataset.footerShare];
    if (destination) link.href = destination;
  });
  document.querySelector('[data-footer-share="instagram"]')?.addEventListener('click', () => {
    // Instagram has no share URL endpoint; copy the page link for pasting there.
    void copyText(shareUrl);
  });
  let siteShareDialog;
  let siteShareLoading;
  function packShareCoordinates(rawLat, rawLng) {
    if (rawLat == null || rawLng == null || rawLat.trim() === '' || rawLng.trim() === '') return null;
    const lat = Number(rawLat);
    const lng = Number(rawLng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng)) return null;

    // Match the map share parser's 1e-5-degree, fixed-width base-36 coordinate pair.
    const scale = 100000;
    const normalizedLng = ((lng + 180) % 360 + 360) % 360 - 180;
    const latCode = Math.round((lat + 90) * scale).toString(36);
    const lngCode = Math.round((normalizedLng + 180) * scale).toString(36);
    if (latCode.length > 5 || lngCode.length > 5) return null;
    return latCode.padStart(5, '0') + lngCode.padStart(5, '0');
  }
  function siteShareUrl() {
    if (!siteId) return shareUrl;
    const url = new URL(`/share/${encodeURIComponent(siteId)}/`, 'https://share.diveatlas.site');
    const mapLink = document.querySelector('.site-photo-gallery-map__mask');
    if (mapLink) {
      const state = new URL(mapLink.href);
      const packedCoordinates = state.searchParams.get('g') || packShareCoordinates(
        state.searchParams.get('lat'),
        state.searchParams.get('lng')
      );
      if (packedCoordinates) {
        url.searchParams.set('g', packedCoordinates);
      } else {
        for (const key of ['lat', 'lng']) {
          if (state.searchParams.has(key)) url.searchParams.set(key, state.searchParams.get(key));
        }
      }
      if (state.searchParams.has('z')) url.searchParams.set('z', state.searchParams.get('z'));
    }
    url.searchParams.set('shareSiteId', siteId);
    url.searchParams.set('shareTarget', 'detail');
    url.searchParams.set('previewBackground', 'site');
    const photo = document.querySelector('.site-photo-gallery-main img');
    const feature = photo?.src.match(/\/features\/([^/]+)\//)?.[1];
    if (feature) url.searchParams.set('shareFeature', feature);
    return url.href;
  }
  const openShareDialog = async () => {
    previousFocus = document.activeElement;
    setMenu(false);
    if (!shareModal) return;
    try {
      siteShareLoading ||= Promise.all([
        import('/js/share-dialog.js?v=1'),
        new Promise((resolve, reject) => {
          const css = document.createElement('link');
          css.rel = 'stylesheet'; css.href = '/assets/share-dialog.css?v=1';
          css.onload = resolve; css.onerror = reject; document.head.append(css);
        })
      ]);
      await siteShareLoading;
      siteShareDialog ||= window.DiveAtlasShare.createSiteDialog({
        modal: shareModal,
        getTitle: () => document.querySelector('[data-seo-site-name]')?.textContent || shareTitle,
        getUrl: siteShareUrl, copyText
      });
      siteShareDialog.open();
    } catch (error) {
      siteShareLoading = null;
      console.error('Share dialog could not load.', error);
      shareModal.hidden = false;
    }
  };
  byId('seoShareButton')?.addEventListener('click', openShareDialog);
  byId('siteTitleShareButton')?.addEventListener('click', openShareDialog);
  const closeShare = () => { if (shareModal) shareModal.hidden = true; previousFocus?.focus?.({ preventScroll: true }); };
  shareModal?.addEventListener('click', event => { if (event.target.closest('[data-seo-share-close]')) closeShare(); });

  const contactDialog = byId('seoContactModal');
  function closeContact() {
    if (!contactDialog) return;
    contactDialog.hidden = true;
    turnstileToken = '';
    try { if (turnstileWidget !== null) window.turnstile?.reset(turnstileWidget); } catch (_) {}
    previousFocus?.focus?.({ preventScroll: true });
  }
  byId('seoContactButton')?.addEventListener('click', () => {
    previousFocus = menuButton;
    setMenu(false);
    contactDialog.hidden = false;
    byId('seoContactName')?.focus();
    void ensureTurnstile();
  });
  contactDialog?.addEventListener('click', event => { if (event.target.closest('[data-seo-contact-close]')) closeContact(); });

  async function ensureTurnstile() {
    if (turnstileWidget !== null) return;
    if (!window.turnstile) {
      if (!turnstileLoadPromise) {
        turnstileLoadPromise = new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
          script.async = true;
          script.onload = resolve;
          script.onerror = reject;
          document.head.append(script);
        });
      }
      try { await turnstileLoadPromise; }
      catch (_) { byId('seoContactStatus').textContent = 'Verification could not be loaded. Please try again later.'; return; }
    }
    if (!window.turnstile || turnstileWidget !== null) return;
    try {
      turnstileWidget = window.turnstile.render('#seoContactTurnstile', {
        sitekey: '0x4AAAAAAFCEklFmZKeIgpIp',
        callback: token => { turnstileToken = token; },
        'expired-callback': () => { turnstileToken = ''; },
        'error-callback': () => { turnstileToken = ''; }
      });
    } catch (_) { byId('seoContactStatus').textContent = 'Verification could not be loaded. Please try again later.'; }
  }

  byId('seoContactForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const emailInput = byId('seoContactEmail');
    const messageInput = byId('seoContactMessage');
    const status = byId('seoContactStatus');
    if (!emailInput.value.trim() || !emailInput.validity.valid) { status.textContent = 'Enter a valid email address.'; emailInput.focus(); return; }
    if (!messageInput.value.trim()) { status.textContent = 'Enter a message.'; messageInput.focus(); return; }
    if (!turnstileToken) { status.textContent = 'Complete the verification challenge before sending.'; return; }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    status.textContent = 'Sending…';
    try {
      const response = await fetch('/api/contact', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: byId('seoContactName').value.trim(), email: emailInput.value.trim(), subject: byId('seoContactSubject').value.trim(), message: messageInput.value.trim(), website: form.elements.website.value, turnstileToken })
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.success !== true) throw new Error(result?.error || `Request failed (${response.status}).`);
      form.reset();
      status.textContent = 'Message sent. Thank you.';
      turnstileToken = '';
      try { window.turnstile?.reset(turnstileWidget); } catch (_) {}
      setTimeout(closeContact, 1400);
    } catch (error) {
      status.textContent = error.message || 'Message could not be sent. Please try again.';
      turnstileToken = '';
      try { window.turnstile?.reset(turnstileWidget); } catch (_) {}
    } finally { submit.disabled = false; }
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('.seo-language-menu') && !languageDropdown?.hidden) setLanguageMenu(false);
    if (!event.target.closest('.seo-menu-wrap') && menuDropdown && !menuDropdown.hidden) setMenu(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (shareModal && !shareModal.hidden) { shareModal.hidden = true; previousFocus?.focus?.({ preventScroll: true }); }
    else if (contactDialog && !contactDialog.hidden) closeContact();
    else if (menuDropdown && !menuDropdown.hidden) { setMenu(false); menuButton?.focus({ preventScroll: true }); }
    else if (languageDropdown && !languageDropdown.hidden) { setLanguageMenu(false); languageButton?.focus({ preventScroll: true }); }
  });
})();
