// Shared by the map and detail pages so validation, compression, consent and
// private-review payloads cannot drift between contribution entry points.
(() => {
  'use strict';
  window.DiveAtlasPhotoSubmission = { create({ els, t, tf, setTopMenuOpen = () => {} }) {
    const SITE_PHOTO_SUBMISSION_ENDPOINT = window.location.hostname === 'localhost' && window.location.port === '8787'
      ? 'http://localhost:8788/api/site-photo-submissions'
      : '/api/site-photo-submissions';
    const SITE_PHOTO_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
    const SITE_PHOTO_UPLOAD_COMPRESSED_TARGET_BYTES = 4.5 * 1024 * 1024;
    // Bound local image decoding work while still accepting typical high-resolution camera photos.
    const SITE_PHOTO_UPLOAD_MAX_SOURCE_BYTES = 50 * 1024 * 1024;
    const SITE_PHOTO_UPLOAD_COMPRESSED_MAX_EDGE = 8000;
    const SITE_PHOTO_UPLOAD_CONTINUATION_KEY = 'diveatlas:photo-upload-after-sign-in:v1';
    // Keep the continuation no longer than the auth worker's 10-minute OAuth state lifetime.
    const SITE_PHOTO_UPLOAD_CONTINUATION_TTL_MS = 10 * 60 * 1000;
    let sitePhotoUploadPreviousFocus = null;
    let sitePhotoUploadSiteId = '';
    let sitePhotoUploadSiteName = '';
    let sitePhotoUploadPreparedFile = null;
    let sitePhotoUploadPreparedMetadata = null;
    let sitePhotoUploadPreparing = false;
    let sitePhotoUploadPreparationId = 0;
    let sitePhotoUploadObjectUrl = '';
    let sitePhotoUploadSubmitting = false;
    let sitePhotoUploadStatusKey = '';
    let sitePhotoUploadStatusTone = '';
    let sitePhotoUploadStatusValues = null;
    function renderSitePhotoUploadTexts() {
      if (!els.sitePhotoUploadForm) return;
      els.sitePhotoUploadTitle.textContent = t('photoUploadTitle');
      els.sitePhotoUploadCopy.textContent = t('photoUploadCopy');
      els.sitePhotoUploadSiteLabel.textContent = t('photoUploadSite');
      els.sitePhotoUploadSignInCopy.textContent = t('photoUploadSignInCopy');
      els.sitePhotoUploadSignIn.textContent = t('photoUploadSignIn');
      els.sitePhotoUploadFileLabel.textContent = t('photoUploadFile');
      els.sitePhotoUploadFileHelp.textContent = t('photoUploadFileHelp');
      els.sitePhotoUploadPreviewRemoveButton.setAttribute('aria-label', t('photoUploadRemoveSelectedPhoto'));
      els.sitePhotoUploadPreviewRemoveButton.title = t('photoUploadRemoveSelectedPhoto');
      els.sitePhotoUploadCreditLabel.textContent = t('photoUploadCredit');
      els.sitePhotoUploadPolicyLabel.textContent = t('photoUploadPolicyLabel');
      els.sitePhotoUploadPolicyAttestationCopy.textContent = t('photoUploadPolicyAttestation');
      els.sitePhotoUploadReviewHeading.textContent = t('photoUploadReviewHeading');
      els.sitePhotoUploadReviewCopy.textContent = t('photoUploadReview');
      els.sitePhotoUploadAuthenticityHeading.textContent = t('photoUploadAuthenticityHeading');
      els.sitePhotoUploadAuthenticityCopy.textContent = t('photoUploadAuthenticity');
      els.sitePhotoUploadPrivacyHeading.textContent = t('photoUploadPrivacyHeading');
      els.sitePhotoUploadPrivacyCopy.textContent = t('photoUploadPrivacy');
      els.sitePhotoUploadRightsHeading.textContent = t('photoUploadRightsHeading');
      els.sitePhotoUploadRightsCopy.textContent = t('photoUploadRights');
      if (els.sitePhotoUploadPolicyTrigger.getAttribute('aria-expanded') === 'true') {
        positionSitePhotoUploadPolicyPopover();
      }
      els.sitePhotoUploadCancelButton.textContent = t('photoUploadCancel');
      els.sitePhotoUploadSubmitButton.textContent = sitePhotoUploadSubmitting
        ? t('photoUploadSending')
        : sitePhotoUploadPreparing ? t('photoUploadPreparing') : t('photoUploadSubmit');
      els.sitePhotoUploadCloseButton.title = t('contactClose');
      els.sitePhotoUploadCloseButton.setAttribute('aria-label', t('contactClose'));
      els.sitePhotoUploadSuccessTitle.textContent = t('photoUploadSuccessTitle');
      els.sitePhotoUploadSuccessCopy.textContent = t('photoUploadSuccessCopy');
      els.sitePhotoUploadDoneButton.textContent = t('photoUploadDone');
      renderSitePhotoUploadStatus();
    }

    function renderSitePhotoUploadStatus() {
      if (!els.sitePhotoUploadStatus) return;
      els.sitePhotoUploadStatus.textContent = sitePhotoUploadStatusKey
        ? (sitePhotoUploadStatusValues
          ? tf(sitePhotoUploadStatusKey, sitePhotoUploadStatusValues)
          : t(sitePhotoUploadStatusKey))
        : '';
      els.sitePhotoUploadStatus.classList.toggle('is-error', sitePhotoUploadStatusTone === 'error');
      els.sitePhotoUploadStatus.classList.toggle('is-success', sitePhotoUploadStatusTone === 'success');
    }

    function setSitePhotoUploadPreviewVisible(visible) {
      const isVisible = Boolean(visible);
      const moveFocusToPreview = isVisible && document.activeElement === els.sitePhotoUploadFile;
      els.sitePhotoUploadPreview.hidden = !isVisible;
      els.sitePhotoUploadPreview.closest('.site-photo-upload-file-field')
        ?.classList.toggle('has-preview', isVisible);
      if (moveFocusToPreview) els.sitePhotoUploadPreviewRemoveButton.focus({ preventScroll: true });
    }

    function setSitePhotoUploadStatus(key = '', tone = '', values = null) {
      sitePhotoUploadStatusKey = key;
      sitePhotoUploadStatusTone = tone;
      sitePhotoUploadStatusValues = values;
      renderSitePhotoUploadStatus();
    }

    function setSitePhotoUploadFieldInvalid(field, invalid) {
      const isInvalid = Boolean(invalid);
      if (field === 'photo') {
        if (isInvalid) els.sitePhotoUploadFile.setAttribute('aria-invalid', 'true');
        else els.sitePhotoUploadFile.removeAttribute('aria-invalid');
        return;
      }
      if (field === 'policy') {
        if (isInvalid) els.sitePhotoUploadPolicyAttestation.setAttribute('aria-invalid', 'true');
        else els.sitePhotoUploadPolicyAttestation.removeAttribute('aria-invalid');
        els.sitePhotoUploadPolicyAttestation.closest('.site-photo-upload-check')
          ?.classList.toggle('is-invalid', isInvalid);
      }
    }

    function setSitePhotoUploadSubmitting(submitting) {
      sitePhotoUploadSubmitting = Boolean(submitting);
      els.sitePhotoUploadSubmitButton.disabled = sitePhotoUploadSubmitting || sitePhotoUploadPreparing;
      els.sitePhotoUploadCancelButton.disabled = sitePhotoUploadSubmitting;
      els.sitePhotoUploadCloseButton.disabled = sitePhotoUploadSubmitting;
      els.sitePhotoUploadPreviewRemoveButton.disabled = sitePhotoUploadSubmitting;
      els.sitePhotoUploadForm.setAttribute('aria-busy', sitePhotoUploadSubmitting || sitePhotoUploadPreparing ? 'true' : 'false');
      renderSitePhotoUploadTexts();
    }

    function setSitePhotoUploadPreparing(preparing) {
      sitePhotoUploadPreparing = Boolean(preparing);
      els.sitePhotoUploadSubmitButton.disabled = sitePhotoUploadSubmitting || sitePhotoUploadPreparing;
      els.sitePhotoUploadForm.setAttribute('aria-busy', sitePhotoUploadSubmitting || sitePhotoUploadPreparing ? 'true' : 'false');
      renderSitePhotoUploadTexts();
    }

    function showSitePhotoUploadAccount(user, unavailable = false) {
      const signedIn = Boolean(user && typeof user === 'object');
      els.sitePhotoUploadForm.hidden = !signedIn;
      els.sitePhotoUploadAuthRequired.hidden = signedIn;
      els.sitePhotoUploadSignIn.hidden = unavailable;
      if (!signedIn && !unavailable) els.sitePhotoUploadSignIn.href = '/api/auth/google';
      else els.sitePhotoUploadSignIn.removeAttribute('href');
      if (signedIn) {
        const name = String(user.name || '').trim();
        if (!els.sitePhotoUploadCredit.value.trim()) els.sitePhotoUploadCredit.value = name;
      } else {
        els.sitePhotoUploadSignInCopy.textContent = unavailable
          ? t('photoUploadAuthUnavailable')
          : t('photoUploadSignInCopy');
      }
    }

    function positionSitePhotoUploadPolicyPopover() {
      const popover = els.sitePhotoUploadPolicyPopover;
      if (popover.hidden) return;
      const triggerRect = els.sitePhotoUploadPolicyTrigger.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const margin = 12;
      const left = Math.max(margin, Math.min(triggerRect.left, window.innerWidth - popoverRect.width - margin));
      const top = Math.max(margin, triggerRect.top - popoverRect.height - 8);
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
    }

    function setSitePhotoUploadPolicyPopover(expanded, restoreFocus = false) {
      const isExpanded = Boolean(expanded);
      els.sitePhotoUploadPolicyTrigger.setAttribute('aria-expanded', String(isExpanded));
      els.sitePhotoUploadPolicyPopover.hidden = !isExpanded;
      if (isExpanded) {
        positionSitePhotoUploadPolicyPopover();
        els.sitePhotoUploadPolicyPopover.focus({ preventScroll: true });
      } else {
        els.sitePhotoUploadPolicyPopover.style.removeProperty('left');
        els.sitePhotoUploadPolicyPopover.style.removeProperty('top');
        if (restoreFocus) els.sitePhotoUploadPolicyTrigger.focus({ preventScroll: true });
      }
    }

    function closeSitePhotoUploadPolicyPopover(restoreFocus = false) {
      if (els.sitePhotoUploadPolicyTrigger.getAttribute('aria-expanded') !== 'true') return false;
      setSitePhotoUploadPolicyPopover(false, restoreFocus);
      return true;
    }

    function toggleSitePhotoUploadPolicyPopover() {
      setSitePhotoUploadPolicyPopover(
        els.sitePhotoUploadPolicyTrigger.getAttribute('aria-expanded') !== 'true'
      );
    }

    function rememberSitePhotoUploadContinuation() {
      if (!sitePhotoUploadSiteId) return;
      try {
        sessionStorage.setItem(SITE_PHOTO_UPLOAD_CONTINUATION_KEY, JSON.stringify({
          siteId: String(sitePhotoUploadSiteId).slice(0, 256),
          siteName: String(sitePhotoUploadSiteName || '').slice(0, 240),
          createdAt: Date.now(),
          ...(location.pathname === '/dive-site.html' ? { returnPath: location.pathname + location.search } : {})
        }));
      } catch (_) {}
    }

    function continueSitePhotoUploadAfterSignIn() {
      let saved = '';
      try {
        if (new URLSearchParams(window.location.search).get('auth_notice') !== 'signed-in') {
          sessionStorage.removeItem(SITE_PHOTO_UPLOAD_CONTINUATION_KEY);
          return;
        }
        saved = sessionStorage.getItem(SITE_PHOTO_UPLOAD_CONTINUATION_KEY) || '';
        sessionStorage.removeItem(SITE_PHOTO_UPLOAD_CONTINUATION_KEY);
      } catch (_) {
        return;
      }
      if (!saved) return;

      try {
        const continuation = JSON.parse(saved);
        const siteId = typeof continuation.siteId === 'string' ? continuation.siteId.trim() : '';
        const siteName = typeof continuation.siteName === 'string' ? continuation.siteName.trim() : '';
        const createdAt = Number(continuation.createdAt);
        const age = Date.now() - createdAt;
        if (!siteId || siteId.length > 256 || !siteName || siteName.length > 240 ||
            !Number.isFinite(age) || age < 0 || age > SITE_PHOTO_UPLOAD_CONTINUATION_TTL_MS) return;

        // OAuth returns to the map. Resume a detail-page contribution only at the
        // fixed same-origin detail route, never at an arbitrary stored redirect.
        if (continuation.returnPath && location.pathname !== '/dive-site.html') {
          const target = new URL(continuation.returnPath, location.origin);
          if (target.origin === location.origin && target.pathname === '/dive-site.html') {
            target.searchParams.set('auth_notice', 'signed-in');
            delete continuation.returnPath;
            sessionStorage.setItem(SITE_PHOTO_UPLOAD_CONTINUATION_KEY, JSON.stringify(continuation));
            location.replace(target.href);
            return;
          }
        }
        void openSitePhotoUploadModal(siteId, siteName, null);
      } catch (_) {}
    }

    async function openSitePhotoUploadModal(siteId, siteName, trigger) {
      if (!siteId || !els.sitePhotoUploadModal.hidden) return;
      sitePhotoUploadPreparationId += 1;
      sitePhotoUploadPreparedFile = null;
      sitePhotoUploadPreparedMetadata = null;
      setSitePhotoUploadPreparing(false);
      sitePhotoUploadPreviousFocus = trigger || document.activeElement;
      sitePhotoUploadSiteId = siteId;
      sitePhotoUploadSiteName = siteName;
      sitePhotoUploadSubmitting = false;
      closeSitePhotoUploadPolicyPopover();
      setSitePhotoUploadStatus();
      els.sitePhotoUploadForm.reset();
      els.sitePhotoUploadForm.hidden = true;
      els.sitePhotoUploadSuccess.hidden = true;
      els.sitePhotoUploadAuthRequired.hidden = false;
      els.sitePhotoUploadSignIn.hidden = true;
      els.sitePhotoUploadSignInCopy.textContent = t('photoUploadChecking');
      els.sitePhotoUploadSiteName.textContent = siteName;
      setSitePhotoUploadPreviewVisible(false);
      els.sitePhotoUploadPreviewImage.removeAttribute('src');
      if (sitePhotoUploadObjectUrl) URL.revokeObjectURL(sitePhotoUploadObjectUrl);
      sitePhotoUploadObjectUrl = '';
      setTopMenuOpen(false);
      els.sitePhotoUploadModal.hidden = false;
      document.body.classList.add('site-photo-upload-open');
      renderSitePhotoUploadTexts();
      requestAnimationFrame(() => els.sitePhotoUploadCloseButton.focus());

      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw new Error('Account lookup failed');
        const result = await response.json();
        if (els.sitePhotoUploadModal.hidden) return;
        showSitePhotoUploadAccount(result?.user || null);
        if (result?.user) requestAnimationFrame(() => els.sitePhotoUploadFile.focus());
        else requestAnimationFrame(() => els.sitePhotoUploadSignIn.focus());
      } catch (_) {
        if (els.sitePhotoUploadModal.hidden) return;
        showSitePhotoUploadAccount(null, true);
        requestAnimationFrame(() => els.sitePhotoUploadCloseButton.focus());
      }
    }

    function closeSitePhotoUploadModal() {
      if (sitePhotoUploadSubmitting || els.sitePhotoUploadModal.hidden) return;
      sitePhotoUploadPreparationId += 1;
      sitePhotoUploadPreparedFile = null;
      sitePhotoUploadPreparedMetadata = null;
      setSitePhotoUploadPreparing(false);
      closeSitePhotoUploadPolicyPopover();
      els.sitePhotoUploadModal.hidden = true;
      document.body.classList.remove('site-photo-upload-open');
      els.sitePhotoUploadForm.reset();
      els.sitePhotoUploadSuccess.hidden = true;
      setSitePhotoUploadPreviewVisible(false);
      els.sitePhotoUploadPreviewImage.removeAttribute('src');
      if (sitePhotoUploadObjectUrl) URL.revokeObjectURL(sitePhotoUploadObjectUrl);
      sitePhotoUploadObjectUrl = '';
      sitePhotoUploadSiteId = '';
      sitePhotoUploadSiteName = '';
      setSitePhotoUploadStatus();
      renderSitePhotoUploadTexts();
      if (sitePhotoUploadPreviousFocus?.isConnected && typeof sitePhotoUploadPreviousFocus.focus === 'function') {
        sitePhotoUploadPreviousFocus.focus({ preventScroll: true });
      }
    }

    function encodeSitePhotoUploadCanvas(canvas, mimeType, quality) {
      return new Promise((resolve, reject) => {
        try {
          canvas.toBlob(blob => resolve(blob), mimeType, quality);
        } catch (error) {
          reject(error);
        }
      });
    }

    async function compressSitePhotoUpload(file, image, dimensions, shouldContinue) {
      const pixels = dimensions.width * dimensions.height;
      const minimumScale = Math.max(
        700 / Math.min(dimensions.width, dimensions.height),
        Math.sqrt(1_000_000 / pixels)
      );
      const initialScale = Math.max(minimumScale, Math.min(
        1,
        SITE_PHOTO_UPLOAD_COMPRESSED_MAX_EDGE / Math.max(dimensions.width, dimensions.height),
        Math.sqrt(80_000_000 / pixels)
      ));
      const inputType = file.type.toLowerCase();
      const prefersJpeg = inputType === 'image/jpeg' || inputType === 'image/jpg' || /\.jpe?g$/i.test(file.name);
      const outputTypes = prefersJpeg ? ['image/jpeg'] : ['image/webp', 'image/jpeg'];
      const qualities = [0.9, 0.82, 0.74, 0.66, 0.58];
      const canvas = document.createElement('canvas');

      for (const mimeType of outputTypes) {
        let scale = initialScale;
        for (let resizeAttempt = 0; resizeAttempt < 8; resizeAttempt += 1) {
          if (!shouldContinue()) return null;
          const width = Math.max(1, Math.round(dimensions.width * scale));
          const height = Math.max(1, Math.round(dimensions.height * scale));
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('photoUploadCompressFailed');
          context.clearRect(0, 0, width, height);
          if (mimeType === 'image/jpeg') {
            context.fillStyle = '#fff';
            context.fillRect(0, 0, width, height);
          }
          context.drawImage(image, 0, 0, width, height);

          let encodingUnsupported = false;
          for (const quality of qualities) {
            if (!shouldContinue()) return null;
            const blob = await encodeSitePhotoUploadCanvas(canvas, mimeType, quality);
            if (!shouldContinue()) return null;
            if (!blob?.size) throw new Error('photoUploadCompressFailed');
            if (blob.type !== mimeType) {
              encodingUnsupported = true;
              break;
            }
            if (blob.size <= SITE_PHOTO_UPLOAD_COMPRESSED_TARGET_BYTES) {
              const extension = mimeType === 'image/webp' ? 'webp' : 'jpg';
              const baseName = file.name.replace(/\.[^./\\]+$/, '') || 'photo';
              return {
                file: new File([blob], `${baseName}.${extension}`, {
                  type: mimeType,
                  lastModified: file.lastModified
                }),
                width,
                height
              };
            }
          }
          if (encodingUnsupported) break;
          const nextScale = Math.max(minimumScale, scale * 0.82);
          if (nextScale >= scale) break;
          scale = nextScale;
        }
      }
      return null;
    }

    async function previewSitePhotoUpload() {
      const preparationId = ++sitePhotoUploadPreparationId;
      const file = els.sitePhotoUploadFile.files?.[0];
      const isCurrentSelection = () =>
        preparationId === sitePhotoUploadPreparationId && els.sitePhotoUploadFile.files?.[0] === file;
      setSitePhotoUploadPreparing(false);
      setSitePhotoUploadFieldInvalid('photo', false);
      sitePhotoUploadPreparedFile = null;
      sitePhotoUploadPreparedMetadata = null;
      setSitePhotoUploadStatus();
      setSitePhotoUploadPreviewVisible(false);
      if (sitePhotoUploadObjectUrl) URL.revokeObjectURL(sitePhotoUploadObjectUrl);
      sitePhotoUploadObjectUrl = '';
      if (!file) return;

      const supportedMime = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'].includes(file.type);
      if (!supportedMime && !(file.type === '' && /\.(jpe?g|png|webp)$/i.test(file.name))) {
        els.sitePhotoUploadFile.value = '';
        setSitePhotoUploadFieldInvalid('photo', true);
        setSitePhotoUploadStatus('photoUploadInvalid', 'error');
        return;
      }
      if (file.size > SITE_PHOTO_UPLOAD_MAX_SOURCE_BYTES) {
        els.sitePhotoUploadFile.value = '';
        setSitePhotoUploadFieldInvalid('photo', true);
        setSitePhotoUploadStatus('photoUploadSourceTooLarge', 'error');
        return;
      }
      setSitePhotoUploadPreparing(true);
      setSitePhotoUploadStatus('photoUploadPreparing');

      let sourceUrl = '';
      let previewUrl = '';
      try {
        sourceUrl = URL.createObjectURL(file);
        const image = await new Promise(resolve => {
          const loadedImage = new Image();
          loadedImage.onload = () => resolve(loadedImage);
          loadedImage.onerror = () => resolve(null);
          loadedImage.src = sourceUrl;
        });
        if (!isCurrentSelection()) return;
        if (!image) throw new Error('photoUploadInvalid');

        const dimensions = { width: image.naturalWidth, height: image.naturalHeight };
        const pixels = dimensions.width * dimensions.height;
        if (Math.min(dimensions.width, dimensions.height) < 700 || pixels < 1_000_000) {
          const error = new Error('photoUploadTooSmallSelected');
          error.statusValues = {
            megapixels: (pixels / 1_000_000).toFixed(2),
            shortSide: Math.min(dimensions.width, dimensions.height).toLocaleString()
          };
          throw error;
        }
        if (Math.max(dimensions.width, dimensions.height) > 12_000 || pixels > 80_000_000) {
          throw new Error('photoUploadDimensions');
        }

        let extractedReviewMetadata = { version: 1 };
        try {
          const readMetadata = window.DiveAtlasPhotoMetadata?.read;
          if (typeof readMetadata === 'function') {
            extractedReviewMetadata = await readMetadata(file) || extractedReviewMetadata;
          }
        } catch (_) {}
        if (!isCurrentSelection()) return;
        sitePhotoUploadPreparedMetadata = {
          version: 1,
          originalDimensions: dimensions,
          ...(extractedReviewMetadata.capturedAt ? { capturedAt: extractedReviewMetadata.capturedAt } : {}),
          ...(extractedReviewMetadata.gps ? { gps: extractedReviewMetadata.gps } : {})
        };

        let uploadFile = file;
        if (file.size > SITE_PHOTO_UPLOAD_MAX_BYTES) {
          setSitePhotoUploadPreparing(true);
          setSitePhotoUploadStatus('photoUploadCompressing');
          const compressed = await compressSitePhotoUpload(file, image, dimensions, isCurrentSelection);
          if (!isCurrentSelection()) return;
          if (!compressed || compressed.file.size > SITE_PHOTO_UPLOAD_MAX_BYTES) {
            throw new Error('photoUploadCompressFailed');
          }
          uploadFile = compressed.file;
        }

        if (!isCurrentSelection()) return;
        if (uploadFile === file) {
          previewUrl = sourceUrl;
          sourceUrl = '';
        } else {
          previewUrl = URL.createObjectURL(uploadFile);
        }
        sitePhotoUploadPreparedFile = uploadFile;
        sitePhotoUploadObjectUrl = previewUrl;
        previewUrl = '';
        els.sitePhotoUploadPreviewImage.src = sitePhotoUploadObjectUrl;
        els.sitePhotoUploadPreviewImage.alt = tf('photoUploadPreviewAlt', { site: sitePhotoUploadSiteName });
        setSitePhotoUploadPreviewVisible(true);
        setSitePhotoUploadStatus();
      } catch (error) {
        if (!isCurrentSelection()) return;
        els.sitePhotoUploadFile.value = '';
        sitePhotoUploadPreparedFile = null;
        sitePhotoUploadPreparedMetadata = null;
        const statusKey = [
          'photoUploadInvalid', 'photoUploadTooSmall', 'photoUploadTooSmallSelected', 'photoUploadDimensions',
          'photoUploadCompressFailed'
        ].includes(error?.message) ? error.message : 'photoUploadCompressFailed';
        setSitePhotoUploadFieldInvalid('photo', true);
        setSitePhotoUploadStatus(statusKey, 'error', error?.statusValues || null);
      } finally {
        if (sourceUrl) URL.revokeObjectURL(sourceUrl);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        if (preparationId === sitePhotoUploadPreparationId) setSitePhotoUploadPreparing(false);
      }
    }

    function removeSelectedSitePhotoUpload() {
      if (sitePhotoUploadSubmitting) return;
      sitePhotoUploadPreparationId += 1;
      sitePhotoUploadPreparedFile = null;
      sitePhotoUploadPreparedMetadata = null;
      setSitePhotoUploadPreparing(false);
      els.sitePhotoUploadFile.value = '';
      setSitePhotoUploadPreviewVisible(false);
      els.sitePhotoUploadPreviewImage.removeAttribute('src');
      if (sitePhotoUploadObjectUrl) URL.revokeObjectURL(sitePhotoUploadObjectUrl);
      sitePhotoUploadObjectUrl = '';
      setSitePhotoUploadFieldInvalid('photo', false);
      setSitePhotoUploadStatus();
      els.sitePhotoUploadFile.focus({ preventScroll: true });
    }

    async function submitSitePhotoUpload(event) {
      event.preventDefault();
      if (sitePhotoUploadSubmitting || sitePhotoUploadPreparing) return;
      const photo = sitePhotoUploadPreparedFile;
      if (!photo) {
        setSitePhotoUploadFieldInvalid('photo', true);
        setSitePhotoUploadFieldInvalid('policy', !els.sitePhotoUploadPolicyAttestation.checked);
        setSitePhotoUploadStatus('photoUploadPickFile', 'error');
        els.sitePhotoUploadFile.focus();
        return;
      }
      setSitePhotoUploadFieldInvalid('photo', false);
      if (!els.sitePhotoUploadPolicyAttestation.checked) {
        setSitePhotoUploadFieldInvalid('policy', true);
        setSitePhotoUploadStatus('photoUploadConsentRequired', 'error');
        els.sitePhotoUploadPolicyAttestation.focus();
        return;
      }
      setSitePhotoUploadFieldInvalid('policy', false);

      const body = new FormData();
      body.append('photo', photo, photo.name);
      body.append('reviewMetadata', JSON.stringify(sitePhotoUploadPreparedMetadata || { version: 1 }));
      body.append('siteId', sitePhotoUploadSiteId);
      body.append('siteName', sitePhotoUploadSiteName);
      body.append('creditName', els.sitePhotoUploadCredit.value.trim());
      body.append('attestRealPhoto', 'yes');
      body.append('attestRights', 'yes');

      setSitePhotoUploadStatus();
      setSitePhotoUploadSubmitting(true);
      try {
        const response = await fetch(SITE_PHOTO_SUBMISSION_ENDPOINT, {
          method: 'POST',
          credentials: 'include',
          body
        });
        let result = null;
        try { result = await response.json(); } catch (_) {}
        if (response.status === 401 || result?.error === 'sign_in_required') {
          showSitePhotoUploadAccount(null);
          requestAnimationFrame(() => els.sitePhotoUploadSignIn.focus());
          return;
        }
        if (!response.ok || result?.success !== true || result?.status !== 'pending') {
          const statusKeys = {
            photo_required: 'photoUploadPickFile',
            unsupported_image: 'photoUploadInvalid',
            photo_too_large: 'photoUploadTooLarge',
            request_too_large: 'photoUploadTooLarge',
            invalid_review_metadata: 'photoUploadFailed',
            image_too_small: 'photoUploadTooSmall',
            image_dimensions_unsupported: 'photoUploadDimensions',
            already_pending: 'photoUploadAlreadyPending',
            daily_limit_reached: 'photoUploadDailyLimit',
            attestations_required: 'photoUploadConsentRequired',
            storage_unavailable: 'photoUploadStorageUnavailable'
          };
          throw new Error(statusKeys[result?.error] || 'photoUploadFailed');
        }
        els.sitePhotoUploadForm.hidden = true;
        els.sitePhotoUploadAuthRequired.hidden = true;
        els.sitePhotoUploadSuccess.hidden = false;
        requestAnimationFrame(() => els.sitePhotoUploadDoneButton.focus());
      } catch (error) {
        setSitePhotoUploadStatus(
          error?.message?.startsWith('photoUpload') ? error.message : 'photoUploadFailed',
          'error'
        );
      } finally {
        setSitePhotoUploadSubmitting(false);
      }
    }


    return {
      renderSitePhotoUploadTexts, setSitePhotoUploadStatus, setSitePhotoUploadFieldInvalid,
      positionSitePhotoUploadPolicyPopover, closeSitePhotoUploadPolicyPopover,
      toggleSitePhotoUploadPolicyPopover, rememberSitePhotoUploadContinuation,
      continueSitePhotoUploadAfterSignIn, openSitePhotoUploadModal, closeSitePhotoUploadModal,
      previewSitePhotoUpload, removeSelectedSitePhotoUpload, submitSitePhotoUpload,
      get preparedFile() { return sitePhotoUploadPreparedFile; },
      get statusKey() { return sitePhotoUploadStatusKey; }
    };
  } };
})();
