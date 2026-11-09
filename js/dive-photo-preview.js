(() => {
  let dialog = null;

  function getDialog(labels) {
    if (dialog?.isConnected) {
      dialog.setAttribute('aria-label', labels.preview);
      dialog.querySelector('.dive-photo-preview__close')?.setAttribute('aria-label', labels.close);
      return dialog;
    }

    dialog = document.createElement('dialog');
    dialog.className = 'dive-photo-preview';
    dialog.setAttribute('aria-label', labels.preview);

    const closeButton = document.createElement('button');
    closeButton.className = 'dive-photo-preview__close';
    closeButton.type = 'button';
    closeButton.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"/></svg>';
    closeButton.setAttribute('aria-label', labels.close);

    const layout = document.createElement('div');
    layout.className = 'dive-photo-preview__layout';
    const imagePane = document.createElement('div');
    imagePane.className = 'dive-photo-preview__image-pane';
    const image = document.createElement('img');
    image.className = 'dive-photo-preview__image';
    image.draggable = false;
    imagePane.append(image);
    const rail = document.createElement('aside');
    rail.className = 'dive-photo-preview__rail';
    rail.setAttribute('aria-label', 'Dive site photos');
    const credit = document.createElement('div');
    credit.className = 'dive-photo-preview__credit';
    credit.setAttribute('aria-live', 'polite');
    credit.setAttribute('aria-atomic', 'true');
    credit.addEventListener('click', event => event.stopPropagation());
    const renderCredit = photo => {
      // One inline container lets the outer flex layout wrap the entire credit;
      // separate flex children squeeze source/licence links into narrow columns.
      const content = document.createElement('div');
      content.textContent = photo.credit;
      for (const item of photo.creditLinks || []) {
        const link = document.createElement('a');
        link.href = item.url;
        link.textContent = item.label;
        link.rel = 'noreferrer';
        content.append(' · ', link);
      }
      if (photo.creditSuffix) content.append(' · ', photo.creditSuffix);
      if (photo.attributionDetail) {
        // Some collections require an exact acknowledgement beyond the artist.
        // Keep it available per image without restoring a long licence paragraph.
        const detail = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = 'Collection credit';
        detail.append(summary, document.createTextNode(photo.attributionDetail));
        content.append(detail);
      }
      credit.replaceChildren(content);
    };
    layout.append(imagePane, credit, rail);
    dialog.append(closeButton, layout);

    closeButton.addEventListener('click', () => dialog.close());
    const mobilePreview = window.matchMedia('(max-width: 720px)');
    let gesture = null;
    let suppressClickUntil = 0;
    let slideAnimation = null;
    const resetDrag = () => {
      gesture = null;
      image.classList.remove('is-dragging');
      image.style.removeProperty('transform');
      image.style.removeProperty('opacity');
    };
    const selectPhoto = index => {
      const photos = dialog._diveAtlasPhotos;
      if (!photos?.length) return;
      const nextIndex = (index + photos.length) % photos.length;
      const photo = photos[nextIndex];
      dialog._diveAtlasPhotoIndex = nextIndex;
      image.src = photo.src;
      image.alt = photo.alt;
      renderCredit(photo);
      rail.querySelectorAll('.dive-photo-preview__thumbnail').forEach((option, i) => {
        option.setAttribute('aria-pressed', String(i === nextIndex));
      });
      rail.children[nextIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    imagePane.addEventListener('pointerdown', event => {
      if (gesture && event.pointerId !== gesture.id) {
        resetDrag();
        return;
      }
      if (!mobilePreview.matches || !event.isPrimary || event.button !== 0) return;
      slideAnimation?.cancel();
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: null };
      imagePane.setPointerCapture(event.pointerId);
    });
    imagePane.addEventListener('pointermove', event => {
      if (!gesture || gesture.id !== event.pointerId) return;
      if (!mobilePreview.matches) { resetDrag(); return; }
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (!gesture.axis && Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
      gesture.axis ||= Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      image.classList.add('is-dragging');
      const horizontal = gesture.axis === 'x';
      const distance = horizontal ? dx : dy;
      // A single photo still responds, but resists dragging because there is no next photo.
      const offset = horizontal && dialog._diveAtlasPhotos.length < 2 ? distance * .2 : distance;
      image.style.transform = `translate${horizontal ? 'X' : 'Y'}(${offset}px)`;
      image.style.opacity = String(Math.max(.4, 1 - Math.abs(distance) / (horizontal ? imagePane.clientWidth : imagePane.clientHeight)));
    });
    imagePane.addEventListener('pointerup', event => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const { axis, x, y } = gesture;
      const distance = axis === 'x' ? event.clientX - x : event.clientY - y;
      if (axis) suppressClickUntil = performance.now() + 400;
      resetDrag();
      if (!mobilePreview.matches || !axis) return;
      // Require a deliberate swipe, while keeping the threshold reachable on narrow phones.
      const threshold = Math.min(90, (axis === 'x' ? imagePane.clientWidth : imagePane.clientHeight) * .18);
      if (Math.abs(distance) < Math.max(48, threshold)) return;
      if (axis === 'y') { dialog.close(); return; }
      if (dialog._diveAtlasPhotos.length < 2) return;
      selectPhoto(dialog._diveAtlasPhotoIndex + (distance < 0 ? 1 : -1));
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        slideAnimation = image.animate([
          { transform: `translateX(${distance < 0 ? 45 : -45}px)`, opacity: .4 },
          { transform: 'translateX(0)', opacity: 1 }
        ], { duration: 180, easing: 'ease-out' });
      }
    });
    imagePane.addEventListener('pointercancel', () => {
      if (gesture?.axis) suppressClickUntil = performance.now() + 400;
      resetDrag();
    });
    imagePane.addEventListener('lostpointercapture', resetDrag);
    mobilePreview.addEventListener('change', resetDrag);
    rail.addEventListener('click', event => {
      const thumbnail = event.target.closest('.dive-photo-preview__thumbnail');
      if (!thumbnail || !rail.contains(thumbnail)) return;
      event.stopPropagation();
      const selectedPhoto = dialog._diveAtlasPhotos?.[Number(thumbnail.dataset.photoIndex)];
      if (!selectedPhoto) return;
      selectPhoto(Number(thumbnail.dataset.photoIndex));
    });
    dialog.addEventListener('click', event => {
      if (!dialog.open) return;
      // Pointer capture retargets the click after a drag; it must not act as a backdrop tap.
      if (performance.now() < suppressClickUntil) return;
      const bounds = image.getBoundingClientRect();
      const scale = image.naturalWidth && image.naturalHeight
        ? Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight)
        : 0;
      const photoWidth = image.naturalWidth * scale;
      const photoHeight = image.naturalHeight * scale;
      const photoLeft = bounds.left + (bounds.width - photoWidth) / 2;
      const photoTop = bounds.top + (bounds.height - photoHeight) / 2;
      const clickedPhoto = scale > 0 && event.clientX >= photoLeft && event.clientX <= photoLeft + photoWidth &&
        event.clientY >= photoTop && event.clientY <= photoTop + photoHeight;
      if (!clickedPhoto) dialog.close();
    });

    dialog.addEventListener('close', () => {
      resetDrag();
      slideAnimation?.cancel();
      suppressClickUntil = 0;
      image.removeAttribute('src');
      rail.replaceChildren();
      dialog._diveAtlasPhotos = [];
      dialog._diveAtlasBackgroundPopup?.classList.remove('dive-site-popup--photo-previewing');
      dialog._diveAtlasBackgroundPopup = null;
    });
    document.body.append(dialog);
    dialog._diveAtlasRenderCredit = renderCredit;
    return dialog;
  }

  window.DiveAtlasPhotoPreview = {
    open(
      { src, alt, credit, photos, selectedPhotoIndex = 0 },
      { previewLabel = 'Photo preview', closeLabel = 'Close photo preview', popup = null } = {}
    ) {
      const photoOptions = (Array.isArray(photos) && photos.length ? photos : [{ src, alt, credit }])
        .filter(photo => photo && typeof photo.src === 'string' && photo.src);
      // A detail page supplies the stable UUID. Never infer an assignment from
      // a name, a coordinate, or the currently open map popup.
      const siteId = document.querySelector('main.detail-page')?.dataset.siteId;
      const additions = window.DiveAtlasReviewedPhotos?.additionalForSite?.(siteId) || [];
      const seen = new Set(photoOptions.map(photo => new URL(photo.src, location.href).href));
      for (const photo of additions) {
        const url = new URL(photo.src, location.href).href;
        if (seen.has(url)) continue;
        seen.add(url);
        photoOptions.push({...photo, credit: [photo.label, photo.credit].filter(Boolean).join(' · ')});
      }
      if (!photoOptions.length) return;
      const activeDialog = getDialog({ preview: previewLabel, close: closeLabel });
      const image = activeDialog.querySelector('.dive-photo-preview__image');
      const rail = activeDialog.querySelector('.dive-photo-preview__rail');
      const initialIndex = Number.isInteger(selectedPhotoIndex)
        ? Math.max(0, Math.min(selectedPhotoIndex, photoOptions.length - 1))
        : 0;
      activeDialog._diveAtlasPhotos = photoOptions.map(photo => ({
        src: photo.src,
        thumbnailSrc: typeof photo.thumbnailSrc === 'string' && photo.thumbnailSrc ? photo.thumbnailSrc : photo.src,
        alt: typeof photo.alt === 'string' ? photo.alt : '',
        credit: typeof photo.credit === 'string' ? photo.credit : '',
        // Per-image links must survive both thumbnail selection and touch swipes.
        // Plain-credit callers retain the original single-image behavior.
        creditLinks: (Array.isArray(photo.creditLinks) ? photo.creditLinks : []).filter(item =>
          item && typeof item.label === 'string' && /^https?:\/\//i.test(item.url)),
        creditSuffix: typeof photo.creditSuffix === 'string' ? photo.creditSuffix : '',
        attributionDetail: typeof photo.attributionDetail === 'string' ? photo.attributionDetail : ''
      }));
      rail.replaceChildren(...activeDialog._diveAtlasPhotos.map((photo, index) => {
        const thumbnail = document.createElement('button');
        thumbnail.className = 'dive-photo-preview__thumbnail';
        thumbnail.type = 'button';
        thumbnail.dataset.photoIndex = String(index);
        thumbnail.setAttribute('aria-label', `Photo ${index + 1}`);
        thumbnail.setAttribute('aria-pressed', String(index === initialIndex));
        const thumbnailImage = document.createElement('img');
        thumbnailImage.src = photo.thumbnailSrc;
        thumbnailImage.alt = '';
        thumbnailImage.loading = 'lazy';
        thumbnailImage.decoding = 'async';
        thumbnail.append(thumbnailImage);
        return thumbnail;
      }));
      const selectedPhoto = activeDialog._diveAtlasPhotos[initialIndex];
      activeDialog._diveAtlasPhotoIndex = initialIndex;
      image.src = selectedPhoto.src;
      image.alt = selectedPhoto.alt;
      activeDialog._diveAtlasRenderCredit(selectedPhoto);
      if (!activeDialog.open) {
        activeDialog.showModal();
        const backgroundPopup = popup?.getElement?.();
        if (backgroundPopup?.classList.contains('dive-site-popup')) {
          backgroundPopup.classList.add('dive-site-popup--photo-previewing');
          activeDialog._diveAtlasBackgroundPopup = backgroundPopup;
        }
      }
    }
  };
})();
