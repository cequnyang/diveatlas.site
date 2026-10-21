/* Platform actions and persisted ordering are shared by map and detail pages. */
(() => {
  const actionsHtml = `        <div class="share-actions" aria-label="Share options">
          <button class="share-action-button share-action-button--primary" id="shareCopyButton" type="button">
            <span class="share-action-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><rect x="7" y="7" width="10" height="11" rx="2"/><path d="M13 7V4a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2"/></svg></span>
            <span id="shareCopyButtonText">Copy link</span>
          </button>
          <a class="share-action-button" id="shareLineButton" target="_blank" rel="noopener noreferrer" aria-label="Share with LINE" data-share-platform="LINE" hidden>
            <span class="share-action-icon share-action-icon--line" aria-hidden="true"><img src="/assets/share-platforms/line-share-icon.png" alt=""></span><span id="shareLineButtonText">LINE</span>
          </a>
          <a class="share-action-button" id="shareTelegramButton" target="_blank" rel="noopener noreferrer" aria-label="Share with Telegram" data-share-platform="Telegram" hidden>
            <span class="share-action-icon share-action-icon--telegram" aria-hidden="true"><img src="/assets/share-platforms/telegram.svg" alt=""></span><span>Telegram</span>
          </a>
          <a class="share-action-button" id="shareWechatButton" target="_blank" rel="noopener noreferrer" aria-label="分享到微信" data-share-platform="微信" data-copy-only-desktop="true" href="https://weixin.qq.com/" hidden>
            <span class="share-action-icon share-action-icon--wechat" aria-hidden="true"><img src="/assets/share-platforms/wechat-app-icon.jpg" alt=""></span><span>微信</span>
          </a>
          <a class="share-action-button" id="shareRedNoteButton" target="_blank" rel="noopener noreferrer" aria-label="分享到小红书" data-share-platform="小红书" data-copy-only-desktop="true" href="https://www.xiaohongshu.com/" hidden>
            <span class="share-action-icon share-action-icon--rednote" aria-hidden="true"><img src="/assets/share-platforms/xiaohongshu.png" alt=""></span><span>小红书</span>
          </a>
          <a class="share-action-button" id="shareFacebookButton" target="_blank" rel="noopener noreferrer" aria-label="Share on Facebook" data-share-platform="Facebook">
            <span class="share-action-icon share-action-icon--facebook" aria-hidden="true"><svg viewBox="0 0 24 24"><path class="share-mark" d="M13.4 21v-8h2.7l.4-3.1h-3.1v-2c0-.9.3-1.5 1.6-1.5h1.7V3.6c-.3 0-1.4-.1-2.6-.1-2.6 0-4.4 1.6-4.4 4.5v1.9H7v3.1h2.7v8h3.7Z"/></svg></span><span>Facebook</span>
          </a>
          <a class="share-action-button" id="shareWhatsAppButton" target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp" data-share-platform="WhatsApp">
            <span class="share-action-icon share-action-icon--whatsapp" aria-hidden="true"><svg viewBox="0 0 24 24"><path class="share-mark" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg></span><span>WhatsApp</span>
          </a>
          <a class="share-action-button" id="shareXButton" target="_blank" rel="noopener noreferrer" aria-label="Share on X" data-share-platform="X">
            <span class="share-action-icon share-action-icon--x" aria-hidden="true"><svg viewBox="0 0 24 24"><path class="share-mark" d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"/></svg></span><span>X</span>
          </a>
          <a class="share-action-button" id="shareInstagramButton" target="_blank" rel="noopener noreferrer" aria-label="Share on Instagram" data-share-platform="Instagram" data-copy-only-desktop="true" href="https://www.instagram.com/">
            <span class="share-action-icon share-action-icon--instagram" aria-hidden="true"><img src="/assets/share-platforms/instagram-glyph.png" alt=""></span><span>Instagram</span>
          </a>
          <a class="share-action-button" id="shareRedditButton" target="_blank" rel="noopener noreferrer" aria-label="Share on Reddit" data-share-platform="Reddit">
            <span class="share-action-icon share-action-icon--reddit" aria-hidden="true"><svg viewBox="0 0 24 24"><path class="share-mark" d="M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z"/></svg></span><span>Reddit</span>
          </a>
          <a class="share-action-button" id="shareEmailButton" aria-label="Share by email" data-share-platform="Mail">
            <span class="share-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect class="share-mark--outline" x="3" y="5" width="18" height="14" rx="2"/><path class="share-mark--outline" d="m4 7 8 6 8-6"/></svg></span><span>Mail</span>
          </a>
          <button class="share-action-button" id="shareNativeButton" type="button" hidden>
            <span class="share-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path class="share-mark--outline" d="M12 15V3m0 0L7 8m5-5 5 5M3 14v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></svg></span><span>More</span>
          </button>
        </div>
`;
  function createDestinations({ els, getLanguage, getTitle, getUrl, t = key => key,
    copyShareLink, storeSharePreviewImage = () => Promise.resolve() }) {
  function updateSharePlatformVisibility() {
    const isChineseAppearance = getLanguage() === 'zh';
    const isJapaneseOrKoreanAppearance = getLanguage() === 'ja' || getLanguage() === 'ko';
    const isRussianAppearance = getLanguage() === 'ru';
    els.shareLineButton.hidden = !isJapaneseOrKoreanAppearance;
    els.shareTelegramButton.hidden = !isRussianAppearance;
    els.shareWechatButton.hidden = !isChineseAppearance;
    els.shareRedNoteButton.hidden = !isChineseAppearance;
    const lineButtonLabel = getLanguage() === 'ja' ? 'LINEで送る' : '공유하기';
    els.shareLineButtonText.textContent = lineButtonLabel;
    els.shareLineButton.setAttribute('aria-label', lineButtonLabel);
    els.shareTelegramButton.setAttribute('aria-label', 'Поделиться в Telegram');
    els.shareWechatButton.setAttribute('aria-label', '复制链接以分享到微信');
    els.shareRedNoteButton.setAttribute('aria-label', '复制链接以分享到小红书');
    els.shareInstagramButton.setAttribute('aria-label', t('shareCopyForInstagram'));
  }

  function renderShareDestinationLinks() {
    const title = getTitle();
    const url = getUrl();
    const shareText = `${title} | DiveAtlas`;
    // The official LINE icon button shares the URL without a custom message.
    els.shareLineButton.dataset.desktopHref = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}`;
    els.shareLineButton.href = els.shareLineButton.dataset.desktopHref;
    // LINE's documented HTTPS URL scheme opens its mobile share screen. Share
    // only the URL to match this button's existing website-share behavior.
    els.shareLineButton.dataset.mobileHref = `https://line.me/R/share?text=${encodeURIComponent(url)}`;
    els.shareTelegramButton.href = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(shareText)}`;
    // XHS documents this inbox route; its web SDK shares notes, not private messages.
    // https://pages.xiaohongshu.com/activity/deeplink and https://agora.xiaohongshu.com/doc/js
    els.shareRedNoteButton.dataset.mobileHref = 'xhsdiscover://message/center';
    els.shareWhatsAppButton.href = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${url}`)}`;
    els.shareEmailButton.href = `mailto:?subject=${encodeURIComponent(shareText)}&body=${encodeURIComponent(`${shareText}\n${url}`)}`;
    els.shareXButton.href = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(url)}`;
    els.shareFacebookButton.href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
    els.shareRedditButton.href = `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(shareText)}`;
    els.shareNativeButton.hidden = typeof navigator.share !== 'function';
  }

  function isMobileShareExperience() {
    return window.matchMedia?.('(max-width: 720px), (pointer: coarse)').matches ?? false;
  }

  function shareExternalLinkAfterPreviewSave(event) {
    const link = event.currentTarget;

    if (isMobileShareExperience()) {
      if (link === els.shareWechatButton) {
        event.preventDefault();
        void copyShareLink(link.dataset.sharePlatform || null);
        void storeSharePreviewImage();
        if (typeof navigator.share === 'function') {
          // The supplied iOS repro shows WeChat rejecting the structured URL item.
          // Send the link as plain text so it can be shared as a chat message.
          try {
            void navigator.share({ text: getUrl() })
              .catch(error => {
                if (error?.name !== 'AbortError') {
                  console.debug('Native share picker could not be opened.', error);
                }
              });
          } catch (error) {
            console.debug('Native share picker could not be opened.', error);
          }
        }
        return;
      }

      if (link === els.shareRedNoteButton) {
        // The documented XHS route opens the inbox. Copy the link so the user
        // can choose a friend there and paste it into the conversation.
        link.href = link.dataset.mobileHref;
        link.target = '_self';
        void copyShareLink(link.dataset.sharePlatform || null);
        void storeSharePreviewImage();
        return;
      }

      // Start the clipboard write during the original tap, then allow the
      // HTTPS share/app link to open in that same user gesture.
      if (link.dataset.mobileHref) link.href = link.dataset.mobileHref;
      void copyShareLink(link.dataset.sharePlatform || null);
      void storeSharePreviewImage();
      return;
    }

    if (link.dataset.desktopHref) link.href = link.dataset.desktopHref;

    if (link === els.shareInstagramButton) {
      // Instagram has no web share endpoint for prefilled links. Copy the
      // DiveAtlas URL and let the anchor open Instagram so it can be pasted
      // into a post or message there.
      void copyShareLink(link.dataset.sharePlatform || null);
      void storeSharePreviewImage();
      return;
    }

    if (link.dataset.copyOnlyDesktop === 'true') {
      event.preventDefault();
      void copyShareLink(link.dataset.sharePlatform || null);
      void storeSharePreviewImage();
      return;
    }

    const destination = link.href;
    event.preventDefault();
    const pendingTab = window.open('about:blank', '_blank');
    if (pendingTab) {
      pendingTab.opener = null;
      pendingTab.document.title = 'Share | DiveAtlas';
      pendingTab.document.body.textContent = 'Preparing your share…';
    }
    void storeSharePreviewImage().finally(() => {
      if (pendingTab && !pendingTab.closed) pendingTab.location.replace(destination);
      else if (!pendingTab) window.location.assign(destination);
    });
  }

  const shareDestinationRow = els.shareCopyButton.closest('.share-actions');
  const shareDefaultDestinations = [...shareDestinationRow.querySelectorAll('.share-action-button')];
  const SHARE_INTERACTION_STORAGE_KEY = 'global-coral-map-share-interactions-v1';
  const SHARE_LAST_DESTINATION_STORAGE_KEY = 'global-coral-map-share-last-destination-v1';
  let shareInteractionCounts = {};
  let shareLastDestination = '';

  function readShareInteractionCounts() {
    try {
      const stored = JSON.parse(localStorage.getItem(SHARE_INTERACTION_STORAGE_KEY) || '{}');
      // Accept only known destinations and finite nonnegative counts from browser storage.
      return Object.fromEntries(shareDefaultDestinations.map(button => {
        const count = stored?.[button.id];
        return [button.id, Number.isSafeInteger(count) && count >= 0 ? count : 0];
      }));
    } catch (_) {
      return { ...shareInteractionCounts };
    }
  }

  function sortShareDestinations() {
    shareInteractionCounts = readShareInteractionCounts();
    const middle = shareDefaultDestinations.filter(button => button !== els.shareCopyButton && button !== els.shareNativeButton);
    try {
      const stored = localStorage.getItem(SHARE_LAST_DESTINATION_STORAGE_KEY);
      shareLastDestination = middle.some(button => button.id === stored) ? stored : '';
    } catch (_) {}
    // Stable ties preserve the original order across opens and language changes.
    middle.sort((a, b) => Number(b.id === shareLastDestination) - Number(a.id === shareLastDestination)
      || (shareInteractionCounts[b.id] || 0) - (shareInteractionCounts[a.id] || 0));
    shareDestinationRow.append(els.shareCopyButton, ...middle, els.shareNativeButton);
    shareDestinationRow.scrollLeft = 0;
  }

  shareDestinationRow.addEventListener('click', event => {
    const button = event.target.closest('.share-action-button');
    if (!shareDefaultDestinations.includes(button)) return;
    shareInteractionCounts = readShareInteractionCounts();
    shareInteractionCounts[button.id] = Math.min(Number.MAX_SAFE_INTEGER, (shareInteractionCounts[button.id] || 0) + 1);
    try {
      localStorage.setItem(SHARE_INTERACTION_STORAGE_KEY, JSON.stringify(shareInteractionCounts));
    } catch (_) {}
    // Copy and the native picker do not replace the most recently selected platform.
    if (button !== els.shareCopyButton && button !== els.shareNativeButton) {
      shareLastDestination = button.id;
      try {
        localStorage.setItem(SHARE_LAST_DESTINATION_STORAGE_KEY, shareLastDestination);
      } catch (_) {}
    }
    // Reorder on the next open so the destination stays under the pointer during this interaction.
  }, { capture: true });
  [els.shareLineButton, els.shareTelegramButton, els.shareWechatButton, els.shareRedNoteButton, els.shareFacebookButton, els.shareWhatsAppButton, els.shareXButton, els.shareInstagramButton, els.shareRedditButton, els.shareEmailButton]
    .forEach(button => button.addEventListener('click', shareExternalLinkAfterPreviewSave));

    return { visibility: updateSharePlatformVisibility, links: renderShareDestinationLinks, sort: sortShareDestinations };
  }

  function createSiteDialog({ modal, getTitle, getUrl, copyText }) {
    modal.className = 'share-modal';
    modal.innerHTML = `<div class="share-modal-backdrop" data-seo-share-close></div>
      <section class="share-dialog" role="dialog" aria-modal="true" aria-labelledby="seoShareTitle">
        <div class="share-dialog-header"><h2 class="share-dialog-title" id="seoShareTitle">Share</h2>
          <button class="contact-dialog-close" id="shareCloseButton" type="button" aria-label="Close" data-seo-share-close><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 1 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg></button></div>
        <div class="share-dialog-body">
          <div class="share-preview-frame" data-background="site" aria-label="Dive site image preview">
            <div class="share-preview-composition">
              <img class="share-preview-site-photo" alt="">
              <div class="share-preview-photo-label">Representative image · not this dive site</div>
              <div class="share-preview-photo-credit"></div>
              <div class="share-preview-placeholder" role="status" hidden>Preview image unavailable</div>
              <aside class="share-preview-popup-data"><strong></strong><ul></ul></aside>
            </div>
            <button class="share-preview-copy" id="sharePreviewCopyButton" type="button"><span class="share-preview-copy-content"><span id="sharePreviewCopyText">Copy link</span></span></button>
          </div>
          ${actionsHtml}
          <p class="share-status visually-hidden" id="shareStatus" role="status" aria-live="polite"></p>
        </div>
      </section>`;
    const els = Object.fromEntries([...modal.querySelectorAll('[id]')].map(node => [node.id, node]));
    const image = modal.querySelector('.share-preview-site-photo');
    const placeholder = modal.querySelector('.share-preview-placeholder');
    const frame = modal.querySelector('.share-preview-frame');
    const composition = modal.querySelector('.share-preview-composition');
    const fitPreview = () => { composition.style.transform = `scale(${frame.clientWidth / 1200})`; };
    new ResizeObserver(fitPreview).observe(frame);
    image.addEventListener('load', () => { placeholder.hidden = true; });
    image.addEventListener('error', () => { placeholder.textContent = 'Preview image unavailable'; placeholder.hidden = false; });
    let feedbackTimer;
    const copyShareLink = async platform => {
      try {
        await copyText(getUrl());
        els.shareStatus.textContent = ['Instagram', '微信', '小红书'].includes(platform)
          ? `Link copied. Paste it in ${platform}.` : 'Link copied.';
        els.shareCopyButtonText.textContent = 'Copied';
      } catch (_) {
        els.shareStatus.textContent = 'Could not copy the link.';
      }
      clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => { els.shareCopyButtonText.textContent = 'Copy link'; }, 1800);
    };
    const destinations = createDestinations({
      els, getLanguage: () => document.documentElement.lang === 'zh-TW' ? 'zh' : document.documentElement.lang,
      getTitle, getUrl, copyShareLink,
      t: key => ({ shareCopyForInstagram: 'Copy link for Instagram' })[key] || key
    });
    els.shareCopyButton.addEventListener('click', () => { void copyShareLink(); });
    els.sharePreviewCopyButton.addEventListener('click', () => { void copyShareLink(); });
    els.shareNativeButton.addEventListener('click', async () => {
      try { await navigator.share({ title: `${getTitle()} | DiveAtlas`, text: `${getTitle()} | DiveAtlas`, url: getUrl() }); }
      catch (error) { if (error.name !== 'AbortError') els.shareStatus.textContent = 'Sharing is unavailable in this browser.'; }
    });
    modal.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...modal.querySelectorAll('button, a[href]')].filter(node => node.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    return {
      open() {
        const source = document.querySelector('.site-photo-gallery-main img');
        if (source) image.src = source.currentSrc || source.src;
        placeholder.textContent = source ? 'Preparing preview…' : 'Preview image unavailable';
        placeholder.hidden = Boolean(source && image.complete && image.naturalWidth);
        modal.querySelector('.share-preview-photo-label').hidden = !source?.alt.toLowerCase().includes('illustrative');
        modal.querySelector('.share-preview-photo-credit').textContent = document.querySelector('.site-photo figcaption')?.textContent || '';
        modal.querySelector('.share-preview-popup-data strong').textContent = getTitle();
        const items = [document.querySelector('.hero-copy .lead')?.textContent, document.querySelector('[data-seo-summary]')?.textContent];
        document.querySelectorAll('.facts-section .fact:not(.fact-coordinates)').forEach(fact => {
          if (items.length < 6) items.push(`${fact.querySelector('dt')?.textContent}: ${fact.querySelector('dd')?.textContent}`);
        });
        modal.querySelector('.share-preview-popup-data ul').replaceChildren(...items.filter(Boolean).map(text => {
          const li = document.createElement('li'); li.textContent = text; return li;
        }));
        destinations.visibility(); destinations.links(); destinations.sort();
        modal.hidden = false;
        fitPreview();
        els.shareCopyButton.focus();
      }
    };
  }
  // Populate before the map initializes its element registry so both pages use the same marks.
  const mapActions = document.querySelector('#shareModal .share-actions');
  if (mapActions) mapActions.outerHTML = actionsHtml;
  window.DiveAtlasShare = { actionsHtml, createDestinations, createSiteDialog };
})();
